import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { AgentRegistryService } from "@govos/core";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Agent Registry Lifecycle & Verification Tests (Phase 2 Gate)", () => {
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
    
    // Create draft prompt version
    const pvId = await service.createPromptVersion(promptDefId, "1.0.0", "Hello {{name}}", { name: "string" });

    // Verify draft can be updated
    await pool.query("UPDATE prompt_version SET template = 'Hello {{name}} v2' WHERE id = $1", [pvId]);
    const checkDraft = await pool.query("SELECT template FROM prompt_version WHERE id = $1", [pvId]);
    expect(checkDraft.rows[0].template).toBe("Hello {{name}} v2");

    // Activate prompt version
    await service.activatePromptVersion(pvId);

    // Verify active prompt version CANNOT be updated (triggers immutability error)
    await expect(
      pool.query("UPDATE prompt_version SET template = 'Hello {{name}} v3' WHERE id = $1", [pvId])
    ).rejects.toThrow("Immutable prompt version cannot be modified after activation");
  });

  test("2. Active records cannot have protected content changed", async () => {
    const appKey = `app-test-protected-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Protected Test App");
    const contractDefId = await service.createOutputContractDefinition("test_contract", appId);

    const cvId = await service.createOutputContractVersion(contractDefId, "1.0.0", { type: "object" });
    await service.activateOutputContractVersion(cvId);

    await expect(
      pool.query("UPDATE output_contract_version SET json_schema = '{\"type\":\"string\"}'::jsonb WHERE id = $1", [cvId])
    ).rejects.toThrow("Immutable output contract version cannot be modified after activation");
  });

  test("3. Retired agent versions cannot be reactivated", async () => {
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

    // Verify cannot activate a retired agent version
    await expect(service.activateAgentVersion(avId)).rejects.toThrow(
      "Cannot activate a retired agent version"
    );
  });

  test("4. Agent version activation fails if prompt or contract belong to another application", async () => {
    const app1Key = `app1-${Date.now()}`;
    const app2Key = `app2-${Date.now()}`;
    const app1Id = await service.createApplication(app1Key, "App 1");
    const app2Id = await service.createApplication(app2Key, "App 2");

    const agentDefId = await service.createAgentDefinition("test_agent", "Test Agent", app1Id);
    const promptDefId = await service.createPromptDefinition("test_prompt", app2Id); // app2 owns prompt
    const contractDefId = await service.createOutputContractDefinition("test_contract", app1Id);

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

    await expect(service.activateAgentVersion(avId)).rejects.toThrow(
      "Mismatched owning application ownership"
    );
  });

  test("5. Limits cannot exceed platform-wide maximums", async () => {
    const appKey = `app-test-limits-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Limits Test App");
    const agentDefId = await service.createAgentDefinition("test_agent", "Test Agent", appId);

    await expect(
      service.createAgentVersion(agentDefId, "1.0.0", "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", {}, {}, {
        timeout_seconds: 301, // exceeds platform limit
        max_model_turns: 5,
        max_tool_calls: 3,
        max_input_tokens: 10000,
        max_output_tokens: 1000,
        max_tool_output_bytes: 10000
      })
    ).rejects.toThrow("timeout_seconds exceeds platform limit");

    await expect(
      service.createAgentVersion(agentDefId, "1.0.0", "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", {}, {}, {
        timeout_seconds: 30,
        max_model_turns: 21, // exceeds platform limit
        max_tool_calls: 3,
        max_input_tokens: 10000,
        max_output_tokens: 1000,
        max_tool_output_bytes: 10000
      })
    ).rejects.toThrow("max_model_turns exceeds platform limit");
  });

  test("6. Atomic activation and audit logs", async () => {
    const appKey = `app-test-atomic-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Atomic Test App");
    const agentDefId = await service.createAgentDefinition("test_agent", "Test Agent", appId);
    const promptDefId = await service.createPromptDefinition("test_prompt", appId);
    const contractDefId = await service.createOutputContractDefinition("test_contract", appId);

    const pvId = await service.createPromptVersion(promptDefId, "1.0.0", "Hello", {});
    const cvId = await service.createOutputContractVersion(contractDefId, "1.0.0", {});

    await service.activatePromptVersion(pvId);
    await service.activateOutputContractVersion(cvId);

    const avId = await service.createAgentVersion(agentDefId, "1.0.0", pvId, cvId, { model: "gemini" }, { safety: "high" }, {
      timeout_seconds: 30,
      max_model_turns: 5,
      max_tool_calls: 3,
      max_input_tokens: 10000,
      max_output_tokens: 1000,
      max_tool_output_bytes: 10000
    });

    await service.activateAgentVersion(avId);

    // Verify status is active
    const checkActive = await service.resolveActiveAgentVersion(agentDefId);
    expect(checkActive.status).toBe("active");

    // Verify audit logs was generated
    const auditRes = await pool.query(
      "SELECT * FROM authz_audit_log WHERE action = 'agent_version.activated' AND resource = $1",
      [`agent_version:${avId}`]
    );
    expect(auditRes.rows.length).toBe(1);
    
    // Verify no raw sensitive data or policy maps are logged
    const context = auditRes.rows[0].context;
    expect(context.promptVersionId).toBe(pvId);
    expect(context.modelPolicy).toBeUndefined(); // Sensitive policy metadata is excluded
  });

  test("7. New execution resolution rejects retired versions, but historical resolution returns them", async () => {
    const appKey = `app-test-resolution-${Date.now()}`;
    const appId = await service.createApplication(appKey, "Resolution Test App");
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

    // Active resolution should throw an error since no active version is left
    await expect(service.resolveActiveAgentVersion(agentDefId)).rejects.toThrow(
      "No active agent version found for this definition"
    );

    // Historical resolution should successfully return the retired version details
    const historical = await service.resolveHistoricalAgentVersion(avId);
    expect(historical.id).toBe(avId);
    expect(historical.status).toBe("retired");
  });
});
