import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  APPROVED_MEMBERSHIPS,
  CANONICAL_SUPER_ADMIN_PERMISSIONS,
  TEMPLATE_SUPER_ADMIN_ROLE_ID,
  remediateCrossTenantMemberships,
} from "../../../scripts/iam/remediate-cross-tenant-memberships.js";
import { rollbackCrossTenantMemberships } from "../../../scripts/iam/rollback-cross-tenant-memberships.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5433/govos_db";
const source = readFileSync(
  resolve(process.cwd(), "scripts/iam/remediate-cross-tenant-memberships.ts"),
  "utf8",
);
const thumbnailFixtureSource = readFileSync(
  resolve(process.cwd(), "packages/testing/src/facility-thumbnails.test.ts"),
  "utf8",
);
const registryFixtureSource = readFileSync(
  resolve(process.cwd(), "packages/testing/src/facility-registry-backend.test.ts"),
  "utf8",
);

describe.sequential("IAM-1R cross-tenant membership remediation", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE membership DISABLE TRIGGER ALL");
      await client.query(`
        INSERT INTO tenant (id, name, slug, type, status)
        VALUES ('00000000-0000-0000-0000-000000000001', 'Anambra State Ministry of Environment', 'anambra-state-ministry-of-environment', 'ministry', 'active')
        ON CONFLICT (id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO role (id, tenant_id, name, description, is_system)
        VALUES ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', 'super_admin', 'Full system management access', TRUE)
        ON CONFLICT (id) DO NOTHING
      `);
      for (const m of APPROVED_MEMBERSHIPS) {
        await client.query(`
          INSERT INTO tenant (id, name, slug, type, status)
          VALUES ($1, $2, $3, 'ministry', 'active')
          ON CONFLICT (id) DO NOTHING
        `, [m.tenantId, `Tenant for ${m.tenantId}`, `tenant-${m.tenantId.substring(0, 8)}`]);
        await client.query(`
          INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
          VALUES ($1, $2, $3, 'argon2id_placeholder', 'First', 'Last', 'active')
          ON CONFLICT (id) DO NOTHING
        `, [m.userId, m.tenantId, `user_${m.userId}@example.com`]);
        await client.query(`
          INSERT INTO membership (id, tenant_id, user_id, role_id, status)
          VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000501', 'active')
          ON CONFLICT (id) DO NOTHING
        `, [m.membershipId, m.tenantId, m.userId]);
        await client.query(`
          INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
          VALUES ($1, $2, 'IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED', $3, 'allow', $4::jsonb)
        `, [
          m.tenantId,
          m.userId,
          `membership:${m.membershipId}`,
          JSON.stringify({
            remediationVersion: "IAM-1R-v1",
            membershipId: m.membershipId,
            userId: m.userId,
            tenantId: m.tenantId,
            oldRoleId: "00000000-0000-0000-0000-000000000501",
            oldRoleTenantId: "00000000-0000-0000-0000-000000000001",
            newRoleId: "00000000-0000-0000-0000-000000000501",
            roleName: "super_admin",
            correlationId: "307a1607-b9bc-425e-8910-7ff3251989ac"
          })
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ids = APPROVED_MEMBERSHIPS.map(m => m.membershipId);
      const userIds = APPROVED_MEMBERSHIPS.map(m => m.userId);
      const tenantIds = APPROVED_MEMBERSHIPS.map(m => m.tenantId);
      await client.query("DELETE FROM authz_audit_log WHERE action = 'IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED'");
      await client.query("DELETE FROM membership WHERE id = ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM user_account WHERE id = ANY($1::uuid[])", [userIds]);
      await client.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [tenantIds]);
      await client.query("ALTER TABLE membership ENABLE TRIGGER ALL");
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  test("pins the exact approved 14-record decision set", () => {
    expect(APPROVED_MEMBERSHIPS).toHaveLength(14);
    expect(
      new Set(APPROVED_MEMBERSHIPS.map((item) => item.membershipId)).size,
    ).toBe(14);
    expect(
      new Set(APPROVED_MEMBERSHIPS.map((item) => item.tenantId)).size,
    ).toBe(14);
  });

  test("facility fixtures resolve roles within the membership tenant", () => {
    for (const fixtureSource of [thumbnailFixtureSource, registryFixtureSource]) {
      expect(fixtureSource).toContain(
        "SELECT id FROM role WHERE name = $1 AND tenant_id = $2",
      );
      expect(fixtureSource).toContain(
        "u.tenant_id = m.tenant_id AND r.tenant_id = m.tenant_id",
      );
      expect(fixtureSource).not.toContain(
        'pool.query("SELECT id FROM role WHERE name = $1", [roleName])',
      );
    }
  });

  test("facility fixture teardowns remove membership and test-role residue", () => {
    expect(thumbnailFixtureSource).toContain(
      "DELETE FROM membership WHERE tenant_id = ANY($1::uuid[])",
    );
    expect(thumbnailFixtureSource).toContain(
      "const tenantIds = [tenantAId, tenantBId]",
    );
    expect(registryFixtureSource).toContain(
      'DELETE FROM membership WHERE user_id = $1',
    );
    for (const fixtureSource of [thumbnailFixtureSource, registryFixtureSource]) {
      expect(fixtureSource).toContain("DELETE FROM role WHERE tenant_id =");
    }
  });

  test("defines complete tenant permissions without platform permissions", () => {
    expect(CANONICAL_SUPER_ADMIN_PERMISSIONS).toContain("user:read");
    expect(CANONICAL_SUPER_ADMIN_PERMISSIONS).toContain("user:mfa:reset");
    expect(CANONICAL_SUPER_ADMIN_PERMISSIONS).toContain("user:write");
    expect(
      CANONICAL_SUPER_ADMIN_PERMISSIONS.some((name) =>
        name.startsWith("platform."),
      ),
    ).toBe(false);
  });

  test("dry run validates creation/remapping and makes no mutations", async () => {
    const ids = APPROVED_MEMBERSHIPS.map((item) => item.membershipId);
    const before = await pool.query<{
      roles: string;
      sessions: string;
      audits: string;
    }>(
      `SELECT
         (SELECT string_agg(id::text || ':' || role_id::text, ',' ORDER BY id) FROM membership WHERE id=ANY($1::uuid[])) AS roles,
         (SELECT COUNT(*)::text FROM session s JOIN membership m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE m.id=ANY($1::uuid[])) AS sessions,
         (SELECT COUNT(*)::text FROM authz_audit_log WHERE action='IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED') AS audits`,
      [ids],
    );
    const result = await remediateCrossTenantMemberships(
      pool,
      "dry-run",
      "11111111-2222-3333-4444-555555555555",
    );
    const after = await pool.query<{
      roles: string;
      sessions: string;
      audits: string;
    }>(
      `SELECT
         (SELECT string_agg(id::text || ':' || role_id::text, ',' ORDER BY id) FROM membership WHERE id=ANY($1::uuid[])) AS roles,
         (SELECT COUNT(*)::text FROM session s JOIN membership m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE m.id=ANY($1::uuid[])) AS sessions,
         (SELECT COUNT(*)::text FROM authz_audit_log WHERE action='IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED') AS audits`,
      [ids],
    );
    expect(result.approvedRecordCount).toBe(14);
    if (result.noOp) {
      expect(result).toMatchObject({
        changedMemberships: 0,
        auditEventsWritten: 0,
      });
      expect(
        result.items.every(
          (item) => item.roleDisposition === "already-remediated",
        ),
      ).toBe(true);
    } else {
      expect(result).toMatchObject({
        changedMemberships: 14,
        auditEventsWritten: 14,
      });
      expect(
        result.items.every(
          (item) => item.oldRoleId === TEMPLATE_SUPER_ADMIN_ROLE_ID,
        ),
      ).toBe(true);
      expect(
        result.items.every((item) => item.roleDisposition === "create"),
      ).toBe(true);
    }
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  test("uses one serializable transaction and stops on every failure", () => {
    expect(source).toContain(
      'client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")',
    );
    expect(source).toContain('client.query("COMMIT")');
    expect(source).toContain('client.query("ROLLBACK")');
    expect(source).not.toContain("continue;");
  });

  test("seeds/reuses idempotently and remaps only exact reviewed rows", () => {
    expect(source).toMatch(/ON CONFLICT \(tenant_id,\s*name\) DO UPDATE/);
    expect(source).toMatch(
      /ON CONFLICT \(role_id,\s*permission_id\) DO NOTHING/,
    );
    expect(source).toContain(
      "WHERE id=$2 AND tenant_id=$3 AND user_id=$4 AND role_id=$5",
    );
    expect(source).toContain("Membership update race detected");
  });

  test("revokes only affected sessions and writes redacted audit evidence", () => {
    expect(source).toContain(
      "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",
    );
    expect(source).toContain("IAM_CROSS_TENANT_MEMBERSHIP_REMEDIATED");
    expect(source).not.toMatch(
      /password_hash|mfa_secret|recovery_code|token_hash/,
    );
  });

  test("implements safe no-op reruns and rollback-on-failure behavior", () => {
    expect(source).toContain('lifecycle === "complete"');
    expect(source).toContain("noOp: true");
    expect(source).toContain("Partial or unexpected remediation state");
    expect(source).toContain('await client.query("ROLLBACK").catch');
  });

  test("rollback dry run validates the ledger and makes no changes", async () => {
    const correlationId = "307a1607-b9bc-425e-8910-7ff3251989ac";
    const ids = APPROVED_MEMBERSHIPS.map((item) => item.membershipId);
    const before = await pool.query<{ roles: string }>(
      "SELECT string_agg(id::text || ':' || role_id::text, ',' ORDER BY id) AS roles FROM membership WHERE id=ANY($1::uuid[])",
      [ids],
    );
    const result = await rollbackCrossTenantMemberships(
      pool,
      "dry-run",
      correlationId,
    );
    const after = await pool.query<{ roles: string }>(
      "SELECT string_agg(id::text || ':' || role_id::text, ',' ORDER BY id) AS roles FROM membership WHERE id=ANY($1::uuid[])",
      [ids],
    );
    expect(result).toEqual({
      mode: "dry-run",
      restoredMemberships: 14,
      noOp: false,
    });
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
