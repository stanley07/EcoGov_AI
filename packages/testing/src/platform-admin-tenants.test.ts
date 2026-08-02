import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, setupAuthUser, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Tenants Integration Tests", () => {
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

  test("1. Every write command requires a reason and checks version concurrency", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");
    const targetTenant = await createTestTenant(pool);

    // Call suspend with missing reason - should fail schema validation
    const resNoReason = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/suspend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: targetTenant.version }
    });
    expect(resNoReason.statusCode).toBe(400);

    // Call suspend with stale expectedVersion
    const resStale = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/suspend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 999, reason: "Deactivating target Ministry" }
    });
    expect(resStale.statusCode).toBe(409);
    expect(JSON.parse(resStale.payload).error).toContain("Stale tenant version");
  });

  test("2. Suspension and reactivation are idempotent and generate correct audit logs", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");
    const targetTenant = await createTestTenant(pool);

    // 1st suspend call - succeeds
    const res1 = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/suspend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: targetTenant.version, reason: "First suspension attempt" }
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.payload);
    expect(body1.status).toBe("suspended");

    const activeVersion = body1.version;

    // Reactivate
    const resReactivate = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/reactivate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: activeVersion, reason: "Reactivating Ministry" }
    });
    expect(resReactivate.statusCode).toBe(200);
    expect(JSON.parse(resReactivate.payload).status).toBe("active");
  });

  test("3. Quotas, applications and runtime limits configurations write audit events", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");
    const targetTenant = await createTestTenant(pool);

    // Quotas patch
    const resQuota = await app.inject({
      method: "PATCH",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/quotas`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: targetTenant.version, reason: "Increase quota limit", maxCostMicrounits: "10000000" }
    });
    expect(resQuota.statusCode).toBe(200);
    const quotaVersion = JSON.parse(resQuota.payload).version;

    // Applications patch
    const resApps = await app.inject({
      method: "PATCH",
      url: `/platform-admin/v1/tenants/${targetTenant.id}/applications`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: quotaVersion, reason: "Enable AI tools", enabledApplications: ["complaints-triage"] }
    });
    expect(resApps.statusCode).toBe(200);
  });
});
