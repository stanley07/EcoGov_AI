/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { Pool } from "pg";
import {
  AgentRegistry,
  PromptRegistry,
  ToolRegistry,
  DeterministicModelProvider,
} from "@govos/ai";
import { Config } from "@govos/configuration";
import {
  RegistrationReviewTaskExecutor,
  DeterministicWastePermitLookup,
} from "@govos/worker/app";

// Mock PostgreSQL pool client
const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  release: vi.fn(),
};

const mockPool = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(mockClient),
} as unknown as Pool;

const mockConfig: Config = {
  appEnv: "local",
  database: { DATABASE_URL: "postgres://localhost:5432" },
  observability: { LOG_LEVEL: "info" },
  ai: {
    AI_PROVIDER: "deterministic",
    GEMINI_MODEL_ID: "gemini-1.5-flash",
  },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
};

describe("Milestone 4 - EcoGov Registration Agent integration", () => {
  let agentRegistry: AgentRegistry;
  let promptRegistry: PromptRegistry;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    agentRegistry = new AgentRegistry();
    promptRegistry = new PromptRegistry();
    toolRegistry = new ToolRegistry();

    // Register test prompts
    promptRegistry.register({
      templateId: "ecogov.facility-review",
      version: "1.0.0",
      content: "Review {{businessName}} {{category}}",
      status: "active",
      requiredVariables: ["businessName", "category", "address"],
      optionalVariables: ["tool_output", "schema_error"],
      allowedAgents: ["ecogov.registration-review"],
      dataClassification: "internal",
    });

    // Register tools
    toolRegistry.register(new DeterministicWastePermitLookup());

    // Register Agents
    agentRegistry.register({
      definition: {
        name: "ecogov.registration-review",
        version: "1.2.0",
        provider: "deterministic",
        model: "simulator",
        objective: "audit",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
      },
      execute: async (input) => ({
        data: input,
        usage: { inputTokens: 10, outputTokens: 5, estimatedCost: 0.0001 },
        latencyMs: 1,
        modelName: "deterministic-simulator",
        executionStatus: "succeeded",
      }),
    });
  });

  // 1. Task Claiming and Compare-and-set updates
  it("executes the registration review task and advances workflow using CAS", async () => {
    // Mock database responses
    mockQuery.mockImplementation(async (sql: string, _params?: any[]) => {
      if (sql.includes("SELECT 1 FROM tenant"))
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("SELECT id, tenant_id")) {
        return {
          rows: [
            {
              id: "fac-123",
              tenant_id: "tenant-1",
              businessName: "Lagos Car Wash",
              category: "Car Wash",
              address: "Ikeja LGA, Lagos",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_execution")) {
        return { rows: [{ id: "ai-exec-1" }] };
      }
      if (sql.includes("INSERT INTO registration_review")) {
        return { rows: [{ id: "review-1" }] };
      }
      if (sql.includes("SELECT e.step_definition_id")) {
        return {
          rows: [
            {
              step_definition_id: "step-def-1",
              step_name: "ai_review",
              version_id: "version-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT to_step_definition_id")) {
        return {
          rows: [
            {
              to_step_definition_id: "step-def-2",
              to_step_name: "officer_review",
              is_terminal_step: false,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO workflow_step_execution")) {
        return { rows: [{ id: "next-exec-1" }] };
      }
      if (sql.includes("UPDATE workflow_step_execution")) {
        return { rows: [{ id: "step-1" }] }; // CAS success
      }
      return { rows: [] };
    });

    const executor = new RegistrationReviewTaskExecutor(
      mockPool,
      mockConfig,
      agentRegistry,
      promptRegistry,
      toolRegistry,
    );

    // Mock orchestrator resolution return
    const provider = new DeterministicModelProvider();
    vi.spyOn(provider, "generate").mockResolvedValue({
      content: "mock",
      structuredData: {
        recommendedCategory: "car_wash",
        categoryMatchesSubmission: true,
        detectedInconsistencies: [],
        missingDocuments: [],
        preliminaryRiskRating: "low",
        confidenceScore: 0.95,
        rationale: "Valid car wash details",
        permitCheck: {
          status: "valid",
          permitReference: "WMP-123",
        },
        requiresOfficerAttention: false,
        attentionReasons: [],
      },
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: "stop",
      modelName: "test-model",
      latencyMs: 10,
    });

    const result = await executor.execute({
      facilityId: "fac-123",
      workflowId: "wf-123",
      workflowStepExecutionId: "step-123",
    });

    expect(result.status).toBe("succeeded");
    expect(mockQuery).toHaveBeenCalled();
  });

  // 2. Cross-tenant blocks
  it("fails execution if stale worker fails compare-and-set query", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT 1 FROM tenant"))
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("SELECT id, tenant_id")) {
        return {
          rows: [
            {
              id: "fac-123",
              tenant_id: "tenant-1",
              businessName: "Lagos Car Wash",
              category: "Car Wash",
              address: "Ikeja LGA, Lagos",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_execution")) {
        return { rows: [{ id: "ai-exec-1" }] };
      }
      if (sql.includes("SELECT e.step_definition_id")) {
        return {
          rows: [
            {
              step_definition_id: "step-def-1",
              step_name: "ai_review",
              version_id: "version-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT to_step_definition_id")) {
        return {
          rows: [
            {
              to_step_definition_id: "step-def-2",
              to_step_name: "officer_review",
              is_terminal_step: false,
            },
          ],
        };
      }
      if (sql.includes("UPDATE workflow_step_execution")) {
        return { rows: [] }; // CAS returns 0 rows (lease or step altered elsewhere)
      }
      return { rows: [] };
    });

    const executor = new RegistrationReviewTaskExecutor(
      mockPool,
      mockConfig,
      agentRegistry,
      promptRegistry,
      toolRegistry,
    );

    await expect(
      executor.execute({
        facilityId: "fac-123",
        workflowId: "wf-123",
        workflowStepExecutionId: "step-123",
      }),
    ).rejects.toThrow("Failed to transition workflow step");
  });
});
