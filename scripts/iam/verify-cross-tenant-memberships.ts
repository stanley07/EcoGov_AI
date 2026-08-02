import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  APPROVED_MEMBERSHIPS,
  CANONICAL_SUPER_ADMIN_PERMISSIONS,
} from "./remediate-cross-tenant-memberships.ts";

export async function verifyCrossTenantMemberships(
  pool: Pool,
): Promise<Record<string, number>> {
  const ids = APPROVED_MEMBERSHIPS.map((item) => item.membershipId);
  const [crossTenant, approvedLocal, permissionParity, auditEvents] =
    await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM membership m JOIN user_account u ON u.id=m.user_id JOIN role r ON r.id=m.role_id LEFT JOIN organization o ON o.id=m.organization_id LEFT JOIN department d ON d.id=m.department_id WHERE u.tenant_id<>m.tenant_id OR r.tenant_id<>m.tenant_id OR (o.id IS NOT NULL AND o.tenant_id<>m.tenant_id) OR (d.id IS NOT NULL AND d.tenant_id<>m.tenant_id)`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM membership m JOIN role r ON r.id=m.role_id WHERE m.id=ANY($1::uuid[]) AND r.tenant_id=m.tenant_id AND r.name='super_admin'`,
        [ids],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM (SELECT m.id FROM membership m JOIN role r ON r.id=m.role_id JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id WHERE m.id=ANY($1::uuid[]) GROUP BY m.id HAVING COUNT(DISTINCT p.name)=$2 AND COUNT(DISTINCT p.name) FILTER (WHERE p.name=ANY($3::text[]))=$2 AND COUNT(DISTINCT p.name) FILTER (WHERE p.name LIKE 'platform.%')=0) parity`,
        [
          ids,
          CANONICAL_SUPER_ADMIN_PERMISSIONS.length,
          [...CANONICAL_SUPER_ADMIN_PERMISSIONS],
        ],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM authz_audit_log WHERE action='IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED' AND resource=ANY($1::text[])`,
        [ids.map((id) => `membership:${id}`)],
      ),
    ]);
  return {
    crossTenantMemberships: Number(crossTenant.rows[0]?.count ?? "0"),
    approvedLocalMemberships: Number(approvedLocal.rows[0]?.count ?? "0"),
    permissionParityMemberships: Number(permissionParity.rows[0]?.count ?? "0"),
    auditEvents: Number(auditEvents.rows[0]?.count ?? "0"),
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    process.stdout.write(
      `${JSON.stringify(await verifyCrossTenantMemberships(pool), null, 2)}\n`,
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
