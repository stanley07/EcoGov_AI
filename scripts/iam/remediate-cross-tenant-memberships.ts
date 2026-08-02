import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { PoolClient } from "pg";

export const REMEDIATION_VERSION = "IAM-1R-v1";
export const APPROVAL_REFERENCE = "IAM-1R-SEED_AND_MAP_ROLE-2026-08-02";
export const TEMPLATE_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const TEMPLATE_SUPER_ADMIN_ROLE_ID =
  "00000000-0000-0000-0000-000000000501";
export const CANONICAL_ROLE = Object.freeze({
  name: "super_admin",
  description: "Full system management access",
  isSystem: true,
  parentRoleId: null,
});

export const CANONICAL_SUPER_ADMIN_PERMISSIONS = Object.freeze([
  "audit:read",
  "complaint:contact:read",
  "complaint:review",
  "facility:read",
  "facility:register",
  "facility:review",
  "facility:write",
  "org:read",
  "org:write",
  "user:invite",
  "user:mfa:reset",
  "user:read",
  "user:role:assign",
  "user:session:revoke",
  "user:status:write",
  "user:write",
  "workbench:queue:read",
  "workflow:read",
  "workflow:write",
] as const);

export type ApprovedMembership = Readonly<{
  membershipId: string;
  tenantId: string;
  userId: string;
}>;

export const APPROVED_MEMBERSHIPS: readonly ApprovedMembership[] =
  Object.freeze([
    {
      membershipId: "00b3fb29-3f81-499d-8acc-3dd62dfbad85",
      tenantId: "e622a70b-a570-4a42-a283-ed724df630bd",
      userId: "bee08901-025c-4412-9213-453d212b5546",
    },
    {
      membershipId: "2e473171-86f0-4375-922c-636d54ced58f",
      tenantId: "6500bdac-cafe-4b17-99c5-1240bd30af8c",
      userId: "33ace1a5-4c9c-4065-9422-051a2c7e0a2a",
    },
    {
      membershipId: "5481e56a-77ad-4383-944c-4ebada33ed1f",
      tenantId: "162ef18a-27a8-4f3e-848a-cef3554bfd86",
      userId: "a67159ed-01d5-4742-b2ec-c51eab1c84fa",
    },
    {
      membershipId: "5930928c-829d-4ef5-93ce-27405b4f0b5e",
      tenantId: "9148b4cb-6cfa-4898-ac73-15f03d7fdbba",
      userId: "ed96e1e2-bbc6-43c0-ab53-83a974a96bbb",
    },
    {
      membershipId: "6bec81e7-1e5a-4187-9a32-fd774f1aa7a7",
      tenantId: "8b5b6952-e20c-45e6-85db-11ff5bd71d69",
      userId: "d5814f9f-b6d9-4aa8-9ee8-bf218c748fe9",
    },
    {
      membershipId: "746fce6d-5ebe-4532-ae40-91c9a8f8561a",
      tenantId: "4a07a522-e500-4eed-965d-375dc2d855b8",
      userId: "cfdc7d40-35d5-4ea1-8b70-4e95e0b64462",
    },
    {
      membershipId: "74e5bcaf-4bb6-4ce1-98ac-7b59f652555b",
      tenantId: "1a3fcd4a-d967-41fc-825d-d76f60aaf65b",
      userId: "1e82a489-1738-4327-b7a4-0e6bb576832e",
    },
    {
      membershipId: "753e5a23-1710-44c7-892a-714b50cf6f9f",
      tenantId: "a1b4f113-5f76-4ee7-9ce0-a5371c91ddf1",
      userId: "db293bda-33e6-4234-8c50-6e47fd5b017e",
    },
    {
      membershipId: "7e873fae-2240-4640-9582-a01ff3105cba",
      tenantId: "db7e3fa3-9a8f-4666-b185-f59a93b39d68",
      userId: "ba30ad3d-123b-4f07-8ca2-ff507ec4fbdc",
    },
    {
      membershipId: "80450a42-65a4-4027-8daa-5b98dea19ae4",
      tenantId: "5e9a52d6-479e-49ed-9861-592bfc03623b",
      userId: "d52fadc1-021b-4123-9106-3303f2cfb2b9",
    },
    {
      membershipId: "c51fcc2e-5ad5-436f-a3d4-72fb9c885726",
      tenantId: "9806ce26-615f-4622-8b7d-beedbad588fe",
      userId: "7570fda8-51eb-4b04-9d8b-bf52ec290b76",
    },
    {
      membershipId: "c8e51616-2805-42c8-b909-644c9ae1b015",
      tenantId: "129c4672-d7e4-45a7-a3cd-5d3c683c6a64",
      userId: "a89657e4-ada4-4b02-adeb-3b70c9284533",
    },
    {
      membershipId: "cdca6a24-b33c-4a80-bffa-44ef85315b43",
      tenantId: "1e1875d4-3f66-4a06-aec3-855c52ac99c7",
      userId: "fa8db8fb-ff71-4cbb-a4e0-69699023870e",
    },
    {
      membershipId: "e62aa017-7a97-45bb-b91e-3ebf2e369fe2",
      tenantId: "7cd00496-9130-425e-964a-9a423cf483bb",
      userId: "1d591d5a-9820-4ba7-ae28-b95b554bab34",
    },
  ]);

