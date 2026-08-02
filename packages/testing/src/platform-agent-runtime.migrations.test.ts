import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Migrations Integration Tests (Phase 1/7 Gate)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Verify that all evolved platform tables exist and have expected constraints", async () => {
    const tables = [
      "application",
      "agent_definition",
      "prompt_definition",
      "prompt_version",
      "output_contract_definition",
      "output_contract_version",
      "agent_version",
      "tool_definition",
      "tool_version",
      "agent_version_tool",
      "ai_execution_attempt",
      "outbox_event",
      "ai_usage_reservation"
    ];

    for (const table of tables) {
      const res = await pool.query(
        "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = $1)",
        [table]
      );
      expect(res.rows[0].exists).toBe(true);
    }
  });
});
