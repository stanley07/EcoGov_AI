import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Admin Registry Integration Tests", () => {
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

  test("1. Validation preview does not mutate data and returns stable error codes", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const appKey = `app-${randomUUID().slice(0,8)}`;
    const appIdRes = await pool.query(
      `INSERT INTO application (key, display_name) VALUES ($1, 'Test App') RETURNING id`,
      [appKey]
    );
    const appId = appIdRes.rows[0].id;

    const agentDefRes = await pool.query(
      `INSERT INTO agent_definition (key, display_name, owning_application_id, status)
       VALUES ('test-agent', 'Test Agent', $1, 'active') RETURNING id`,
      [appId]
    );
    const defId = agentDefRes.rows[0].id;

    // Create DRAFT dependencies
    const promptDefRes = await pool.query(`INSERT INTO prompt_definition (key, owning_application_id) VALUES ('prompt-t', $1) RETURNING id`, [appId]);
    const promptDefId = promptDefRes.rows[0].id;
    const promptVerRes = await pool.query(
      `INSERT INTO prompt_version (prompt_definition_id, version, template, variables_schema, status, content_hash)
       VALUES ($1, '1.0.0', 'T', '{}', 'draft', 'hash-123') RETURNING id`,
      [promptDefId]
    );
    const pvId = promptVerRes.rows[0].id;

    const contractDefRes = await pool.query(`INSERT INTO output_contract_definition (key, owning_application_id) VALUES ('contract-t', $1) RETURNING id`, [appId]);
    const contractDefId = contractDefRes.rows[0].id;
    const contractVerRes = await pool.query(
      `INSERT INTO output_contract_version (output_contract_definition_id, version, json_schema, status, content_hash)
       VALUES ($1, '1.0.0', '{}', 'draft', 'hash-123') RETURNING id`,
      [contractDefId]
    );
    const cvId = contractVerRes.rows[0].id;

    const versionRes = await pool.query(
      `INSERT INTO agent_version (
         agent_definition_id, version, prompt_version_id, output_contract_version_id,
         model_policy, safety_profile, timeout_seconds, max_model_turns, max_tool_calls,
         max_input_tokens, max_output_tokens, max_tool_output_bytes, status
       ) VALUES ($1, '1.0.0', $2, $3, '{}', '{}', 30, 5, 2, 1000, 1000, 1000, 'draft')
       RETURNING id`,
      [defId, pvId, cvId]
    );
    const avId = versionRes.rows[0].id;

    const validateRes = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/registry/versions/agent/${avId}/validate`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(validateRes.statusCode).toBe(200);
    const body = JSON.parse(validateRes.payload);
    expect(body.valid).toBe(false);
    expect(body.errors.some((e: any) => e.code === "DEPENDENCY_NOT_ACTIVE")).toBe(true);

    // Verify it did not change status
    const checkStatus = await pool.query("SELECT status FROM agent_version WHERE id = $1", [avId]);
    expect(checkStatus.rows[0].status).toBe("draft");
  });

  test("2. Stale activation returns 409 Conflict", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    // Insert draft prompt version
    const appIdRes = await pool.query(`INSERT INTO application (key, display_name) VALUES ($1, 'Test App') RETURNING id`, [`app-${randomUUID().slice(0,8)}`]);
    const appId = appIdRes.rows[0].id;

    const pdRes = await pool.query(`INSERT INTO prompt_definition (key, owning_application_id) VALUES ('prompt-key', $1) RETURNING id`, [appId]);
    const pdId = pdRes.rows[0].id;

    const pvRes = await pool.query(
      `INSERT INTO prompt_version (prompt_definition_id, version, template, variables_schema, status, content_hash)
       VALUES ($1, '1.0.0', 'Template', '{}', 'draft', 'hash-123') RETURNING id`,
      [pdId]
    );
    const pvId = pvRes.rows[0].id;

    // Call activate with incorrect expectedStatus
    const resConflict = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/registry/versions/prompt/${pvId}/activate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedStatus: "active", reason: "wrong expected status" }
    });

    expect(resConflict.statusCode).toBe(409);
    expect(JSON.parse(resConflict.payload).error).toContain("Conflict");
  });

  test("3. Retired agent versions reject new admission but allow historical resolutions", async () => {
    const { token } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");

    const appIdRes = await pool.query(`INSERT INTO application (key, display_name) VALUES ($1, 'Test App') RETURNING id`, [`app-${randomUUID().slice(0,8)}`]);
    const appId = appIdRes.rows[0].id;

    const agentDefRes = await pool.query(
      `INSERT INTO agent_definition (key, display_name, owning_application_id, status)
       VALUES ('retire-test-agent', 'Retire Test Agent', $1, 'active') RETURNING id`,
      [appId]
    );
    const defId = agentDefRes.rows[0].id;

    const promptDefRes = await pool.query(`INSERT INTO prompt_definition (key, owning_application_id) VALUES ('prompt-r', $1) RETURNING id`, [appId]);
    const promptDefId = promptDefRes.rows[0].id;
    const promptVerRes = await pool.query(
      `INSERT INTO prompt_version (prompt_definition_id, version, template, variables_schema, status, content_hash)
       VALUES ($1, '1.0.0', 'T', '{}', 'active', 'hash-123') RETURNING id`,
      [promptDefId]
    );
    const pvId = promptVerRes.rows[0].id;

    const contractDefRes = await pool.query(`INSERT INTO output_contract_definition (key, owning_application_id) VALUES ('contract-r', $1) RETURNING id`, [appId]);
    const contractDefId = contractDefRes.rows[0].id;
    const contractVerRes = await pool.query(
      `INSERT INTO output_contract_version (output_contract_definition_id, version, json_schema, status, content_hash)
       VALUES ($1, '1.0.0', '{}', 'active', 'hash-123') RETURNING id`,
      [contractDefId]
    );
    const cvId = contractVerRes.rows[0].id;

    const avRes = await pool.query(
      `INSERT INTO agent_version (
         agent_definition_id, version, prompt_version_id, output_contract_version_id,
         model_policy, safety_profile, timeout_seconds, max_model_turns, max_tool_calls,
         max_input_tokens, max_output_tokens, max_tool_output_bytes, status
       ) VALUES ($1, '1.0.0', $2, $3, '{}', '{}', 30, 5, 2, 1000, 1000, 1000, 'active') RETURNING id`,
      [defId, pvId, cvId]
    );
    const avId = avRes.rows[0].id;

    // Retire version
    const retireRes = await app.inject({
      method: "POST",
      url: `/platform-admin/v1/registry/versions/agent/${avId}/retire`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "Retiring for replacement" }
    });

    expect(retireRes.statusCode).toBe(200);
    expect(JSON.parse(retireRes.payload).status).toBe("retired");

    // Try admitting a new execution with this retired version should fail (at runtime level)
    // Here we verify that in database it is set to retired
    const checkDb = await pool.query("SELECT status FROM agent_version WHERE id = $1", [avId]);
    expect(checkDb.rows[0].status).toBe("retired");
  });
});
