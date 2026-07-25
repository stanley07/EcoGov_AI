import { describe, test, expect } from "vitest";
import { Pool } from "pg";
import { z } from "zod";
import { Config } from "@govos/configuration";
import { AgentRegistry, PromptRegistry, ToolRegistry } from "@govos/ai";
import { TaskRegistry } from "@govos/core";
import { createApp } from "../src/app.js";

const mockPool = {
  query: async () => ({
    rows: [
      {
        id: "task-rec-1",
        tenant_id: "tenant-1",
        task_id: "task-001",
        status: "pending",
        attempt_count: 1,
        max_attempts: 5,
      },
    ],
  }),
} as unknown as Pool;

const mockConfigLocal: Config = {
  appEnv: "local",
  database: { DATABASE_URL: "postgres://localhost:5432" },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic" },
  api: { PORT: 8080 },
  worker: {
    WORKER_PORT: 8081,
    WORKER_AUTH_MODE: "local",
  },
};

const mockConfigOidc: Config = {
  appEnv: "production",
  database: { DATABASE_URL: "postgres://localhost:5432" },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic" },
  api: { PORT: 8080 },
  worker: {
    WORKER_PORT: 8081,
    WORKER_AUTH_MODE: "oidc",
    WORKER_OIDC_AUDIENCE: "https://worker-prod-url",
  },
};

function getMockRegistries() {
  const agentRegistry = new AgentRegistry();
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(
    { name: "complaint_triage_job", version: "1.0.0", inputSchema: z.any() },
    { execute: async () => {} },
  );
  return { agentRegistry, taskRegistry };
}

describe("Worker Shell and Security Checks", () => {
  test("runs tasks successfully in local mode without OIDC credentials", async () => {
    const { agentRegistry, taskRegistry } = getMockRegistries();
    const promptRegistry = new PromptRegistry();
    const toolRegistry = new ToolRegistry();
    const app = createApp(
      mockConfigLocal,
      mockPool,
      agentRegistry,
      promptRegistry,
      toolRegistry,
      taskRegistry,
    );
    const res = await app.inject({
      method: "POST",
      url: "/internal/tasks/complaint_triage_job",
      payload: {
        taskId: "task-001",
        taskType: "complaint_triage_job",
        schemaVersion: 1,
        tenantId: "tenant-1",
        correlationId: "corr-123",
        createdAt: new Date().toISOString(),
        payload: { complaintId: "comp-1" },
      },
    });

    // In local mode, if task succeeds or skips double claiming it returns 200
    expect(res.statusCode).toBe(200);
  });

  test("rejects request if route taskType does not match payload", async () => {
    const { agentRegistry, taskRegistry } = getMockRegistries();
    const promptRegistry = new PromptRegistry();
    const toolRegistry = new ToolRegistry();
    const app = createApp(
      mockConfigLocal,
      mockPool,
      agentRegistry,
      promptRegistry,
      toolRegistry,
      taskRegistry,
    );
    const res = await app.inject({
      method: "POST",
      url: "/internal/tasks/complaint_triage_job",
      payload: {
        taskId: "task-001",
        taskType: "evidence_analysis_job", // Mismatch
        schemaVersion: 1,
        tenantId: "tenant-1",
        correlationId: "corr-123",
        createdAt: new Date().toISOString(),
        payload: { complaintId: "comp-1" },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test("rejects request without Authorization header in OIDC mode", async () => {
    const { agentRegistry, taskRegistry } = getMockRegistries();
    const promptRegistry = new PromptRegistry();
    const toolRegistry = new ToolRegistry();
    const app = createApp(
      mockConfigOidc,
      mockPool,
      agentRegistry,
      promptRegistry,
      toolRegistry,
      taskRegistry,
    );
    const res = await app.inject({
      method: "POST",
      url: "/internal/tasks/complaint_triage_job",
      payload: {
        taskId: "task-002",
        taskType: "complaint_triage_job",
        schemaVersion: 1,
        tenantId: "tenant-1",
        correlationId: "corr-123",
        createdAt: new Date().toISOString(),
        payload: { complaintId: "comp-2" },
      },
    });

    // Returns 401 due to missing OIDC header in production
    expect(res.statusCode).toBe(401);
  });
});
