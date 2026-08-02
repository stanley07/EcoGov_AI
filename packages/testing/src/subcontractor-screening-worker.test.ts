import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { z } from "zod";
import { 
  OutboxEventDispatcher, 
  DeterministicModelProvider, 
  PolicyEngine, 
  AIExecutionOrchestrator,
  AgentRegistry,
  PromptRegistry
} from "@govos/ai";
import { ScreenSubcontractorApplicationHandler } from "@govos/core";
import { setupTestEnvironment, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Screening Worker Integration Tests", () => {
  let pool: Pool;
  let app: any;
  let agentRegistry: AgentRegistry;
  let promptRegistry: PromptRegistry;
  let orchestrator: AIExecutionOrchestrator;
  let handler: ScreenSubcontractorApplicationHandler;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;

    // Build registries specifically for testing
    agentRegistry = new AgentRegistry();
    promptRegistry = new PromptRegistry();
    const provider = new DeterministicModelProvider();
    const policyEngine = new PolicyEngine();
    orchestrator = new AIExecutionOrchestrator(pool, provider, policyEngine);

    // Register subcontractor screening prompt
    promptRegistry.register({
      templateId: "ecogov.subcontractor-screening-template",
      version: "1.0.0",
      content: "Verify subcontractor details:\n- Business Name: {{businessName}}\n- Licence Type: {{licenseType}}\n- Experience Years: {{experienceYears}}",
      status: "active",
      requiredVariables: ["businessName", "licenseType", "experienceYears"],
      optionalVariables: ["documents", "tool_output", "schema_error"],
      allowedAgents: ["ecogov.subcontractor-screening"],
      dataClassification: "internal",
    });

    // Register subcontractor screening agent
    agentRegistry.register({
      definition: {
        name: "ecogov.subcontractor-screening",
        version: "1.0.0",
        provider: "deterministic",
        model: "simulator",
        objective: "Verify subcontractor qualifications and assess compliance risk.",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
      },
      execute: async (input: any) => {
        const vars = input.variables || {};
        const businessName = vars.businessName || "";
        const isHighRisk = businessName.toLowerCase().includes("fail") || businessName.toLowerCase().includes("high_risk");
        const recommendation = isHighRisk ? "high_risk" : "recommended";
        const score = isHighRisk ? 30 : 90;
        return {
          data: {
            schemaVersion: "1",
            recommendation,
            score,
            criteria: [
              { code: "experience", score, weight: 0.5, explanation: "Proven active operation history" },
              { code: "credentials", score, weight: 0.5, explanation: "Standard regulatory documentation matches" }
            ],
            riskFlags: isHighRisk ? [{ code: "CRIT-FAIL", severity: "high", explanation: "Discovered critical compliance history flag" }] : [],
            summary: isHighRisk ? "Critical compliance risk discovered." : "Subcontractor satisfies baseline criteria."
          },
          usage: { inputTokens: 100, outputTokens: 80, estimatedCost: 0.0001 },
          latencyMs: 15,
          modelName: "deterministic-simulator",
          executionStatus: "succeeded",
        };
      },
    });

    handler = new ScreenSubcontractorApplicationHandler(
      pool,
      orchestrator,
      agentRegistry,
      promptRegistry
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Asynchronous worker processes outbox event and performs successful AI screening", async () => {
    const tenant = await createTestTenant(pool);

    // Create complete application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Eco Cleaners Ltd",
        registrationNumber: "REG-WORK-1",
        taxIdentifier: "TAX-WORK-1",
        contactEmail: "work@test.gov.ng",
        contactPhone: "0801122",
        operatingAddress: "Lagos",
        experienceYears: 4,
        licenseType: "environmental-consultant"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Upload document
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // Clear outbox to isolate
    await pool.query("DELETE FROM outbox_event WHERE tenant_id = $1", [tenant.id]);

    // Submit (places application in screening_queued state and commits outbox event)
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });

    // Instantiate and start outbox dispatcher hook
    const dispatcher = new OutboxEventDispatcher(pool);
    dispatcher.setDispatchCallback(async (event: any) => {
      if (event.event_type === "subcontractor_application.submitted") {
        await handler.handleScreening(event.payload, event.id);
      }
    });

    // Run outbox process manually in a loop until application state transitions from screening_queued
    for (let i = 0; i < 20; i++) {
      const statusCheck = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
      if (statusCheck.rows[0]?.status !== "screening_queued") {
        break;
      }
      await dispatcher.processPendingEvents();
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const appQueryAfter = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
    expect(appQueryAfter.rows[0]?.status).toBe("awaiting_officer_review");

    // Verify screening result stored with correct details
    const resultQuery = await pool.query("SELECT * FROM subcontractor_screening_result WHERE application_id = $1", [appId]);
    expect(resultQuery.rows.length).toBe(1);
    expect(resultQuery.rows[0].screening_status).toBe("completed");
    expect(resultQuery.rows[0].recommendation).toBe("recommended");
    expect(Number(resultQuery.rows[0].score)).toBe(90);
    
    // Verify provider details persisted
    expect(resultQuery.rows[0].provider_name).toBe("deterministic");
    expect(resultQuery.rows[0].provider_model).toBe("simulator");
    expect(resultQuery.rows[0].provider_model_version).toBe("1.0.0");
  });

  test("2. Asynchronous worker handles failed AI screening, sets status to screening_failed, and records provider identity", async () => {
    const tenant = await createTestTenant(pool);
    // Create complete application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Eco Failures Ltd",
        registrationNumber: "REG-FAIL-1",
        taxIdentifier: "TAX-FAIL-1",
        contactEmail: "fail@test.gov.ng",
        contactPhone: "0801122",
        operatingAddress: "Lagos",
        experienceYears: 4,
        licenseType: "environmental-consultant"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Upload document
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // Clear outbox to isolate
    await pool.query("DELETE FROM outbox_event WHERE tenant_id = $1", [tenant.id]);

    // Submit
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });

    // Temporarily mock handler's orchestrator to fail
    const originalOrchestrate = orchestrator.orchestrate;
    orchestrator.orchestrate = async () => {
      throw new Error("Simulated LLM outage or budget exhaustion");
    };

    try {
      const dispatcher = new OutboxEventDispatcher(pool);
      dispatcher.setDispatchCallback(async (event: any) => {
        if (event.event_type === "subcontractor_application.submitted") {
          try {
            await handler.handleScreening(event.payload, event.id);
          } catch (err) {
            // expect throw
          }
        }
      });

      for (let i = 0; i < 20; i++) {
        const statusCheck = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
        if (statusCheck.rows[0]?.status !== "screening_queued") {
          break;
        }
        await dispatcher.processPendingEvents();
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const appQueryAfter = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
      expect(appQueryAfter.rows[0]?.status).toBe("screening_failed");

      const resultQuery = await pool.query("SELECT * FROM subcontractor_screening_result WHERE application_id = $1", [appId]);
      expect(resultQuery.rows.length).toBe(1);
      expect(resultQuery.rows[0].screening_status).toBe("failed");
      expect(resultQuery.rows[0].provider_name).toBe("google"); // Default fallback
      expect(resultQuery.rows[0].provider_model).toBe("gemini-1.5-flash");
    } finally {
      orchestrator.orchestrate = originalOrchestrate;
    }
  });
});
