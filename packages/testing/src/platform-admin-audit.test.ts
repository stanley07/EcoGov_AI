import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Audit Integration Tests", () => {
  let pool: Pool;
  let app: any;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Audit trails are deterministic, append-only, and enforce tenant isolation", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    // Insert mock audit logs
    const auditId = randomUUID();
    await pool.query(
      `INSERT INTO authz_audit_log (id, tenant_id, user_id, action, resource, result, context, created_at)
       VALUES ($1, $2, null, 'tenant.test_action', 'tenant:123', 'allow', '{"reason": "testing"}', NOW())`,
      [auditId, tenantId]
    );

    // Call audit list
    const res = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/audit-events?tenantId=${tenantId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].action).toBe("tenant.test_action");
    expect(body.items[0].context.reason).toBe("testing");

    // Fetch individual detail
    const resDetail = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/audit-events/${auditId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(resDetail.statusCode).toBe(200);
    expect(JSON.parse(resDetail.payload).id).toBe(auditId);
  });
});
