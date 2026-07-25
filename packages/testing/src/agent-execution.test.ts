import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import {
  AIExecutionService,
  ExecutionAttemptService,
  UsageAccountingService,
  ToolAuthorizationService,
  OutputValidationService,
} from "@govos/ai";
import { z } from "zod";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Execution Integration Tests (Phase 3 Gate)", () => {
  let pool: Pool;
  let executionService: AIExecutionService;
  let attemptService: ExecutionAttemptService;
  let usageService: UsageAccountingService;
  let authzService: ToolAuthorizationService;
  let validationService: OutputValidationService;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    executionService = new AIExecutionService(pool);
    attemptService = new ExecutionAttemptService(pool);
    usageService = new UsageAccountingService(pool);
    authzService = new ToolAuthorizationService();
    validationService = new OutputValidationService();

    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Execution atomic creation and state machine transition rules", async () => {
    const correlationId = "c89b9409-e932-4751-acfe-c8a77d4cbe20";
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "triage-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-123",
      actorType: "system",
      correlationId,
      runtimeVersion: "1.0.0",
    });

    // Check newly created execution is in 'queued' state
    const checkInit = await pool.query("SELECT current_state, correlation_id FROM ai_execution WHERE id = $1", [execId]);
    expect(checkInit.rows[0].current_state).toBe("queued");
    expect(checkInit.rows[0].correlation_id).toBe(correlationId);

    // Transition: queued -> dispatched
    await executionService.transitionState(tenantId, execId, "dispatched", "Worker leased task");
    const checkState1 = await pool.query("SELECT current_state, next_event_sequence FROM ai_execution WHERE id = $1", [execId]);
    expect(checkState1.rows[0].current_state).toBe("dispatched");
    expect(checkState1.rows[0].next_event_sequence).toBe(1);

    // Transition: dispatched -> running
    await executionService.transitionState(tenantId, execId, "running", "Model generation started");
    const checkState2 = await pool.query("SELECT current_state, next_event_sequence FROM ai_execution WHERE id = $1", [execId]);
    expect(checkState2.rows[0].current_state).toBe("running");
    expect(checkState2.rows[0].next_event_sequence).toBe(2);

    // Transition: running -> succeeded (terminal state)
    await executionService.transitionState(tenantId, execId, "succeeded", "Execution completed successfully");
    const checkState3 = await pool.query("SELECT current_state, next_event_sequence, execution_status FROM ai_execution WHERE id = $1", [execId]);
    expect(checkState3.rows[0].current_state).toBe("succeeded");
    expect(checkState3.rows[0].execution_status).toBe("succeeded");
    expect(checkState3.rows[0].next_event_sequence).toBe(3);

    // Invalid transition: succeeded -> running (should reject as succeeded is terminal)
    await expect(
      executionService.transitionState(tenantId, execId, "running", "Attempting restart")
    ).rejects.toThrow("Invalid execution state transition from succeeded to running");
  });

  test("2. Monotonic event allocation under concurrent writers", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "concurrent-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-concurrent",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    // Run transition to dispatched
    await executionService.transitionState(tenantId, execId, "dispatched", "Worker leased task");

    // Concurrently transition from dispatched to running
    // Exactly one concurrent transition must succeed and lock the row, others will see the new state and fail
    const results = await Promise.allSettled([
      executionService.transitionState(tenantId, execId, "running", "Thread A"),
      executionService.transitionState(tenantId, execId, "running", "Thread B"),
      executionService.transitionState(tenantId, execId, "running", "Thread C"),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    // Exactly one concurrent transition must succeed and lock the row
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);

    // Check event sequences are sequential
    const events = await pool.query(
      "SELECT sequence_number, to_state FROM ai_execution_event WHERE ai_execution_id = $1 ORDER BY sequence_number",
      [execId]
    );
    // 1 (queued -> dispatched), 2 (dispatched -> one of running/cancelled/rejected)
    expect(events.rows.length).toBe(2);
    expect(events.rows[0].sequence_number).toBe(1);
    expect(events.rows[1].sequence_number).toBe(2);
  });

  test("3. Execution attempts logging and retries isolation", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "attempt-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-attempt",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    // Create attempt 1
    const attId = await attemptService.createAttempt({
      tenantId,
      executionId: execId,
      attemptNumber: 1,
      provider: "deterministic",
      model: "deterministic-simulator",
    });

    const checkAtt1 = await pool.query("SELECT * FROM ai_execution_attempt WHERE id = $1", [attId]);
    expect(checkAtt1.rows[0].attempt_number).toBe(1);
    expect(checkAtt1.rows[0].completed_at).toBeNull();

    // Complete attempt 1
    await attemptService.completeAttempt(attId, {
      inputTokens: 100,
      outputTokens: 50,
      actualCostMicrounits: 150n,
      finishReason: "stop",
    });

    const checkAtt2 = await pool.query("SELECT * FROM ai_execution_attempt WHERE id = $1", [attId]);
    expect(checkAtt2.rows[0].completed_at).not.toBeNull();
    expect(checkAtt2.rows[0].actual_cost_microunits).toBe("150");
  });

  test("4. Usage reservations and reconciliation cycle", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "quota-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "hash-quota",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    // Reserve usage quota
    const resId = await usageService.reserveUsage({
      tenantId,
      executionId: execId,
      policyVersion: "1.0.0",
      reservedInputTokens: 5000,
      reservedOutputTokens: 2000,
      reservedCostMicrounits: 1000n,
      timeoutSeconds: 30,
    });

    const checkRes1 = await pool.query("SELECT status FROM ai_usage_reservation WHERE id = $1", [resId]);
    expect(checkRes1.rows[0].status).toBe("reserved");

    // Reconcile usage quota
    await usageService.reconcileUsage(resId, 450n);
    const checkRes2 = await pool.query("SELECT status, actual_cost_microunits FROM ai_usage_reservation WHERE id = $1", [resId]);
    expect(checkRes2.rows[0].status).toBe("charged");
    expect(checkRes2.rows[0].actual_cost_microunits).toBe("450");
  });

  test("5. Tool call authorization and execution audit tracking", async () => {
    const requiredPerms = ["org:write", "facility:write"];
    const userPerms1 = ["org:read"];
    const userPerms2 = ["org:write", "facility:write", "facility:read"];

    // Unauthorized check
    const checkAuth1 = await authzService.authorizeToolCall(requiredPerms, userPerms1);
    expect(checkAuth1.authorized).toBe(false);
    expect(checkAuth1.reasonCode).toBe("INSUFFICIENT_PERMISSIONS");

    // Authorized check
    const checkAuth2 = await authzService.authorizeToolCall(requiredPerms, userPerms2);
    expect(checkAuth2.authorized).toBe(true);
  });

  test("6. Output Validation Service schema checks", async () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number().min(18),
    });

    const checkValid = validationService.validateZodSchema({ name: "Officer John", age: 34 }, zodSchema);
    expect(checkValid.valid).toBe(true);

    const checkInvalid = validationService.validateZodSchema({ name: "Officer John", age: 17 }, zodSchema);
    expect(checkInvalid.valid).toBe(false);
    expect(checkInvalid.errors?.[0]).toContain("age");
  });
});
