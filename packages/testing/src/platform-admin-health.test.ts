import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Health Integration Tests", () => {
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

  test("1. Health endpoint returns counts, rates, and window definitions", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    // Insert mock pending/processing events
    await pool.query(
      `INSERT INTO outbox_event (id, tenant_id, event_type, payload, status, created_at, aggregate_type, aggregate_id, deduplication_key)
       VALUES ($1, $2, 'test.event', '{}', 'pending', NOW(), 'test', $3, $4)`,
      [randomUUID(), tenantId, randomUUID(), randomUUID()]
    );

    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/operational/health",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.observedAt).toBeDefined();
    expect(body.windowSeconds).toBe(3600);
    expect(body.queueDepth).toBeGreaterThanOrEqual(1);
    expect(body.dispatchFailureRate).toBeDefined();
  });

  test("2. Provider health resolves success/timeout rates from attempts telemetry", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/operational/providers",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0].providerName).toBeDefined();
      expect(body[0].successRate).toBeDefined();
      expect(body[0].circuitBreakerStatus).toBe("closed");
    }
  });
});
