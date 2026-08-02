import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Usage Integration Tests", () => {
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

  test("1. Usage summary enforces date range limits", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/usage/summary?startDate=2026-01-01&endDate=2026-03-01",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toContain("Maximum date range is 31 days");
  });

  test("2. Ledger values distinguish estimates, reserved and actual microunits", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const execId = randomUUID();
    await pool.query(
      `INSERT INTO ai_execution (id, tenant_id, agent_name, execution_status, validation_status, model_provider, model_name, input_hash, started_at, actor_type)
       VALUES ($1, $2, 'ledger-agent', 'succeeded', 'valid', 'openai', 'gpt-4', 'hash-123', NOW(), 'system')`,
      [execId, tenantId]
    );

    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO ai_execution_attempt (
         id, ai_execution_id, tenant_id, attempt_number, provider, model, input_tokens, output_tokens,
         estimated_cost_microunits, actual_cost_microunits, started_at
       ) VALUES ($1, $2, $3, 1, 'openai', 'gpt-4', 100, 200, 5000, 4800, NOW())`,
      [attemptId, execId, tenantId]
    );

    // Call summary
    const res = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/usage/summary?tenantId=${tenantId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalInputTokens).toBe(100);
    expect(body.totalOutputTokens).toBe(200);
    expect(body.totalEstimatedCostMicrounits).toBe("5000");
    expect(body.totalActualCostMicrounits).toBe("4800");
  });
});
