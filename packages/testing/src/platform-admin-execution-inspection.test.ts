import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Execution Inspection Integration Tests", () => {
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

  test("1. Payloads are redacted by default in execution details and lists", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    // Insert mock execution with sensitive payload data
    const execId = randomUUID();
    await pool.query(
      `INSERT INTO ai_execution (
         id, tenant_id, agent_name, execution_status, validation_status, started_at, completed_at,
         prompt_template_version, input_hash, estimated_cost_minor_units, model_provider, model_name, actor_type
       ) VALUES ($1, $2, 'test-redact-agent', 'succeeded', 'valid', NOW(), NOW(), 'prompt-1.0.0', 'hash123', 5, 'openai', 'gpt-4', 'system')`,
      [execId, tenantId]
    );

    // Fetch list
    const resList = await app.inject({
      method: "GET",
      url: "/platform-admin/v1/executions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(resList.statusCode).toBe(200);
    const listBody = JSON.parse(resList.payload);
    expect(listBody.items.length).toBeGreaterThan(0);
    
    // Fetch details
    const resDetails = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/executions/${execId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(resDetails.statusCode).toBe(200);
    const detailBody = JSON.parse(resDetails.payload);
    
    // Verify sensitive keys are not exposed
    expect(detailBody.promptTemplateVersion).toBeUndefined();
    expect(detailBody.inputHash).toBeUndefined();
  });

  test("2. Privileged sensitive view POST requires a reason, creates audit event, and sets no-store", async () => {
    const { token, tenantId, userId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const execId = randomUUID();
    await pool.query(
      `INSERT INTO ai_execution (
         id, tenant_id, agent_name, execution_status, validation_status, started_at, completed_at,
         prompt_template_version, input_hash, estimated_cost_minor_units, model_provider, model_name, actor_type
       ) VALUES ($1, $2, 'triage-agent', 'failed', 'invalid', NOW(), NOW(), 'p-v1', 'hash-12345', 10, 'openai', 'gpt-4', 'system')`,
      [execId, tenantId]
    );

    // Call sensitive view without reason - should fail validation
    const resNoReason = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/executions/${execId}/sensitive-view`,
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(resNoReason.statusCode).toBe(400);

    // Call with reason
    const resWithReason = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/executions/${execId}/sensitive-view`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "Debugging failed classification model output" }
    });

    expect(resWithReason.statusCode).toBe(200);
    expect(resWithReason.headers["cache-control"]).toBe("no-store");

    const body = JSON.parse(resWithReason.payload);
    expect(body.unredactedData.promptTemplateVersion).toBe("p-v1");
    expect(body.unredactedData.inputHash).toBe("hash-12345");

    // Verify audit log entry was written
    const auditRes = await pool.query(
      "SELECT * FROM authz_audit_log WHERE action = 'agent_execution.sensitive_view' AND user_id = $1",
      [userId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].context.reason).toBe("Debugging failed classification model output");
  });

  test("3. Retry graph prevents cycle traversals", async () => {
    const { token, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    // Create a cycle of executions (parent-child relationship): A -> B -> A
    const idA = randomUUID();
    const idB = randomUUID();

    await pool.query(
      `INSERT INTO ai_execution (id, tenant_id, agent_name, execution_status, validation_status, parent_execution_id, model_provider, model_name, input_hash, started_at, actor_type)
       VALUES ($1, $2, 'agent', 'failed', 'invalid', NULL, 'openai', 'gpt-4', 'hash-cycle', NOW(), 'system')`,
      [idB, tenantId]
    );
    await pool.query(
      `INSERT INTO ai_execution (id, tenant_id, agent_name, execution_status, validation_status, parent_execution_id, model_provider, model_name, input_hash, started_at, actor_type)
       VALUES ($1, $2, 'agent', 'failed', 'invalid', $3, 'openai', 'gpt-4', 'hash-cycle', NOW(), 'system')`,
      [idA, tenantId, idB]
    );
    await pool.query(
      `UPDATE ai_execution SET parent_execution_id = $1 WHERE id = $2`,
      [idA, idB]
    );

    const res = await app.inject({
      method: "GET",
      url: `/platform-admin/v1/executions/${idA}/retry-graph`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Cycle check: the recursion should stop without causing an infinite loop
    expect(body.nodes.length).toBeLessThan(10);
  });
});
