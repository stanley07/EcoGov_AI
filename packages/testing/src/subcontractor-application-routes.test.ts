import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Application Routes Integration Tests", () => {
  let pool: Pool;
  let app: any;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Create, Update and status retrieval workflow", async () => {
    const tenant = await createTestTenant(pool);

    // Create Application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Clean Tech Ltd",
        registrationNumber: "RC-998877",
        taxIdentifier: "TIN-998877",
        contactEmail: "info@cleantech.gov.ng",
        contactPhone: "08011223344",
        operatingAddress: "Plot 10, Lekki, Lagos",
        experienceYears: 5,
        licenseType: "environmental-consultant"
      }
    });

    expect(createRes.statusCode).toBe(201);
    const body = JSON.parse(createRes.body);
    expect(body.applicationId).toBeDefined();
    expect(body.accessToken).toBeDefined();
    expect(body.status).toBe("draft");
    expect(body.version).toBe(1);
    expect(createRes.headers["cache-control"]).toBe("no-store");

    const appId = body.applicationId;
    const token = body.accessToken;

    // Get Status
    const statusRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/status`,
      payload: { accessToken: token }
    });

    expect(statusRes.statusCode).toBe(200);
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.applicationId).toBe(appId);
    expect(statusBody.status).toBe("draft");
    expect(statusBody.version).toBe(1);
    expect(statusBody.documents).toEqual([]);
    expect(statusRes.headers["cache-control"]).toBe("no-store");

    // Update (PATCH)
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/marketplace/applications/${appId}`,
      payload: {
        accessToken: token,
        expectedVersion: 1,
        businessName: "Clean Tech Solutions Ltd",
        experienceYears: 6
      }
    });

    expect(updateRes.statusCode).toBe(200);
    const updateBody = JSON.parse(updateRes.body);
    expect(updateBody.version).toBe(2);

    // Stale Version Conflict Update (expect 409)
    const staleUpdateRes = await app.inject({
      method: "PATCH",
      url: `/marketplace/applications/${appId}`,
      payload: {
        accessToken: token,
        expectedVersion: 1, // Stale version
        businessName: "Stale update name"
      }
    });
    expect(staleUpdateRes.statusCode).toBe(409);

    // Invalid Token Check (expect 401)
    const invalidTokenRes = await app.inject({
      method: "PATCH",
      url: `/marketplace/applications/${appId}`,
      payload: {
        accessToken: "invalid-token-value-here-123456",
        expectedVersion: 2,
        businessName: "Unauthorized update name"
      }
    });
    expect(invalidTokenRes.statusCode).toBe(401);
  });

  test("2. Duplicate registration number inside same tenant is rejected", async () => {
    const tenant = await createTestTenant(pool);
    const payload = {
      tenantId: tenant.id,
      businessName: "Business One",
      registrationNumber: "REG-DUP-1",
      taxIdentifier: "TAX-DUP-1",
      experienceYears: 1,
      licenseType: "environmental-consultant"
    };

    // First creation succeeds
    const firstRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload
    });
    expect(firstRes.statusCode).toBe(201);

    // Second creation fails
    const secondRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        ...payload,
        businessName: "Business Two"
      }
    });
    expect(secondRes.statusCode).toBe(400);
  });
});
