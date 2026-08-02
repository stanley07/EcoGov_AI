import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { UsageAccountingService } from "@govos/ai";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Quota Integration Tests (Phase 6 Gate)", () => {
  let pool: Pool;
  let usageService: UsageAccountingService;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    usageService = new UsageAccountingService(pool);
    const tenantRes = await pool.query("SELECT id FROM tenant LIMIT 1");
    tenantId = tenantRes.rows[0]?.id || "00000000-0000-0000-0000-000000000001";
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createDummyExecution(): Promise<string> {
    const res = await pool.query(
      `INSERT INTO ai_execution (
         tenant_id, agent_name, model_provider, model_name, input_hash, actor_type, execution_status, validation_status, started_at
       ) VALUES ($1, 'dummy', 'deterministic', 'simulator', 'hash', 'system', 'running', 'pending', NOW())
       RETURNING id`,
      [tenantId]
    );
    return res.rows[0].id;
  }

  test("1. reserveUsage creates a new quota reservation", async () => {
    const executionId = await createDummyExecution();
    const reservationId = await usageService.reserveUsage({
      tenantId,
      executionId,
      policyVersion: "1.0.0",
      reservedInputTokens: 1000,
      reservedOutputTokens: 500,
      reservedCostMicrounits: 200n,
      timeoutSeconds: 30,
    });

    expect(reservationId).toBeDefined();

    const res = await pool.query(
      "SELECT status, reserved_input_tokens, expires_at FROM ai_usage_reservation WHERE id = $1",
      [reservationId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].status).toBe("reserved");
    expect(res.rows[0].reserved_input_tokens).toBe(1000);
  });

  test("2. releaseUsage frees the reservation", async () => {
    const executionId = await createDummyExecution();
    const reservationId = await usageService.reserveUsage({
      tenantId,
      executionId,
      policyVersion: "1.0.0",
      reservedInputTokens: 1000,
      reservedOutputTokens: 500,
      reservedCostMicrounits: 200n,
      timeoutSeconds: 30,
    });

    await usageService.releaseUsage(reservationId);

    const res = await pool.query(
      "SELECT status, reconciled_at FROM ai_usage_reservation WHERE id = $1",
      [reservationId]
    );

    expect(res.rows[0].status).toBe("released");
    expect(res.rows[0].reconciled_at).toBeDefined();
  });

  test("3. reconcileUsage charges the reservation actual cost", async () => {
    const executionId = await createDummyExecution();
    const reservationId = await usageService.reserveUsage({
      tenantId,
      executionId,
      policyVersion: "1.0.0",
      reservedInputTokens: 1000,
      reservedOutputTokens: 500,
      reservedCostMicrounits: 200n,
      timeoutSeconds: 30,
    });

    await usageService.reconcileUsage(reservationId, 150n);

    const res = await pool.query(
      "SELECT status, actual_cost_microunits, reconciled_at FROM ai_usage_reservation WHERE id = $1",
      [reservationId]
    );

    expect(res.rows[0].status).toBe("charged");
    expect(res.rows[0].actual_cost_microunits).toBe("150");
  });

  test("4. reclaimExpiredReservations transitions stale reservations to expired status", async () => {
    const executionId = await createDummyExecution();

    const seedRes = await pool.query(
      `INSERT INTO ai_usage_reservation (
         tenant_id, ai_execution_id, policy_version, reserved_input_tokens, reserved_output_tokens,
         reserved_cost_microunits, status, created_at, expires_at
       ) VALUES ($1, $2, '1.0.0', 100, 50, 10, 'reserved', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '1 minute')
       RETURNING id`,
      [tenantId, executionId]
    );
    const reservationId = seedRes.rows[0].id;

    await usageService.reclaimExpiredReservations();

    const res = await pool.query(
      "SELECT status, reconciled_at FROM ai_usage_reservation WHERE id = $1",
      [reservationId]
    );

    expect(res.rows[0].status).toBe("expired");
    expect(res.rows[0].reconciled_at).toBeDefined();
  });
});