type Mode = "dry-run" | "apply";
type MembershipState = ApprovedMembership & {
  roleId: string;
  roleTenantId: string;
  roleName: string;
};

export type RemediationItem = Readonly<{
  membershipId: string;
  tenantId: string;
  userId: string;
  oldRoleId: string;
  newRoleId: string;
  roleDisposition: "create" | "reuse" | "already-remediated";
  expectedSessionRevocations: number;
  expectedAuditEvents: number;
}>;

export type RemediationResult = Readonly<{
  mode: Mode;
  correlationId: string;
  approvedRecordCount: number;
  crossTenantBefore: number;
  changedMemberships: number;
  sessionsRevoked: number;
  auditEventsWritten: number;
  noOp: boolean;
  items: readonly RemediationItem[];
}>;

function assertCanonicalPermissionNames(): void {
  const names = [...CANONICAL_SUPER_ADMIN_PERMISSIONS];
  if (new Set(names).size !== names.length)
    throw new Error("Canonical permission catalog contains duplicates");
  if (
    names.some(
      (name) => name.startsWith("platform.") || name.startsWith("PLATFORM_"),
    )
  ) {
    throw new Error(
      "Canonical tenant role catalog contains a platform permission",
    );
  }
}

async function countAllCrossTenantMemberships(
  client: PoolClient,
): Promise<number> {
  const result = await client.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM membership m
    JOIN user_account u ON u.id = m.user_id
    JOIN role r ON r.id = m.role_id
    LEFT JOIN organization o ON o.id = m.organization_id
    LEFT JOIN department d ON d.id = m.department_id
    WHERE u.tenant_id <> m.tenant_id
       OR r.tenant_id <> m.tenant_id
       OR (o.id IS NOT NULL AND o.tenant_id <> m.tenant_id)
       OR (d.id IS NOT NULL AND d.tenant_id <> m.tenant_id)
  `);
  return Number(result.rows[0]?.count ?? "0");
}

async function loadApprovedStates(
  client: PoolClient,
  lock: boolean,
): Promise<MembershipState[]> {
  const ids = APPROVED_MEMBERSHIPS.map((item) => item.membershipId);
  const result = await client.query<{
    membership_id: string;
    tenant_id: string;
    user_id: string;
    role_id: string;
    role_tenant_id: string;
    role_name: string;
  }>(
    `
    SELECT m.id AS membership_id, m.tenant_id, m.user_id, m.role_id,
           r.tenant_id AS role_tenant_id, r.name AS role_name
    FROM membership m
    JOIN user_account u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
    JOIN role r ON r.id = m.role_id
    WHERE m.id = ANY($1::uuid[])
    ORDER BY m.id
    ${lock ? "FOR UPDATE OF m, u, r" : ""}
  `,
    [ids],
  );
  return result.rows.map((row) => ({
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    roleId: row.role_id,
    roleTenantId: row.role_tenant_id,
    roleName: row.role_name,
  }));
}

function validateApprovedStates(
  states: readonly MembershipState[],
  crossTenantCount: number,
): "pending" | "complete" {
  if (states.length !== APPROVED_MEMBERSHIPS.length) {
    throw new Error(
      `Approved membership count mismatch: expected 14, found ${states.length}`,
    );
  }
  const expected = new Map(
    APPROVED_MEMBERSHIPS.map((item) => [item.membershipId, item]),
  );
  let pending = 0;
  let complete = 0;
  for (const state of states) {
    const approved = expected.get(state.membershipId);
    if (
      !approved ||
      approved.tenantId !== state.tenantId ||
      approved.userId !== state.userId
    ) {
      throw new Error(`Approved membership changed: ${state.membershipId}`);
    }
    if (
      state.roleId === TEMPLATE_SUPER_ADMIN_ROLE_ID &&
      state.roleTenantId === TEMPLATE_TENANT_ID &&
      state.roleName === CANONICAL_ROLE.name
    ) {
      pending += 1;
    } else if (
      state.roleTenantId === state.tenantId &&
      state.roleName === CANONICAL_ROLE.name
    ) {
      complete += 1;
    } else {
      throw new Error(
        `Approved membership has unexpected role state: ${state.membershipId}`,
      );
    }
  }
  if (
    pending === APPROVED_MEMBERSHIPS.length &&
    crossTenantCount === APPROVED_MEMBERSHIPS.length
  )
    return "pending";
  if (complete === APPROVED_MEMBERSHIPS.length && crossTenantCount === 0)
    return "complete";
  throw new Error(
    `Partial or unexpected remediation state: pending=${pending}, complete=${complete}, crossTenant=${crossTenantCount}`,
  );
}

async function validateTemplateRole(client: PoolClient): Promise<void> {
  const result = await client.query<{
    tenant_id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    parent_role_id: string | null;
  }>(
    `SELECT tenant_id, name, description, is_system, parent_role_id FROM role WHERE id=$1`,
    [TEMPLATE_SUPER_ADMIN_ROLE_ID],
  );
  const role = result.rows[0];
  if (
    !role ||
    role.tenant_id !== TEMPLATE_TENANT_ID ||
    role.name !== CANONICAL_ROLE.name ||
    role.description !== CANONICAL_ROLE.description ||
    role.is_system !== CANONICAL_ROLE.isSystem ||
    role.parent_role_id !== null
  ) {
    throw new Error(
      "Template super_admin role no longer matches the approved metadata contract",
    );
  }
}

async function resolveLocalRole(
  client: PoolClient,
  tenantId: string,
  mutate: boolean,
): Promise<{ id: string; disposition: "create" | "reuse" }> {
  const existing = await client.query<{
    id: string;
    description: string | null;
    is_system: boolean;
    parent_role_id: string | null;
  }>(
    `SELECT id, description, is_system, parent_role_id FROM role WHERE tenant_id=$1 AND name=$2 FOR UPDATE`,
    [tenantId, CANONICAL_ROLE.name],
  );
  if (existing.rows.length > 1)
    throw new Error(
      `Conflicting local super_admin roles for tenant ${tenantId}`,
    );
  const role = existing.rows[0];
  if (role) {
    if (
      role.description !== CANONICAL_ROLE.description ||
      role.is_system !== true ||
      role.parent_role_id !== null
    ) {
      throw new Error(
        `Noncanonical local super_admin role for tenant ${tenantId}`,
      );
    }
    const permissionResult = await client.query<{ name: string }>(
      `
      SELECT p.name FROM role_permission rp JOIN permission p ON p.id=rp.permission_id
      WHERE rp.role_id=$1 ORDER BY p.name
    `,
      [role.id],
    );
    const actual = permissionResult.rows.map((row) => row.name);
    const expected = [...CANONICAL_SUPER_ADMIN_PERMISSIONS].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Conflicting permission set on local super_admin role for tenant ${tenantId}`,
      );
    }
    return { id: role.id, disposition: "reuse" };
  }
  const roleId = randomUUID();
  if (mutate) {
    await client.query(
      `
      INSERT INTO role (id, tenant_id, name, description, is_system, parent_role_id)
      VALUES ($1,$2,$3,$4,TRUE,NULL)
    `,
      [roleId, tenantId, CANONICAL_ROLE.name, CANONICAL_ROLE.description],
    );
  }
  return { id: roleId, disposition: "create" };
}

