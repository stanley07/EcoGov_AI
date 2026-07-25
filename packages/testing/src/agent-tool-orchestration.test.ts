import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import {
  AIExecutionService,
  ExecutionAttemptService,
  ToolAuthorizationService,
  ToolExecutionService,
  OutputValidationService,
} from "@govos/ai";
import { z } from "zod";
import * as crypto from "node:crypto";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Tool Orchestration & Validation Tests (Phase 4 Gate)", () => {
  let pool: Pool;
  let executionService: AIExecutionService;
  let attemptService: ExecutionAttemptService;
  let authzService: ToolAuthorizationService;
  let toolService: ToolExecutionService;
  let validationService: OutputValidationService;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    executionService = new AIExecutionService(pool);
    attemptService = new ExecutionAttemptService(pool);
    authzService = new ToolAuthorizationService();
    toolService = new ToolExecutionService(pool);
    validationService = new OutputValidationService();

    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Static and runtime tool authorization", async () => {
    const requiredPerms = ["facility:write"];
    // Static rejection
    const auth1 = await authzService.authorizeToolCall(requiredPerms, ["facility:read"]);
    expect(auth1.authorized).toBe(false);
    expect(auth1.reasonCode).toBe("INSUFFICIENT_PERMISSIONS");

    // Static approval
    const auth2 = await authzService.authorizeToolCall(requiredPerms, ["facility:write"]);
    expect(auth2.authorized).toBe(true);
  });

  test("2. Denied tool calls never enter running state and record as denied", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "auth-test-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-auth",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    const attId = await attemptService.createAttempt({
      tenantId,
      executionId: execId,
      attemptNumber: 1,
      provider: "deterministic",
      model: "deterministic-simulator",
    });

    // Create a mock active tool version to reference
    const toolDefRes = await pool.query(
      "INSERT INTO tool_definition (key, category) VALUES ($1, 'utility') RETURNING id",
      [`tool-auth-${crypto.randomUUID()}`]
    );
    const toolDefId = toolDefRes.rows[0].id;

    const toolVerRes = await pool.query(
      `INSERT INTO tool_version (
         tool_definition_id, version, description, input_schema, required_permissions, retry_policy, redaction_policy, status
       ) VALUES ($1, '1.0.0', 'Auth test tool', '{}'::jsonb, '{}'::varchar[], '{}'::jsonb, '{}'::jsonb, 'active')
       RETURNING id`,
      [toolDefId]
    );
    const toolVerId = toolVerRes.rows[0].id;

    // Log denied tool invocation
    const invId = await toolService.createToolInvocation(
      tenantId,
      execId,
      attId,
      toolVerId,
      "call_denied_123",
      1,
      false, // authorized = false
      "INSUFFICIENT_PERMISSIONS",
      "args-hash",
      {}
    );

    // Verify record is created as 'denied'
    const checkInv1 = await pool.query("SELECT status, authorization_status, authorization_reason_code FROM ai_tool_invocation WHERE id = $1", [invId]);
    expect(checkInv1.rows[0].status).toBe("denied");
    expect(checkInv1.rows[0].authorization_status).toBe("denied");
    expect(checkInv1.rows[0].authorization_reason_code).toBe("INSUFFICIENT_PERMISSIONS");

    // Try starting it (should fail or not transition because it is denied)
    await expect(
      toolService.startToolInvocation(invId)
    ).resolves.not.toThrow();

    // Verify status remains 'denied' (since startToolInvocation only updates 'pending' status)
    const checkInv2 = await pool.query("SELECT status FROM ai_tool_invocation WHERE id = $1", [invId]);
    expect(checkInv2.rows[0].status).toBe("denied");
  });

  test("3. Input & output schema validation", async () => {
    const inputSchema = z.object({
      facilityId: z.string().uuid(),
    });

    // Valid inputs
    const check1 = validationService.validateZodSchema({ facilityId: crypto.randomUUID() }, inputSchema);
    expect(check1.valid).toBe(true);

    // Invalid inputs
    const check2 = validationService.validateZodSchema({ facilityId: "not-a-uuid" }, inputSchema);
    expect(check2.valid).toBe(false);
    expect(check2.errors).toBeDefined();
  });

  test("4. Provider tool-call deduplication at database level", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "dedup-test-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-dedup",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    const attId = await attemptService.createAttempt({
      tenantId,
      executionId: execId,
      attemptNumber: 1,
      provider: "deterministic",
      model: "deterministic-simulator",
    });

    // Create a mock active tool version
    const toolDefRes = await pool.query(
      "INSERT INTO tool_definition (key, category) VALUES ($1, 'utility') RETURNING id",
      [`tool-dedup-${crypto.randomUUID()}`]
    );
    const toolDefId = toolDefRes.rows[0].id;

    const toolVerRes = await pool.query(
      `INSERT INTO tool_version (
         tool_definition_id, version, description, input_schema, required_permissions, retry_policy, redaction_policy, status
       ) VALUES ($1, '1.0.0', 'Dedup test tool', '{}'::jsonb, '{}'::varchar[], '{}'::jsonb, '{}'::jsonb, 'active')
       RETURNING id`,
      [toolDefId]
    );
    const toolVerId = toolVerRes.rows[0].id;

    const providerCallId = "call_dedup_unique_123";

    // Insert first invocation
    await toolService.createToolInvocation(
      tenantId,
      execId,
      attId,
      toolVerId,
      providerCallId,
      1,
      true,
      null,
      "args-hash",
      {}
    );

    // Attempting to insert a duplicate provider tool call ID under the same attempt must throw a unique constraint error
    await expect(
      toolService.createToolInvocation(
        tenantId,
        execId,
        attId,
        toolVerId,
        providerCallId,
        2, // different sequence number
        true,
        null,
        "args-hash",
        {}
      )
    ).rejects.toThrow(); // Should trigger unique constraint: uq_tool_invocation_provider_call
  });

  test("5. Output contract validation checks", async () => {
    const contractSchema = {
      type: "object",
      properties: {
        riskRating: { type: "string" },
      },
      required: ["riskRating"],
    };

    // Valid stop output
    const check1 = validationService.validateJsonSchema({ riskRating: "low" }, contractSchema);
    expect(check1.valid).toBe(true);

    // Invalid output format
    const check2 = validationService.validateJsonSchema("not-an-object", contractSchema);
    expect(check2.valid).toBe(false);
  });
});
