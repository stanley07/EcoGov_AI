import { describe, test, expect, vi, beforeEach } from "vitest";
import { Pool, PoolClient } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "../src/app.js";
import * as govosCore from "@govos/core";

// Mock @govos/core functions
vi.mock("@govos/core", async (importOriginal) => {
  const actual = await importOriginal<typeof govosCore>();
  return {
    ...actual,
    createWorkflowInstance: vi.fn(),
    transitionWorkflowInstance: vi.fn(),
    hasPermission: vi.fn().mockImplementation((roles: string[], perm: string) => {
      return roles.includes(perm) || roles.includes("super_admin");
    }),
  };
});

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
global.fetch = mockFetch;

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

describe("Backend Facility Registration API Endpoint", () => {
  let mockClient: any;
  let mockPool: any;
  let queryCalls: Array<{ text: string; values?: any[] }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls = [];

    mockClient = {
      query: vi.fn().mockImplementation(async (text: string, values?: any[]) => {
        queryCalls.push({ text, values });
        if (text.includes("INSERT INTO facility")) {
          return { rows: [] };
        }
        if (text.includes("INSERT INTO facility_registration")) {
          return { rows: [] };
        }
        if (text.includes("INSERT INTO task_execution")) {
          return { rows: [] };
        }
        if (text.includes("INSERT INTO authz_audit_log")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockImplementation(async (text: string, values?: any[]) => {
        queryCalls.push({ text, values });
        if (text.includes("FROM session")) {
          return {
            rows: [
              {
                user_id: "00000000-0000-0000-0000-000000001001",
                tenant_id: "00000000-0000-0000-0000-000000000001",
                roles: ["super_admin", "facility:register"],
              },
            ],
          };
        }
        if (text.includes("FROM facility_registration")) {
          return { rows: [] }; // No duplicates by default
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    // Reset workflow mock returns
    vi.mocked(govosCore.createWorkflowInstance).mockResolvedValue({
      instanceId: "wf-instance-uuid",
      initialStepExecutionId: "step-exec-uuid",
    });
    vi.mocked(govosCore.transitionWorkflowInstance).mockResolvedValue("next-step-exec-uuid");
  });

  test("Success path creates facility, registration, workflow instance, and durable task inside transaction", async () => {
    const app = createApp(mockConfig, mockPool);
    const response = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash",
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        description: "A clean car wash facility",
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        contactPhone: "+2348030000000",
        clientSubmissionId: "submission-key-unique-1",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.facilityId).toBeDefined();
    expect(body.registrationId).toBeDefined();
    expect(body.referenceNumber).toMatch(/^ASMOE-FAC-\d{4}-[A-Z0-9]{8}$/);
    expect(body.status).toBe("submitted");

    // Check transaction flow
    const begins = queryCalls.filter((q) => q.text === "BEGIN");
    const commits = queryCalls.filter((q) => q.text === "COMMIT");
    expect(begins.length).toBe(1);
    expect(commits.length).toBe(1);

    // Verify task_type is ai_registration_review
    const taskInsert = queryCalls.find((q) => q.text.includes("INSERT INTO task_execution"));
    expect(taskInsert).toBeDefined();
    expect(taskInsert?.text).toContain("ai_registration_review");

    // Verify workflow spawn and transition were called
    expect(govosCore.createWorkflowInstance).toHaveBeenCalled();
    expect(govosCore.transitionWorkflowInstance).toHaveBeenCalled();

    // Verify fetch was dispatched to worker
    expect(mockFetch).toHaveBeenCalled();
  });

  test("Request idempotency: repeat request returns the same registration and does not insert duplicates", async () => {
    // Mock the duplicate check to return an existing record
    mockPool.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      queryCalls.push({ text, values });
      if (text.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "00000000-0000-0000-0000-000000001001",
              tenant_id: "00000000-0000-0000-0000-000000000001",
              roles: ["super_admin"],
            },
          ],
        };
      }
      if (text.includes("FROM facility_registration")) {
        return {
          rows: [
            {
              facilityId: "existing-fac-id",
              registrationId: "existing-reg-id",
              workflowInstanceId: "existing-wf-id",
              referenceNumber: "ASMOE-FAC-2026-EXISTING",
              status: "submitted",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const response = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash",
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        clientSubmissionId: "submission-key-duplicate",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.facilityId).toBe("existing-fac-id");
    expect(body.referenceNumber).toBe("ASMOE-FAC-2026-EXISTING");

    // Verify that NO database inserts were attempted since idempotency was matched immediately
    const hasInserts = queryCalls.some((q) => q.text.includes("INSERT"));
    expect(hasInserts).toBe(false);
  });

  test("Category normalization maps legacy names to canonical keys", async () => {
    const app = createApp(mockConfig, mockPool);
    const response = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash", // Legacy category
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        clientSubmissionId: "sub-category-normal",
      },
    });

    expect(response.statusCode).toBe(201);
    // Find facility insert query
    const facInsert = queryCalls.find((q) => q.text.includes("INSERT INTO facility"));
    // "Car Wash" normalized should be "car_wash"
    expect(facInsert?.values?.[5]).toBe("car_wash");
  });

  test("Reference-number unique-constraint collision retries successfully", async () => {
    let insertCount = 0;
    mockClient.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      queryCalls.push({ text, values });
      if (text.includes("INSERT INTO facility_registration")) {
        insertCount++;
        if (insertCount === 1) {
          // Throw unique constraint violation
          const err = new Error("duplicate key value violates unique constraint") as any;
          err.code = "23505";
          err.detail = "Key (tenant_id, reference_number)=(tenant, REF) already exists.";
          throw err;
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const response = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash",
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        clientSubmissionId: "sub-collision",
      },
    });

    expect(response.statusCode).toBe(201);
    // Verified retry happened: insert was called twice, ROLLBACK once, then succeeded
    expect(insertCount).toBe(2);
    const rollbacks = queryCalls.filter((q) => q.text === "ROLLBACK");
    expect(rollbacks.length).toBe(1);
  });

  test("Rollback occurs and error is propagated when task creation fails", async () => {
    mockClient.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      queryCalls.push({ text, values });
      if (text.includes("INSERT INTO task_execution")) {
        throw new Error("Simulated task table insertion failure");
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const response = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash",
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        clientSubmissionId: "sub-rollback-task",
      },
    });

    expect(response.statusCode).toBe(500);
    const rollbacks = queryCalls.filter((q) => q.text === "ROLLBACK");
    expect(rollbacks.length).toBe(1);
  });

  test("Audit logs do not contain raw contact details", async () => {
    const app = createApp(mockConfig, mockPool);
    await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: {
        Authorization: "Bearer mock-token-123",
      },
      payload: {
        organizationId: "00000000-0000-0000-0000-000000000010",
        businessName: "Test Facility",
        category: "Car Wash",
        address: "123 Test Street",
        latitude: 6.2,
        longitude: 6.8,
        description: "Sensative description details",
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Emeka Obi",
        contactEmail: "emeka@test.gov.ng",
        contactPhone: "+2348030000000",
        registrationNotes: "Applicant walk-in note",
        clientSubmissionId: "sub-audit-safety",
      },
    });

    const auditInsert = queryCalls.find((q) => q.text.includes("INSERT INTO authz_audit_log"));
    expect(auditInsert).toBeDefined();
    const auditContext = JSON.parse(auditInsert?.values?.[3]);
    
    // Ensure contact details are absent
    expect(auditContext.contactPerson).toBeUndefined();
    expect(auditContext.contactEmail).toBeUndefined();
    expect(auditContext.contactPhone).toBeUndefined();
    expect(auditContext.description).toBeUndefined();
    expect(auditContext.registrationNotes).toBeUndefined();
  });
});
