import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "@govos/api/app";
import * as crypto from "node:crypto";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

const mockConfig: Config = {
  appEnv: "local",
  database: { DATABASE_URL: connectionString },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic", GEMINI_MODEL_ID: "gemini-1.5-flash" },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
};

describe("Platform Agent Runtime Idempotency Integration Tests (Phase 5/7 Gate)", () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Deduplication replay and collision conflict validation", async () => {
    const apiApp = createApp(mockConfig, pool);

    // Setup active agent, version, prompt, contract in the DB
    const appKey = `app-idem-${Date.now()}`;
    const agentKey = `agent-idem-${Date.now()}`;

    const appRes = await pool.query(
      "INSERT INTO application (key, display_name) VALUES ($1, 'Idem App') RETURNING id",
      [appKey]
    );
    const appId = appRes.rows[0].id;

    const agentDefRes = await pool.query(
      "INSERT INTO agent_definition (key, display_name, owning_application_id) VALUES ($1, 'Idem Agent', $2) RETURNING id",
      [agentKey, appId]
    );
    const agentDefId = agentDefRes.rows[0].id;

    const promptDefRes = await pool.query(
      "INSERT INTO prompt_definition (key, owning_application_id) VALUES ($1, $2) RETURNING id",
      [`prompt-idem-${Date.now()}`, appId]
    );
    const promptDefId = promptDefRes.rows[0].id;

    const promptVersionRes = await pool.query(
      "INSERT INTO prompt_version (prompt_definition_id, version, template, variables_schema, content_hash, status) VALUES ($1, '1.0.0', 'Hello {{name}}', '{}', 'hash', 'active') RETURNING id",
      [promptDefId]
    );
    const pvId = promptVersionRes.rows[0].id;

    const contractDefRes = await pool.query(
      "INSERT INTO output_contract_definition (key, owning_application_id) VALUES ($1, $2) RETURNING id",
      [`contract-idem-${Date.now()}`, appId]
    );
    const contractDefId = contractDefRes.rows[0].id;

    const contractVersionRes = await pool.query(
      "INSERT INTO output_contract_version (output_contract_definition_id, version, json_schema, content_hash, status) VALUES ($1, '1.0.0', '{}', 'hash', 'active') RETURNING id",
      [contractDefId]
    );
    const cvId = contractVersionRes.rows[0].id;

    await pool.query(
      `INSERT INTO agent_version (
         agent_definition_id, version, prompt_version_id, output_contract_version_id, model_policy, safety_profile, status
       ) VALUES ($1, '1.0.0', $2, $3, '{}', '{}', 'active')`
    , [agentDefId, pvId, cvId]);

    // Fetch real user ID to satisfy session user FK constraint
    const userRes = await pool.query("SELECT id FROM user_account LIMIT 1");
    const userId = userRes.rows[0].id;

    // Create session to bypass auth check
    const token = `token-${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO session (tenant_id, user_id, token, expires_at, session_version) 
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', 1)`,
      [tenantId, userId, token]
    );

    const idempotencyKey = `idem-key-test-${crypto.randomUUID()}`;

    // First request -> 202 Accepted
    const res1 = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-tenant-code": tenantId,
      },
      payload: {
        applicationKey: appKey,
        agentKey: agentKey,
        variables: { test: "val" },
        idempotencyKey,
      },
    });

    expect(res1.statusCode).toBe(202);
    const body1 = JSON.parse(res1.body);
    expect(body1.executionId).toBeDefined();

    // Replay request -> 202 Accepted and same ID
    const res2 = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-tenant-code": tenantId,
      },
      payload: {
        applicationKey: appKey,
        agentKey: agentKey,
        variables: { test: "val" },
        idempotencyKey,
      },
    });

    expect(res2.statusCode).toBe(202);
    const body2 = JSON.parse(res2.body);
    expect(body2.executionId).toBe(body1.executionId);

    // Conflicting request with different payload -> 409 Conflict
    const res3 = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-tenant-code": tenantId,
      },
      payload: {
        applicationKey: appKey,
        agentKey: agentKey,
        variables: { test: "different-val" },
        idempotencyKey,
      },
    });

    expect(res3.statusCode).toBe(409);
  });
});
