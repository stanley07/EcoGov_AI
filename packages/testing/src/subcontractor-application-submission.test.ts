import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Application Submission Integration Tests", () => {
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

  test("1. Submission blocking conditions (missing fields, missing documents, failed scans)", async () => {
    const tenant = await createTestTenant(pool);

    // Create application with missing fields
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Incomplete Biz"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Try submitting directly - fails because fields are missing
    const submitRes1 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });
    expect(submitRes1.statusCode).toBe(400);
    expect(JSON.parse(submitRes1.body).error).toContain("Missing mandatory field");

    // Update fields to be complete
    await app.inject({
      method: "PATCH",
      url: `/marketplace/applications/${appId}`,
      payload: {
        accessToken: token,
        expectedVersion: 1,
        registrationNumber: "REG-SUB-1",
        taxIdentifier: "TAX-SUB-1",
        contactEmail: "sub@test.gov.ng",
        contactPhone: "0801122",
        operatingAddress: "Lagos",
        experienceYears: 4,
        licenseType: "environmental-consultant"
      }
    });

    // Try submitting - fails because documents are missing
    const submitRes2 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 2 }
    });
    expect(submitRes2.statusCode).toBe(400);
    expect(JSON.parse(submitRes2.body).error).toContain("compliance document is required");

    // Upload an infected document (triggers failed scan)
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "infected.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "0000a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // Try submitting - fails because scan failed
    const submitRes3 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 2 }
    });
    expect(submitRes3.statusCode).toBe(400);
    expect(JSON.parse(submitRes3.body).error).toContain("failed safety scans");

    // Replace document with clean one (triggers scan passed and supersedes old)
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "clean.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // Submit application - succeeds!
    const submitRes4 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 2 }
    });
    expect(submitRes4.statusCode).toBe(200);
    expect(JSON.parse(submitRes4.body).status).toBe("submitted");

    // Attempting to edit application after submission is rejected
    const postSubmitEdit = await app.inject({
      method: "PATCH",
      url: `/marketplace/applications/${appId}`,
      payload: {
        accessToken: token,
        expectedVersion: 3,
        businessName: "Change Name After Submit"
      }
    });
    expect(postSubmitEdit.statusCode).toBe(400);
  });
});
