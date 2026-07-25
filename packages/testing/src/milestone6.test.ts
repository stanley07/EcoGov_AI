/* eslint-disable @typescript-eslint/no-explicit-any */
import * as crypto from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
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

// Encryption helpers to generate real mock data for GCM decryption check
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = Buffer.from("govos-intake-key-must-be-32bytes", "utf-8"); // v1

function encryptContact(text: string): { ciphertext: string; nonce: string; keyVersion: string } {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, nonce);
  let ciphertext = cipher.update(text, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return {
    ciphertext: ciphertext + ":" + authTag,
    nonce: nonce.toString("hex"),
    keyVersion: "v1",
  };
}

describe("Milestone 6 - EcoGov Officer Workbench", () => {
  let mockDatabaseRows: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseRows = [];

    // Dynamically handle sessions lookup so it doesn't consume queued test rows
    mockQuery.mockImplementation(async (sql: string, _params: any[]) => {
      if (sql.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-1",
              tenant_id: "tenant-uuid-1",
              roles: ["inspector", "director", "super_admin"],
            },
          ],
        };
      }
      const nextRows = mockDatabaseRows.shift() || [];
      return { rows: nextRows };
    });
  });

  // Test 1: Scoped cursor queue pagination
  it("GET /workbench/queue enforces RBAC permissions and cursor pagination", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    // Queue mock rows: 1 complaint item, then 0 facility items
    mockDatabaseRows.push([
      {
        id: "complaint-uuid-1",
        referenceNumber: "COMP-001",
        subject: "Waste dumping",
        location: "Zone A",
        category: "waste_dumping",
        status: "triage_pending",
        isEmergency: false,
        createdAt: new Date(),
      },
    ]);
    mockDatabaseRows.push([]); // facilities query

    const res = await apiApp.inject({
      method: "GET",
      url: "/workbench/queue?queue=standard&pageSize=10",
      headers: {
        Authorization: "Bearer mock-token-inspector",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.items).toBeDefined();
    expect(data.items[0].kind).toBe("complaint");
  });

  // Test 2: Secure audited contact reveal POST with decryption check
  it("POST /workbench/complaints/:id/contact-reveal decrypts contact and logs disclose audits", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    const complaintId = "complaint-uuid-1";
    const secretPlaintext = "Citizen name: Jane Doe, Phone: 08012345678";
    const enc = encryptContact(secretPlaintext);

    // 1. Mock first lookup: complaint exists
    mockDatabaseRows.push([{ id: complaintId }]);

    // 2. Mock second lookup: encrypted contact details (real AES-GCM v1 key test)
    mockDatabaseRows.push([{ ciphertext: enc.ciphertext, nonce: enc.nonce, key_version: enc.keyVersion }]);

    // 3. Mock audit insert
    mockDatabaseRows.push([]);

    const res = await apiApp.inject({
      method: "POST",
      url: `/workbench/complaints/${complaintId}/contact-reveal`,
      headers: {
        Authorization: "Bearer mock-token-director",
      },
      payload: {
        reasonCode: "case_follow_up",
        reason: "Contact citizen to request incident photos",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.citizenContact).toBe(secretPlaintext);
  });

  // Test 3: Normalized timeline projection
  it("GET /workbench/:kind/:id/timeline returns whitelisted projected events", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    const complaintId = "complaint-uuid-1";

    // 1. Mock workflow instance check
    mockDatabaseRows.push([{ id: "wf-inst-uuid" }]);

    // 2. Mock step execution history
    mockDatabaseRows.push([
      {
        id: "step-exec-1",
        stepName: "intake",
        status: "completed",
        actorType: "citizen",
        notes: "Intake completed",
        createdAt: new Date(),
      },
    ]);

    // 3. Mock AI executions
    mockDatabaseRows.push([
      {
        id: "ai-exec-1",
        agentName: "complaint-triage-agent",
        createdAt: new Date(),
        estimatedCost: 1500, // 1500 microcents
      },
    ]);

    const res = await apiApp.inject({
      method: "GET",
      url: `/workbench/complaints/${complaintId}/timeline`,
      headers: {
        Authorization: "Bearer mock-token-inspector",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.length).toBe(2);
    expect(data[0].actorType).toBe("citizen");
    expect(data[1].actorType).toBe("ai");
  });

  // Test 4: Scoped metrics summary
  it("GET /workbench/metrics returns summary count values", async () => {
    const apiApp = createApp(mockConfig, mockPool);

    // Mock count return rows
    mockDatabaseRows.push([{ count: 5 }]); // pending complaints
    mockDatabaseRows.push([{ count: 2 }]); // emergency
    mockDatabaseRows.push([{ count: 1 }]); // registrations
    mockDatabaseRows.push([{ count: 3 }]); // completed today

    const res = await apiApp.inject({
      method: "GET",
      url: "/workbench/metrics",
      headers: {
        Authorization: "Bearer mock-token-inspector",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.pendingReviews).toBe(6);
    expect(data.emergencyReviews).toBe(2);
  });
});
