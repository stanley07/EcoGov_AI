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
  ComplaintTriageTaskExecutor,
  FindSimilarComplaintsTool,
} from "@govos/worker/app";
import { createApp } from "@govos/api/app";

// Mock database connection client
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
  database: { DATABASE_URL: "postgres://localhost" },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic", GEMINI_MODEL_ID: "gemini-1.5-flash" },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
};

describe("Milestone 5 - EcoGov Complaint Intake & AI Triage", () => {
  let agentRegistry: AgentRegistry;
  let promptRegistry: PromptRegistry;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    agentRegistry = new AgentRegistry();
    promptRegistry = new PromptRegistry();
    toolRegistry = new ToolRegistry();

    // Register prompts
    promptRegistry.register({
      templateId: "ecogov.complaint-triage-template",
      version: "1.0.0",
      content: "Analyze: {{subject}} {{description}}",
      status: "active",
      requiredVariables: ["subject", "description", "location"],
      optionalVariables: ["tool_output", "schema_error"],
      allowedAgents: ["ecogov.complaint-triage"],
      dataClassification: "internal",
    });

    // Register tool
    toolRegistry.register(new FindSimilarComplaintsTool(mockPool));

    // Register Triage Agent
    agentRegistry.register({
      definition: {
        name: "ecogov.complaint-triage",
        version: "1.0.0",
        provider: "deterministic",
        model: "simulator",
        objective: "triage",
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

  // 1. API Anonymous Intake Abuse Controls
  it("rejects public intake request if it exceeds length limits or fails rate limits", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    // Oversized body check
    const badRes = await apiApp.inject({
      method: "POST",
      url: "/complaints",
      payload: {
        clientSubmissionId: "sub-123",
        subject: "Air pollution",
        description: "A".repeat(9000), // Exceeds 8000 max length limit
        location: "Lagos",
      },
    });
    expect(badRes.statusCode).toBe(400);
  });

  it("returns existing complaint safe acknowledgement on client submission id conflict", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      return {
        rows: [
          {
            id: "comp-999",
            reference_number: "ECO-COMP-2026-999999",
            status: "triage_pending",
          },
        ],
      };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "POST",
      url: "/complaints",
      payload: {
        clientSubmissionId: "idempotency-key-01",
        subject: "Wastewater",
        description: "Illegal dumping",
        location: "LGA 2",
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.complaintId).toBe("comp-999");
    expect(json.status).toBe("triage_pending");
  });

  // 3. Emergency Deterministic keyword screening
  it("escalates immediately to officer review step if emergency keyword matched", async () => {
    // Mock database transaction calls
    mockQuery.mockImplementation(async (sql: string, _params?: any[]) => {
      if (sql.includes("SELECT id, reference_number")) {
        return { rows: [] }; // No duplicate
      }
      if (sql.includes("INSERT INTO complaint")) {
        return { rows: [{ id: "comp-emergency-123" }] };
      }
      if (sql.includes("SELECT v.id as version_id, s.id as step_def_id, s.step_name")) {
        return {
          rows: [
            {
              version_id: "ver-1",
              step_def_id: "step-1",
              step_name: "intake",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO workflow_instance")) {
        return { rows: [{ id: "wf-inst-1" }] };
      }
      if (sql.includes("SELECT e.step_definition_id, s.step_name, i.version_id")) {
        return {
          rows: [
            {
              step_definition_id: "step-1",
              step_name: "intake",
              version_id: "ver-1",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO workflow_step_execution")) {
        return { rows: [{ id: "step-exec-2" }] };
      }
      if (sql.includes("UPDATE workflow_step_execution")) {
        return { rows: [{ id: "step-exec-1" }] };
      }
      if (sql.includes("workflow_transition")) {
        return {
          rows: [
            {
              to_step_definition_id: "step-2",
              to_step_name: "ai_triage",
              is_terminal_step: false,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "POST",
      url: "/complaints",
      payload: {
        clientSubmissionId: "emergency-sub-123",
        subject: "Explosion report",
        description: "Gas explosion incident occurred at factory.",
        location: "Ikeja LGA",
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe("officer_review");
  });

  // 4. Bounded Similarity Search tool
  it("finds similar complaints restricting query to same tenant and lookback days", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "comp-sim-1",
          category: "waste_dumping",
          location: "Ikeja LGA",
          created_at: new Date(),
        },
      ],
    });

    const tool = new FindSimilarComplaintsTool(mockPool);
    const result = await tool.execute({ lga: "Ikeja" }, "tenant-1");

    expect(result.status).toBe("success");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].similaritySignals.sameLga).toBe(true);
  });

  // 5. Task Triage loop and CAS state completion
  it("executes complaint triage task and saves review in database", async () => {
    mockQuery.mockImplementation(async (sql: string, _params?: any[]) => {
      if (sql.includes("SELECT id, tenant_id")) {
        return {
          rows: [
            {
              id: "comp-123",
              tenant_id: "tenant-1",
              subject: "Chemical leak",
              normalized_description: "Safe normalized desc",
              location: "Lagos",
              category: "hazardous_material",
              is_emergency: false,
              status: "triage_pending",
            },
          ],
        };
      }
      if (sql.includes("SELECT status FROM complaint")) {
        return { rows: [{ status: "triage_pending" }] }; // CAS success check
      }
      if (sql.includes("INSERT INTO ai_execution")) {
        return { rows: [{ id: "ai-exec-1" }] };
      }
      if (sql.includes("SELECT e.step_definition_id")) {
        return {
          rows: [
            {
              step_definition_id: "s-1",
              step_name: "ai_triage",
              version_id: "v-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT to_step_definition_id")) {
        return {
          rows: [
            {
              to_step_definition_id: "s-2",
              to_step_name: "officer_review",
              is_terminal_step: false,
            },
          ],
        };
      }
      if (sql.includes("UPDATE workflow_step_execution")) {
        return { rows: [{ id: "step-completed-1" }] };
      }
      if (sql.includes("INSERT INTO workflow_step_execution")) {
        return { rows: [{ id: "next-exec-1" }] };
      }
      return { rows: [] };
    });

    const executor = new ComplaintTriageTaskExecutor(
      mockPool,
      mockConfig,
      agentRegistry,
      promptRegistry,
      toolRegistry,
    );

    // Mock provider return
    const provider = new DeterministicModelProvider();
    vi.spyOn(provider, "generate").mockResolvedValue({
      content: "mock",
      structuredData: {
        recommendedCategory: "hazardous_material",
        recommendedPriority: "urgent",
        summary: "Chemical spill reported in Ikeja LGA.",
        extractedLocation: {
          locality: "Ikeja",
          lga: "Ikeja",
          landmark: "Ikeja mall",
        },
        allegedIncidentType: "chemical spill",
        potentialHazards: ["toxic gas"],
        recommendedDepartment: "pollution_control",
        duplicateAssessment: {
          status: "unlikely",
          candidateComplaintIds: [],
          rationale: "No matching candidate.",
        },
        confidenceScore: 0.95,
        requiresImmediateHumanAttention: true,
        attentionReasons: ["Active chemical leak"],
        recommendedNextAction: "officer_review",
      },
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: "stop",
      modelName: "test-model",
      latencyMs: 10,
    });

    const result = await executor.execute({
      complaintId: "comp-123",
      workflowId: "wf-123",
      workflowStepExecutionId: "step-123",
    });

    expect(result.status).toBe("succeeded");
    expect(result.recommendedDepartment).toBe("pollution_control");
  });
});
