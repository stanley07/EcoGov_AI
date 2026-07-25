import { describe, test, expect, vi } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "../src/app.js";

// Mock database pool
const mockPool = {
  connect: vi.fn(),
  query: vi.fn(),
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

describe("API Shell checks", () => {
  test("instantiates app and handles liveness check without DB query", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();

    // Verify database was NOT queried during liveness check
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test("version endpoint returns schema payload matching active variables", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/version",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      serviceName: string;
      environment: string;
    };
    expect(body.serviceName).toBe("govos-api");
    expect(body.environment).toBe("local");
  });
});
