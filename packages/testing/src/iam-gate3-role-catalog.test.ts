import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  TENANT_SUPER_ADMIN_PERMISSION_MANIFEST,
  TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS,
} from "@govos/core/tenant-role-catalog";
import { reconcileTenantRoleCatalog } from "../../../scripts/iam/reconcile-tenant-role-catalog.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tenantId = randomUUID();
const tenantSlug = `iam-gate3-${tenantId.slice(0, 8)}`;
const baseline = [
  ...TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS,
  "user:read",
  "user:invite",
  "user:role:assign",
  "user:status:write",
  "user:session:revoke",
  "user:mfa:reset",
  "user:write",
];

describe.sequential("IAM Gate 3 tenant role catalog reconciliation", () => {
  beforeAll(async () => {
    await pool.query(
      "INSERT INTO tenant (id,name,slug,type,status,is_system) VALUES ($1,$2,$3,'ministry','active',FALSE)",
      [tenantId, "IAM Gate 3 Catalog Fixture", tenantSlug],
    );
    for (const roleName of ["super_admin", "director", "inspector", "organization_admin", "citizen"])
      await pool.query("INSERT INTO role (tenant_id,name,description,is_system) VALUES ($1,$2,$3,TRUE)", [tenantId, roleName, roleName]);
    const superRole = (await pool.query<{ id: string }>("SELECT id FROM role WHERE tenant_id=$1 AND name='super_admin'", [tenantId])).rows[0]!.id;
    for (const name of baseline) {
      const permission = (await pool.query<{ id: string }>("INSERT INTO permission (tenant_id,name,description) VALUES ($1,$2,$3) RETURNING id", [tenantId, name, name])).rows[0]!.id;
      await pool.query("INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2)", [superRole, permission]);
    }
  });

  afterAll(async () => {
    await pool.query("DELETE FROM authz_audit_log WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM tenant WHERE id=$1", [tenantId]);
    await pool.end();
  });

  test("manifest is 45 unique tenant-only names including WF-1", () => {
    expect(Array.isArray(TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS)).toBe(true);
    expect(typeof TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS[Symbol.iterator]).toBe("function");
    expect(TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS).toHaveLength(12);
    expect(new Set(TENANT_SUPER_ADMIN_PERMISSION_MANIFEST).size).toBe(45);
    expect(TENANT_SUPER_ADMIN_PERMISSION_MANIFEST.some((name) => name.startsWith("platform.") || name.startsWith("PLATFORM_"))).toBe(false);
  });

  test("creates only approved missing roles and exact super_admin mappings", async () => {
    const membershipCount = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM membership WHERE tenant_id=$1", [tenantId]);
    const result = await reconcileTenantRoleCatalog(pool, tenantSlug, "apply");
    expect(result.rolesCreated).toBe(2);
    expect(result.membershipChanges).toBe(0);
    expect(result.platformMappings).toBe(0);
    expect(result.foreignMappings).toBe(0);
    const roles = (await pool.query<{ name: string }>("SELECT name FROM role WHERE tenant_id=$1 ORDER BY name", [tenantId])).rows.map((row) => row.name);
    expect(roles).toContain("environmental_consultant");
    expect(roles).toContain("finance_officer");
    expect(roles).not.toContain("subcontractor");
    const permissions = (await pool.query<{ name: string }>(`SELECT p.name FROM role r JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.name='super_admin' ORDER BY p.name`, [tenantId])).rows.map((row) => row.name);
    expect(permissions).toEqual([...TENANT_SUPER_ADMIN_PERMISSION_MANIFEST].sort());
    expect((await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM membership WHERE tenant_id=$1", [tenantId])).rows[0]?.count).toBe(membershipCount.rows[0]?.count);
  });

  test("second reconciliation is a no-op and case variants are not created", async () => {
    const result = await reconcileTenantRoleCatalog(pool, tenantSlug, "apply");
    expect(result.noOp).toBe(true);
    expect(result.rolesCreated).toBe(0);
    expect(result.permissionsCreated).toBe(0);
    expect(result.mappingsCreated).toBe(0);
    const duplicates = await pool.query("SELECT lower(name) FROM role WHERE tenant_id=$1 GROUP BY lower(name) HAVING COUNT(*)>1", [tenantId]);
    expect(duplicates.rowCount).toBe(0);
    const audits = await pool.query("SELECT id FROM authz_audit_log WHERE tenant_id=$1 AND action='IAM_ROLE_CATALOG_RECONCILED'", [tenantId]);
    expect(audits.rowCount).toBe(1);
  });
});
