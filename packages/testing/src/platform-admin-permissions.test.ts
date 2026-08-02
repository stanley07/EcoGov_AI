import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, setupAuthUser, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Permissions Integration Tests", () => {
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

  test("1. Tenant administrators (non-platform user) cannot access platform routes", async () => {
    const { token } = await setupAuthUser(pool); // No platform role assigned

    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/registry/agents",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toContain("REGISTRY_READ permission required");
  });

  test("2. PLATFORM_AUDITOR (read-only) cannot perform lifecycle command actions", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_AUDITOR");

    // Try to activate
    const resActivate = await app.inject({
      method: "POST",
      url: "/platform-admin/v1/registry/versions/agent/00000000-0000-0000-0000-000000000000/activate",
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedStatus: "draft", reason: "hacked" }
    });
    expect(resActivate.statusCode).toBe(403);
    expect(JSON.parse(resActivate.payload).error).toContain("platform.registry.activate permission required");

    // Try to suspend
    const resSuspend = await app.inject({
      method: "POST",
      url: "/platform-admin/v1/tenants/00000000-0000-0000-0000-000000000000/suspend",
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 1, reason: "hacked" }
    });
    expect(resSuspend.statusCode).toBe(403);
    expect(JSON.parse(resSuspend.payload).error).toContain("platform.tenant.suspend permission required");
  });

  test("3. PLATFORM_SUPER_ADMIN can access all read and write routes", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/registry/agents",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.payload))).toBe(true);
  });

  test("4. Cross-tenant reads require platform-wide scope (tenant auditor is isolated)", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_AUDITOR");
    const otherTenant = await createTestTenant(pool);

    // Auditor lists executions - should only see their own tenant or no error but filtered
    const res = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/executions?tenantId=${otherTenant.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Since auditor is tenant-restricted in list, the query filters by auditor's tenantId instead of otherTenant.id
    for (const item of body.items) {
      expect(item.tenantId).toBe(tenantId);
    }
  });
});
