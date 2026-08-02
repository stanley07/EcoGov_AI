import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  APPROVED_MEMBERSHIPS,
  TEMPLATE_SUPER_ADMIN_ROLE_ID,
} from "./remediate-cross-tenant-memberships.ts";

type RollbackMode = "dry-run" | "apply";

export async function rollbackCrossTenantMemberships(
  pool: Pool,
  mode: RollbackMode,
  remediationCorrelationId: string,
): Promise<{ mode: RollbackMode; restoredMemberships: number; noOp: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(remediationCorrelationId)) {
    throw new Error("A valid remediation correlation ID is required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('IAM-1R-cross-tenant-memberships'))",
    );
    const ids = APPROVED_MEMBERSHIPS.map((item) => item.membershipId);
    const audit = await client.query<{
      membership_id: string;
      tenant_id: string;
      user_id: string;
      old_role_id: string;
      new_role_id: string;
    }>(
      `SELECT context->>'membershipId' AS membership_id,
              context->>'tenantId' AS tenant_id,
              context->>'userId' AS user_id,
              context->>'oldRoleId' AS old_role_id,
              context->>'newRoleId' AS new_role_id
       FROM authz_audit_log
       WHERE action='IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED'
         AND context->>'correlationId'=$1
         AND context->>'membershipId'=ANY($2::text[])
       ORDER BY context->>'membershipId'`,
      [remediationCorrelationId, ids],
    );
    if (audit.rows.length !== 14) {
      throw new Error(
        `Rollback ledger mismatch: expected 14 audit rows, found ${audit.rows.length}`,
      );
    }
    const approved = new Map(
      APPROVED_MEMBERSHIPS.map((item) => [item.membershipId, item]),
    );
    for (const ledger of audit.rows) {
      const expected = approved.get(ledger.membership_id);
      if (
        !expected ||
        ledger.tenant_id !== expected.tenantId ||
        ledger.user_id !== expected.userId ||
        ledger.old_role_id !== TEMPLATE_SUPER_ADMIN_ROLE_ID
      ) {
        throw new Error(`Rollback ledger drift: ${ledger.membership_id}`);
      }
      const membership = await client.query<{ role_id: string }>(
        "SELECT role_id FROM membership WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE",
        [ledger.membership_id, ledger.tenant_id, ledger.user_id],
      );
      if (membership.rows[0]?.role_id !== ledger.new_role_id) {
        throw new Error(`Post-remediation drift: ${ledger.membership_id}`);
      }
    }
    if (mode === "dry-run") {
      await client.query("ROLLBACK");
      return { mode, restoredMemberships: 14, noOp: false };
    }
    for (const ledger of audit.rows) {
      const updated = await client.query(
        "UPDATE membership SET role_id=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND user_id=$4 AND role_id=$5",
        [
          TEMPLATE_SUPER_ADMIN_ROLE_ID,
          ledger.membership_id,
          ledger.tenant_id,
          ledger.user_id,
          ledger.new_role_id,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`Rollback update race: ${ledger.membership_id}`);
      }
      await client.query(
        `INSERT INTO authz_audit_log (tenant_id,user_id,action,resource,result,context)
         VALUES ($1,$2,'IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATION_ROLLED_BACK',$3,'allow',$4::jsonb)`,
        [
          ledger.tenant_id,
          ledger.user_id,
          `membership:${ledger.membership_id}`,
          JSON.stringify({
            membershipId: ledger.membership_id,
            restoredRoleId: TEMPLATE_SUPER_ADMIN_ROLE_ID,
            remediationCorrelationId,
          }),
        ],
      );
    }
    await client.query("COMMIT");
    return { mode, restoredMemberships: 14, noOp: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode: RollbackMode | null = args.includes("--dry-run")
    ? "dry-run"
    : args.includes("--apply")
      ? "apply"
      : null;
  const correlationIndex = args.indexOf("--correlation-id");
  const correlationId =
    correlationIndex >= 0 ? args[correlationIndex + 1] : undefined;
  if (!mode || !correlationId) {
    throw new Error("Specify --dry-run or --apply and --correlation-id <uuid>");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    process.stdout.write(
      `${JSON.stringify(await rollbackCrossTenantMemberships(pool, mode, correlationId), null, 2)}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
