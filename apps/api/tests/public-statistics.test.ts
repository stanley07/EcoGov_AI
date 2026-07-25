/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "../src/app.js";

const mockQuery = vi.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

const mockConfig: Config = {
  appEnv: "test",
  database: { DATABASE_URL: "postgres://localhost" },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic", GEMINI_MODEL_ID: "gemini-1.5-flash" },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
  publicTenantSlug: "anambra-state-ministry-of-environment",
};

const VALID_TENANT_ID = "00000000-0000-0000-0000-000000000001";

describe("Public Platform Statistics API Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Empty database fallback check
  it("GET /public/platform-statistics returns 404 when tenant database lookup is empty", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    // Simulate empty database: tenant resolution returns 0 rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await apiApp.inject({
      method: "GET",
      url: "/public/platform-statistics",
    });

    expect(res.statusCode).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error).toBe("Tenant not found.");
  });

  // Test 2: Live calculations and scoping
  it("GET /public/platform-statistics resolves tenant from configuration slug, runs single aggregate, and returns correct values", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes("FROM tenant")) {
        expect(params[0]).toBe("anambra-state-ministry-of-environment");
        return { rows: [{ id: VALID_TENANT_ID }] };
      }
      if (sql.includes("WITH metrics AS")) {
        expect(params[0]).toBe(VALID_TENANT_ID);
        return {
          rows: [
            {
              registeredFacilities: 5,
              inspectionsCompleted: 3,
              citizenReports: 12,
              complianceRate: 71, // 5 approved, 2 rejected = 5/7 * 100 = 71%
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "GET",
      url: "/public/platform-statistics",
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    expect(data.registeredFacilities).toBe(5);
    expect(data.inspectionsCompleted).toBe(3);
    expect(data.citizenReports).toBe(12);
    expect(data.complianceRate).toBe(71);
    expect(data.generatedAt).toBeDefined();

    // Verify no private details are exposed in the JSON payload
    const keys = Object.keys(data);
    expect(keys).toContain("registeredFacilities");
    expect(keys).toContain("inspectionsCompleted");
    expect(keys).toContain("citizenReports");
    expect(keys).toContain("complianceRate");
    expect(keys).toContain("generatedAt");
    expect(keys.length).toBe(5); // No extra columns, IDs, or contacts leaked
  });

  // Test 3: Ignores tenantId supplied in request
  it("GET /public/platform-statistics ignores arbitrary tenantId query parameters or headers supplied by client", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes("FROM tenant")) {
        // Must resolve from configured slug, not "malicious-tenant"
        expect(params[0]).toBe("anambra-state-ministry-of-environment");
        return { rows: [{ id: VALID_TENANT_ID }] };
      }
      if (sql.includes("WITH metrics AS")) {
        expect(params[0]).toBe(VALID_TENANT_ID);
        return {
          rows: [
            {
              registeredFacilities: 1,
              inspectionsCompleted: 1,
              citizenReports: 1,
              complianceRate: 100,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await apiApp.inject({
      method: "GET",
      url: "/public/platform-statistics?tenantId=some-fake-uuid",
      headers: {
        "x-tenant-id": "fake-tenant-header",
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
