import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { AIExecutionService } from "@govos/ai";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Execution Integration Tests (Phase 3/7 Gate)", () => {
  let pool: Pool;
  let executionService: AIExecutionService;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    executionService = new AIExecutionService(pool);
    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Execution state machine transitions and sequence numbering", async () => {
    const execId = await executionService.createExecution({
      tenantId,
      agentName: "triage-agent",
      modelProvider: "deterministic",
      modelName: "deterministic-simulator",
      inputHash: "input-hash",
      actorType: "system",
      runtimeVersion: "1.0.0",
    });

    expect(execId).toBeDefined();

    // Transition: queued -> dispatched
    await executionService.transitionState(tenantId, execId, "dispatched", "Dispatched to worker queue");

    // Verify timeline events
    const timeline = await pool.query(
      "SELECT sequence_number, from_state, to_state FROM ai_execution_event WHERE ai_execution_id = $1 ORDER BY sequence_number",
      [execId]
    );

    expect(timeline.rows.length).toBe(1);
    expect(timeline.rows[0].sequence_number).toBe(1);
    expect(timeline.rows[0].from_state).toBe("queued");
    expect(timeline.rows[0].to_state).toBe("dispatched");
  });
});