async function seedPermissions(
  client: PoolClient,
  tenantId: string,
  roleId: string,
): Promise<void> {
  for (const permissionName of CANONICAL_SUPER_ADMIN_PERMISSIONS) {
    const permission = await client.query<{ id: string }>(
      `
      INSERT INTO permission (tenant_id, name, description)
      VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id,name) DO UPDATE SET description=EXCLUDED.description
      RETURNING id
    `,
      [tenantId, permissionName, `Permission to ${permissionName}`],
    );
    await client.query(
      `
      INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2)
      ON CONFLICT (role_id,permission_id) DO NOTHING
    `,
      [roleId, permission.rows[0]?.id],
    );
  }
  const parity = await client.query<{ name: string }>(
    `
    SELECT p.name FROM role_permission rp JOIN permission p ON p.id=rp.permission_id
    WHERE rp.role_id=$1 ORDER BY p.name
  `,
    [roleId],
  );
  const actual = parity.rows.map((row) => row.name);
  const expected = [...CANONICAL_SUPER_ADMIN_PERMISSIONS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Canonical permission parity failed for tenant ${tenantId}`,
    );
}

export async function remediateCrossTenantMemberships(
  pool: Pool,
  mode: Mode,
  correlationId = randomUUID(),
): Promise<RemediationResult> {
  assertCanonicalPermissionNames();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('IAM-1R-cross-tenant-memberships'))",
    );
    await validateTemplateRole(client);
    const crossTenantBefore = await countAllCrossTenantMemberships(client);
    const states = await loadApprovedStates(client, mode === "apply");
    const lifecycle = validateApprovedStates(states, crossTenantBefore);
    if (lifecycle === "complete") {
      await client.query("ROLLBACK");
      return {
        mode,
        correlationId,
        approvedRecordCount: 14,
        crossTenantBefore,
        changedMemberships: 0,
        sessionsRevoked: 0,
        auditEventsWritten: 0,
        noOp: true,
        items: states.map((state) => ({
          membershipId: state.membershipId,
          tenantId: state.tenantId,
          userId: state.userId,
          oldRoleId: state.roleId,
          newRoleId: state.roleId,
          roleDisposition: "already-remediated",
          expectedSessionRevocations: 0,
          expectedAuditEvents: 0,
        })),
      };
    }

    const items: RemediationItem[] = [];
    let sessionsRevoked = 0;
    for (const state of states) {
      await client.query("SELECT id FROM tenant WHERE id=$1 FOR UPDATE", [
        state.tenantId,
      ]);
      const localRole = await resolveLocalRole(
        client,
        state.tenantId,
        mode === "apply",
      );
      const sessionCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM session WHERE tenant_id=$1 AND user_id=$2",
        [state.tenantId, state.userId],
      );
      items.push({
        membershipId: state.membershipId,
        tenantId: state.tenantId,
        userId: state.userId,
        oldRoleId: state.roleId,
        newRoleId: localRole.id,
        roleDisposition: localRole.disposition,
        expectedSessionRevocations: Number(sessionCount.rows[0]?.count ?? "0"),
        expectedAuditEvents: 1,
      });
      if (mode === "apply") {
        await seedPermissions(client, state.tenantId, localRole.id);
        const update = await client.query(
          "UPDATE membership SET role_id=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND user_id=$4 AND role_id=$5",
          [
            localRole.id,
            state.membershipId,
            state.tenantId,
            state.userId,
            TEMPLATE_SUPER_ADMIN_ROLE_ID,
          ],
        );
        if (update.rowCount !== 1)
          throw new Error(
            `Membership update race detected: ${state.membershipId}`,
          );
        const deleted = await client.query(
          "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",
          [state.tenantId, state.userId],
        );
        sessionsRevoked += deleted.rowCount ?? 0;
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id,user_id,action,resource,result,context)
          VALUES ($1,$2,'IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED',$3,'allow',$4::jsonb)`,
          [
            state.tenantId,
            state.userId,
            `membership:${state.membershipId}`,
            JSON.stringify({
              remediationVersion: REMEDIATION_VERSION,
              membershipId: state.membershipId,
              userId: state.userId,
              tenantId: state.tenantId,
              oldRoleId: state.roleId,
              oldRoleTenantId: state.roleTenantId,
              newRoleId: localRole.id,
              roleName: CANONICAL_ROLE.name,
              sessionCountRevoked: deleted.rowCount ?? 0,
              approvalReference: APPROVAL_REFERENCE,
              correlationId,
            }),
          ],
        );
      }
    }
    if (mode === "dry-run") {
      await client.query("ROLLBACK");
      return {
        mode,
        correlationId,
        approvedRecordCount: 14,
        crossTenantBefore,
        changedMemberships: 14,
        sessionsRevoked: items.reduce(
          (sum, item) => sum + item.expectedSessionRevocations,
          0,
        ),
        auditEventsWritten: 14,
        noOp: false,
        items,
      };
    }
    const crossTenantAfter = await countAllCrossTenantMemberships(client);
    if (crossTenantAfter !== 0)
      throw new Error(
        `Post-remediation cross-tenant membership count is ${crossTenantAfter}`,
      );
    await client.query("COMMIT");
    return {
      mode,
      correlationId,
      approvedRecordCount: 14,
      crossTenantBefore,
      changedMemberships: 14,
      sessionsRevoked,
      auditEventsWritten: 14,
      noOp: false,
      items,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const mode: Mode | null = flags.has("--dry-run")
    ? "dry-run"
    : flags.has("--apply")
      ? "apply"
      : null;
  if (!mode || (flags.has("--dry-run") && flags.has("--apply")))
    throw new Error("Specify exactly one of --dry-run or --apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await remediateCrossTenantMemberships(pool, mode);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
