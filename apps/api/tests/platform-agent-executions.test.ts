import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "@govos/api/app";

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

describe("Platform Agent API Executions Endpoint (Phase 5 Gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock behavior for session check
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "00000000-0000-0000-0000-000000000001",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return {
          rows: [
            {
              isSystem: false,
              status: "active",
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("1. Exposes POST /agent-executions and performs tenant check and resolves active agent", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("FROM agent_version")) {
        return {
          rows: [
            {
              version_id: "av-123",
              definition_id: "ad-123",
              application_id: "ap-123",
              timeout_seconds: 30,
              max_input_tokens: 5000,
              max_output_tokens: 1000,
              max_tool_output_bytes: 10000,
              model_policy: {},
              prompt_version: "1.0.0",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_reservation")) {
        return { rows: [{ id: "res-123" }] };
      }
      if (sql.includes("INSERT INTO ai_execution")) {
        return { rows: [{ id: "exec-123" }] };
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        applicationKey: "ecogov",
        agentKey: "complaint-triage",
        variables: {
          subject: "water pollution",
          description: "excessive mud",
        },
      },
    });

    expect(res.statusCode).toBe(202);
    const json = JSON.parse(res.payload);
    expect(json.executionId).toBe("exec-123");
    expect(json.status).toBe("queued");
  });

  it("2. Returns 404 if active agent version is not found", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("FROM agent_version")) {
        return { rows: [] }; // No active agent version found
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        applicationKey: "ecogov",
        agentKey: "invalid-agent",
        variables: { test: "data" },
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("3. Scoped idempotency replay and different payload conflict check", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("FROM agent_version")) {
        return {
          rows: [
            {
              version_id: "av-123",
              definition_id: "ad-123",
              application_id: "ap-123",
              timeout_seconds: 30,
              max_input_tokens: 5000,
              max_output_tokens: 1000,
              max_tool_output_bytes: 10000,
              model_policy: {},
              prompt_version: "1.0.0",
            },
          ],
        };
      }
      if (sql.includes("FROM ai_execution")) {
        return {
          rows: [
            {
              id: "exec-existing",
              request_hash: "e1d7c49f3a04e1ec1a5b150ec68041c903cd75fda52aa1239fd586439ef1154b", // hash of { test: "data" }
              current_state: "queued",
              execution_status: "running",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    
    // Exact match replay
    const resReplay = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        applicationKey: "ecogov",
        agentKey: "complaint-triage",
        variables: { test: "data" },
        idempotencyKey: "idem-key-123",
      },
    });

    expect(resReplay.statusCode).toBe(202);
    const jsonReplay = JSON.parse(resReplay.payload);
    expect(jsonReplay.executionId).toBe("exec-existing");

    // Different hash conflict -> 409
    const resConflict = await apiApp.inject({
      method: "POST",
      url: "/agent-executions",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        applicationKey: "ecogov",
        agentKey: "complaint-triage",
        variables: { test: "different-data" },
        idempotencyKey: "idem-key-123",
      },
    });

    expect(resConflict.statusCode).toBe(409);
  });

  it("4. GET /agent-executions/:id returns 200 with execution details, timeline, and attempts", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("FROM ai_execution e")) {
        return {
          rows: [
            {
              id: "exec-123",
              tenant_id: "ten-123",
              application_id: "ap-123",
              agent_definition_id: "ad-123",
              agent_version_id: "av-123",
              agent_name: "complaint-triage",
              model_provider: "deterministic",
              model_name: "deterministic-simulator",
              prompt_template_version: "1.0.0",
              actor_type: "user",
              actor_user_id: "usr-123",
              idempotency_key: "idem-123",
              request_hash: "hash-123",
              execution_status: "succeeded",
              validation_status: "valid",
              current_state: "succeeded",
              correlation_id: "corr-123",
              started_at: new Date(),
              completed_at: new Date(),
              timeline_events: [
                {
                  id: "evt-123",
                  from_state: "queued",
                  to_state: "running",
                  sequence_number: 1,
                  attempt_number: 1,
                  actor_type: "user",
                  event_description: "Started execution",
                },
              ],
              attempts: [
                {
                  id: "att-123",
                  attempt_number: 1,
                  provider: "deterministic",
                  model: "deterministic-simulator",
                  started_at: new Date(),
                  completed_at: new Date(),
                  input_tokens: 100,
                  output_tokens: 50,
                  actual_cost_microunits: 10,
                },
              ],
            },
          ],
        };
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "GET",
      url: "/agent-executions/exec-123",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.executionId).toBe("exec-123");
    expect(json.status).toBe("succeeded");
    expect(json.timelineEvents.length).toBe(1);
    expect(json.attempts.length).toBe(1);
  });

  it("5. GET /agent-executions/:id returns 404 if record is not found", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("FROM ai_execution e")) {
        return { rows: [] }; // Empty result
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "GET",
      url: "/agent-executions/exec-nonexistent",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("6. GET /platform-admin/agent-observability enforces tenant isolation for regular users", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-123",
              tenant_id: "ten-123",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["inspector"], // Not a platform admin
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      if (sql.includes("platform.audit.read")) {
        return { rows: [] }; // No platform permission
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "GET",
      url: "/platform-admin/agent-observability?tenantId=ten-other",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    expect(res.statusCode).toBe(403); // Forbidden access to other tenant's metrics
  });

  it("7. GET /platform-admin/agent-observability allows platform admin to access other tenants' metrics", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "usr-admin",
              tenant_id: "ten-admin",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: ["PLATFORM_SUPER_ADMIN"],
            },
          ],
        };
      }
      if (sql.includes("is_system")) {
        return { rows: [{ isSystem: false, status: "active" }] };
      }
      // Simulate hasPlatformPermission query
      if (sql.includes("platform_role_assignment")) {
        return { rows: [{ role_name: "PLATFORM_SUPER_ADMIN" }] };
      }
      if (sql.includes("COUNT(*)::int as total_executions")) {
        return {
          rows: [
            {
              total_executions: 12,
              succeeded_count: 10,
              failed_count: 2,
              total_input_tokens: 1200,
              total_output_tokens: 600,
              total_cost_minor_units: 50,
            },
          ],
        };
      }
      if (sql.includes("SELECT id, tenant_id, agent_name")) {
        return {
          rows: [
            {
              id: "exec-123",
              tenant_id: "ten-other",
              agent_name: "complaint-triage",
              execution_status: "succeeded",
              current_state: "succeeded",
              started_at: new Date(),
              completed_at: new Date(),
              token_input: 100,
              token_output: 50,
              estimated_cost_minor_units: 5,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const apiApp = createApp(mockConfig, mockPool);
    const res = await apiApp.inject({
      method: "GET",
      url: "/platform-admin/agent-observability?tenantId=ten-other",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.tenantId).toBe("ten-other");
    expect(json.metrics.totalExecutions).toBe(12);
    expect(json.items.length).toBe(1);
  });
});
