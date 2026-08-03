import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  assertTenantRoleCatalog,
  TENANT_ROLE_PERMISSION_MANIFESTS,
  TENANT_SUPER_ADMIN_PERMISSION_MANIFEST,
} from "@govos/core";

const APPROVAL_REFERENCE = "ADR-003-IAM1-GATE3-2026-08-03";
const SEEDED_ROLES = Object.freeze([
  ["environmental_consultant", "Approved environmental operations partner"],
  ["finance_officer", "Approved tenant finance officer"],
] as const);
type Mode = "dry-run" | "apply";

export type CatalogReconciliationResult = Readonly<{
  mode: Mode;
  tenantId: string;
  tenantSlug: string;
  rolesCreated: number;
  permissionsCreated: number;
  mappingsCreated: number;
  membershipChanges: number;
  platformMappings: number;
  foreignMappings: number;
  noOp: boolean;
}>;

async function count(client: PoolClient, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? "0");
}

export async function reconcileTenantRoleCatalog(
  pool: Pool,
  tenantSlug: string,
  mode: Mode,
): Promise<CatalogReconciliationResult> {
  assertTenantRoleCatalog();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug))
    throw new Error("A canonical tenant slug is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `IAM-1-Gate3-role-catalog:${tenantSlug}`,
    ]);
    const tenantResult = await client.query<{ id: string; slug: string; is_system: boolean }>(
      "SELECT id,slug,is_system FROM tenant WHERE slug=$1 AND status='active' FOR UPDATE",
      [tenantSlug],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant || tenant.is_system) throw new Error("Active non-system tenant not found");
    const membershipBefore = await count(client, "SELECT COUNT(*)::text AS count FROM membership WHERE tenant_id=$1", [tenant.id]);
    const duplicateRoles = await client.query<{ normalized_name: string }>(`
      SELECT lower(name) AS normalized_name FROM role WHERE tenant_id=$1
      GROUP BY lower(name) HAVING COUNT(*) > 1
    `, [tenant.id]);
    if (duplicateRoles.rowCount) throw new Error("Case-insensitive duplicate tenant roles exist");

    const existingSuper = await client.query<{ id: string; name: string }>(
      "SELECT r.id,p.name FROM role r JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND lower(r.name)='super_admin' ORDER BY p.name",
      [tenant.id],
    );
    const approved = new Set(TENANT_SUPER_ADMIN_PERMISSION_MANIFEST);
    const unexpected = existingSuper.rows.map((row) => row.name).filter((name) => !approved.has(name));
    if (unexpected.length) throw new Error(`Unexpected super_admin mappings: ${unexpected.join(",")}`);

    let rolesCreated = 0;
    let permissionsCreated = 0;
    let mappingsCreated = 0;
    for (const [roleName, description] of SEEDED_ROLES) {
      const existing = await client.query<{ id: string; name: string }>(
        "SELECT id,name FROM role WHERE tenant_id=$1 AND lower(name)=lower($2) FOR UPDATE",
        [tenant.id, roleName],
      );
      if (existing.rowCount && existing.rows[0]?.name !== roleName)
        throw new Error(`Noncanonical case variant exists for role ${roleName}`);
      if (!existing.rowCount) {
        rolesCreated += 1;
        if (mode === "apply") await client.query(
          "INSERT INTO role (id,tenant_id,name,description,is_system) VALUES ($1,$2,$3,$4,TRUE)",
          [randomUUID(), tenant.id, roleName, description],
        );
      }
    }

    for (const [roleName, manifest] of Object.entries(TENANT_ROLE_PERMISSION_MANIFESTS)) {
      const role = await client.query<{ id: string }>(
        "SELECT id FROM role WHERE tenant_id=$1 AND name=$2",
        [tenant.id, roleName],
      );
      if (!role.rows[0]) {
        if (mode === "dry-run" && SEEDED_ROLES.some(([name]) => name === roleName)) continue;
        throw new Error(`Required canonical role is missing: ${roleName}`);
      }
      for (const permissionName of manifest) {
        const permission = await client.query<{ id: string }>(
          "SELECT id FROM permission WHERE tenant_id=$1 AND name=$2",
          [tenant.id, permissionName],
        );
        let permissionId = permission.rows[0]?.id;
        if (!permissionId) {
          permissionsCreated += 1;
          permissionId = randomUUID();
          if (mode === "apply") await client.query(
            "INSERT INTO permission (id,tenant_id,name,description) VALUES ($1,$2,$3,$4)",
            [permissionId, tenant.id, permissionName, `Permission to ${permissionName}`],
          );
        }
        const mapped = await count(client, "SELECT COUNT(*)::text AS count FROM role_permission WHERE role_id=$1 AND permission_id=$2", [role.rows[0].id, permissionId]);
        if (!mapped) {
          mappingsCreated += 1;
          if (mode === "apply") await client.query(
            "INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2)",
            [role.rows[0].id, permissionId],
          );
        }
      }
    }
    const platformMappings = await count(client, `SELECT COUNT(*)::text AS count FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id WHERE r.tenant_id=$1 AND (p.name LIKE 'platform.%' OR p.name LIKE 'PLATFORM_%')`, [tenant.id]);
    const foreignMappings = await count(client, "SELECT COUNT(*)::text AS count FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id WHERE r.tenant_id=$1 AND p.tenant_id<>r.tenant_id", [tenant.id]);
    if (platformMappings || foreignMappings) throw new Error("Tenant catalog integrity verification failed");
    if (mode === "apply") {
      const finalSuper = await client.query<{ name: string }>(
        "SELECT p.name FROM role r JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.name='super_admin' ORDER BY p.name",
        [tenant.id],
      );
      const actual = finalSuper.rows.map((row) => row.name);
      const expected = [...TENANT_SUPER_ADMIN_PERMISSION_MANIFEST].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error("Post-reconciliation super_admin manifest mismatch");
    }
    const membershipAfter = await count(client, "SELECT COUNT(*)::text AS count FROM membership WHERE tenant_id=$1", [tenant.id]);
    if (membershipAfter !== membershipBefore) throw new Error("Membership mutation detected");
    if (mode === "apply") {
      if (rolesCreated + permissionsCreated + mappingsCreated > 0)
        await client.query(`INSERT INTO authz_audit_log (tenant_id,user_id,action,resource,result,context)
          VALUES ($1,NULL,'IAM_ROLE_CATALOG_RECONCILED',$2,'allow',$3::jsonb)`, [tenant.id, `tenant:${tenant.id}`, JSON.stringify({ approvalReference: APPROVAL_REFERENCE, rolesCreated, permissionsCreated, mappingsCreated })]);
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    return { mode, tenantId: tenant.id, tenantSlug, rolesCreated, permissionsCreated, mappingsCreated, membershipChanges: 0, platformMappings, foreignMappings, noOp: rolesCreated + permissionsCreated + mappingsCreated === 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function main() {
  const args = process.argv.slice(2);
  const tenantIndex = args.indexOf("--tenant");
  const tenantSlug = tenantIndex >= 0 ? args[tenantIndex + 1] : undefined;
  const mode: Mode | null = args.includes("--apply") === args.includes("--dry-run") ? null : args.includes("--apply") ? "apply" : "dry-run";
  if (!tenantSlug || !mode || args.some((arg) => arg === "*" || arg.includes("*"))) throw new Error("Specify --tenant <slug> and exactly one of --dry-run or --apply; wildcards are forbidden");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { process.stdout.write(`${JSON.stringify(await reconcileTenantRoleCatalog(pool, tenantSlug, mode), null, 2)}\n`); }
  finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
