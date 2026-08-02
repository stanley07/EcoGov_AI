import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { AgentRegistryService } from "@govos/core";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Registry Integration Tests (Phase 2/7 Gate)", () => {
  let pool: Pool;
  let service: AgentRegistryService;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    service = new AgentRegistryService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Draft records can be edited, but active ones cannot", async () => {
    const appKey = `app-test-immutability-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Immutability Test App");
    const promptDefId = await service.createPromptDefinition("test_prompt", appId);
    const pvId = await service.createPromptVersion(promptDefId, "1.0.0", "Hello {{name}}", { name: "string" });

    await pool.query("UPDATE prompt_version SET template = 'Hello {{name}} v2' WHERE id = $1", [pvId]);
    const checkDraft = await pool.query("SELECT template FROM prompt_version WHERE id = $1", [pvId]);
    expect(checkDraft.rows[0].template).toBe("Hello {{name}} v2");

    await service.activatePromptVersion(pvId);

    await expect(
      pool.query("UPDATE prompt_version SET template = 'Hello {{name}} v3' WHERE id = $1", [pvId])
    ).rejects.toThrow("Immutable prompt version cannot be modified after activation");
  });

  test("2. Retired agent versions cannot be reactivated", async () => {
    const appKey = `app-test-retired-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Retired Test App");
    const agentDefId = await service.createAgentDefinition("test_agent", "Test Agent", appId);
    const promptDefId = await service.createPromptDefinition("test_prompt", appId);
    const contractDefId = await service.createOutputContractDefinition("test_contract", appId);

    const pvId = await service.createPromptVersion(promptDefId, "1.0.0", "Hello", {});
    const cvId = await service.createOutputContractVersion(contractDefId, "1.0.0", {});

    await service.activatePromptVersion(pvId);
    await service.activateOutputContractVersion(cvId);

    const avId = await service.createAgentVersion(agentDefId, "1.0.0", pvId, cvId, {}, {}, {
      timeout_seconds: 30,
      max_model_turns: 5,
      max_tool_calls: 3,
      max_input_tokens: 10000,
      max_output_tokens: 1000,
      max_tool_output_bytes: 10000
    });

    await service.activateAgentVersion(avId);
    await service.retireAgentVersion(avId);

    await expect(service.activateAgentVersion(avId)).rejects.toThrow(
      "Cannot activate a retired agent version"
    );
  });
});
