/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "../src/app.js";
import { RegistrationReviewTaskExecutor } from "@govos/worker/app";
import {
  AgentRegistry,
  PromptRegistry,
  ToolRegistry,
  DeterministicModelProvider,
} from "@govos/ai";

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

// Valid UUID helpers for route validation
const VALID_FACILITY_ID = "11b2b06d-bdad-4644-811f-80c1e3f9dadc";
const VALID_REGISTRATION_ID = "a9c59b40-e86c-41db-b5b4-277173372901";

describe("Workbench Projection Consistency Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default session mock to simulate logged-in inspector user
    mockQuery.mockImplementation(async (sql: string, _params: any[]) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  // 1. Queue Projection & Verification
  it("GET /workbench/queue returns consistent, correct data mapped from facility_registration base", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT 1 FROM tenant"))
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      if (sql.includes("FROM facility_registration")) {
        // Enforce database tenant scoping to trusted request tenant
        expect(params[0]).toBe("tenant-uuid-123");
        expect(sql).toContain("r.tenant_id = $1");
        expect(sql).toContain("f.tenant_id = r.tenant_id");

        return {
          rows: [
            {
              facilityId: VALID_FACILITY_ID,
              registrationId: VALID_REGISTRATION_ID,
              referenceNumber: "ASMOE-FAC-2026-A5064CB9",
              status: "officer_review",
              preliminaryRiskRating: "high",
              submittedAt: new Date("2026-07-23T16:56:03.636Z"),
              version: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "GET",
      url: "/workbench/queue?workflow=facility_registration",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.items.length).toBe(1);

    const item = data.items[0];
    expect(item.registrationId).not.toBe(item.facilityId);
    expect(item.registrationId).toBe(VALID_REGISTRATION_ID);
    expect(item.facilityId).toBe(VALID_FACILITY_ID);
    expect(item.referenceNumber).toBe("ASMOE-FAC-2026-A5064CB9");
    expect(item.status).toBe("officer_review");
    expect(item.preliminaryRiskRating).toBe("high");
    expect(item.version).toBe(2);
  });

  // 2. Reject Officer Decision using facility ID as registration ID
  it("POST /facilities/:id/review rejects request if facility ID is used as registration ID", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    mockQuery.mockImplementation(async (sql: string, _params: any[]) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      if (sql.includes("FROM facility_registration")) {
        // Return 0 rows to simulate registration not found
        return { rows: [] };
      }
      if (sql.includes("FROM facility")) {
        // Return 1 row to simulate facility ID match found
        return { rows: [{ id: VALID_FACILITY_ID }] };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "POST",
      url: `/facilities/${VALID_FACILITY_ID}/review`,
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        decision: "approve",
        version: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toBe(
      "Cannot review using facility ID; must use registration ID",
    );
  });

  // 3. Officer decision CAS validation conflict
  it("POST /facilities/:id/review rejects review if record version does not match (CAS conflict)", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    mockQuery.mockImplementation(async (sql: string, _params: any[]) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      if (sql.includes("FROM facility_registration")) {
        return {
          rows: [
            {
              id: VALID_REGISTRATION_ID,
              facility_id: VALID_FACILITY_ID,
              record_version: 5,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "POST",
      url: `/facilities/${VALID_REGISTRATION_ID}/review`,
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        decision: "approve",
        version: 4, // Stale version
      },
    });

    expect(res.statusCode).toBe(409);
    const data = JSON.parse(res.body);
    expect(data.error).toBe("record_version_conflict");
    expect(data.currentVersion).toBe(5);
  });

  // 4. Officer decision atomic updates
  it("POST /facilities/:id/review atomically updates facility_registration, facility, and review history", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    const capturedQueries: { text: string; values?: any[] }[] = [];

    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT 1 FROM tenant"))
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      if (sql.includes("FROM facility_registration")) {
        return {
          rows: [
            {
              id: VALID_REGISTRATION_ID,
              facility_id: VALID_FACILITY_ID,
              record_version: 2,
              preliminary_risk_rating: "high",
            },
          ],
        };
      }
      if (sql.includes("FROM workflow_instance")) {
        return { rows: [{ id: "wf-instance-uuid-123" }] };
      }
      if (sql.includes("FROM workflow_step_execution")) {
        return {
          rows: [
            {
              id: "step-exec-uuid-123",
              step_definition_id: "step-def-123",
              step_name: "officer_review",
              version_id: "version-123",
            },
          ],
        };
      }
      if (
        sql.includes("to_step_definition_id") ||
        sql.includes("workflow_transition")
      ) {
        return {
          rows: [
            {
              to_step_definition_id: "step-def-approved",
              to_step_name: "approved",
              is_terminal_step: true,
            },
          ],
        };
      }

      // Capture all modifying statements
      capturedQueries.push({ text: sql, values: params });

      if (sql.includes("UPDATE facility_registration")) {
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE facility")) {
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE registration_review")) {
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE workflow_step_execution")) {
        return { rows: [{ id: "step-exec-uuid-123" }] };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "POST",
      url: `/facilities/${VALID_REGISTRATION_ID}/review`,
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        decision: "approve",
        version: 2,
        officialRiskRating: "medium",
        notes: "Approved with corrections",
      },
    });

    if (res.statusCode !== 200) {
      console.log("Atomic updates test failed with body:", res.body);
    }

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.registrationId).toBe(VALID_REGISTRATION_ID);
    expect(data.status).toBe("approved");
    expect(data.version).toBe(3);

    // Verify all updates are executed
    const hasRegUpdate = capturedQueries.some((q) =>
      q.text.includes("UPDATE facility_registration"),
    );
    const hasFacUpdate = capturedQueries.some((q) =>
      q.text.includes("UPDATE facility"),
    );
    const hasReviewUpdate = capturedQueries.some((q) =>
      q.text.includes("UPDATE registration_review"),
    );

    expect(hasRegUpdate).toBe(true);
    expect(hasFacUpdate).toBe(true);
    expect(hasReviewUpdate).toBe(true);
  });

  // 5. Timeline lookups
  it("GET /workbench/:kind/:id/timeline prefers registration-linked workflows and falls back to facility", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    const queryLogs: string[] = [];

    mockQuery.mockImplementation(async (sql: string, _params: any[]) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "tenant-uuid-123",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      queryLogs.push(sql);

      if (sql.includes("FROM workflow_instance")) {
        if (sql.includes("entity_type = 'facility_registration'")) {
          // Simulate no registration-linked workflow found (first check fallback test)
          return { rows: [] };
        }
        if (sql.includes("entity_type = 'facility'")) {
          return { rows: [{ id: "legacy-wf-uuid" }] };
        }
      }
      if (sql.includes("FROM facility_registration")) {
        return { rows: [{ facility_id: VALID_FACILITY_ID }] };
      }
      return { rows: [] };
    });

    await apiApp.inject({
      method: "GET",
      url: `/workbench/registrations/${VALID_REGISTRATION_ID}/timeline`,
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    // Check that we first queried for facility_registration-linked workflow
    const firstCheckIndex = queryLogs.findIndex(
      (sql) =>
        sql.includes("FROM workflow_instance") &&
        sql.includes("entity_type = 'facility_registration'"),
    );
    // And fallback check for facility-linked workflow occurred afterwards
    const secondCheckIndex = queryLogs.findIndex(
      (sql) =>
        sql.includes("FROM workflow_instance") &&
        sql.includes("entity_type = 'facility'"),
    );

    expect(firstCheckIndex).toBeGreaterThan(-1);
    expect(secondCheckIndex).toBeGreaterThan(firstCheckIndex);
  });

  // 6. AI Review execution version increment
  it("AI completion task execution increments facility_registration.record_version exactly once", async () => {
    const agentRegistry = new AgentRegistry();
    const promptRegistry = new PromptRegistry();
    const toolRegistry = new ToolRegistry();

    // Mock registries with minimal elements
    agentRegistry.register({
      definition: {
        name: "ecogov.registration-review",
        version: "1.2.0",
        type: "orchestrator",
        description: "",
      },
      systemPrompt: "",
      tools: [],
    } as any);

    promptRegistry.register({
      templateId: "ecogov.facility-review",
      version: "1.0.0",
      content: "Review {{businessName}} {{category}}",
      status: "active",
      requiredVariables: ["businessName", "category", "address"],
      optionalVariables: [],
      allowedAgents: ["ecogov.registration-review"],
      dataClassification: "internal",
    });

    toolRegistry.register({
      definition: {
        name: "check_waste_disposal_permit",
        version: "1.0.0",
        description: "Lookup waste disposal permit",
        inputSchema: { type: "object", properties: {} },
      },
      execute: async () => ({ status: "valid", permitReference: "PERMIT-123" }),
    } as any);

    let regVersionUpdates = 0;

    mockQuery.mockImplementation(async (sql: string, _params?: any[]) => {
      if (sql.includes("SELECT 1 FROM tenant"))
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      console.log("TEST 6 QUERY:", sql);

      if (sql.includes("SELECT id, tenant_id")) {
        return {
          rows: [
            {
              id: VALID_FACILITY_ID,
              tenant_id: "tenant-1",
              businessName: "Sunrise Chemical",
              category: "chemical_processing",
              address: "Nnewi",
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
        return { rows: [{ id: "step-1" }] };
      }

      if (sql.includes("UPDATE facility_registration")) {
        expect(sql).toContain("record_version = record_version + 1");
        regVersionUpdates++;
        return { rowCount: 1 };
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

    const provider = new DeterministicModelProvider();
    vi.spyOn(provider, "generate").mockResolvedValue({
      content: "mock",
      structuredData: {
        recommendedCategory: "chemical_processing",
        categoryMatchesSubmission: true,
        detectedInconsistencies: [],
        missingDocuments: [],
        preliminaryRiskRating: "high",
        confidenceScore: 0.95,
        rationale: "Valid parameters",
        permitCheck: { status: "valid", permitReference: "PERMIT-123" },
        requiresOfficerAttention: false,
        attentionReasons: [],
      },
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
      modelName: "test-model",
      latencyMs: 1,
    });

    const result = await executor.execute({
      facilityId: VALID_FACILITY_ID,
      workflowId: "wf-123",
      workflowStepExecutionId: "step-123",
    });

    expect(result.status).toBe("succeeded");
    expect(regVersionUpdates).toBe(1); // Incremented exactly once
  });
});
