import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Screening Outbox Integration Tests", () => {
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

  test("1. Atomic submission transitions state and creates outbox + snapshot", async () => {
    const tenant = await createTestTenant(pool);

    // Create complete application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Outbox Tech",
        registrationNumber: "REG-OUT-1",
        taxIdentifier: "TAX-OUT-1",
        contactEmail: "out@test.gov.ng",
        contactPhone: "0801122",
        operatingAddress: "Lagos",
        experienceYears: 4,
        licenseType: "environmental-consultant"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Upload document
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // Clear outbox first to isolate the count
    await pool.query("DELETE FROM outbox_event WHERE tenant_id = $1", [tenant.id]);
    await pool.query("DELETE FROM subcontractor_application_snapshot WHERE tenant_id = $1", [tenant.id]);

    // Submit
    const submitRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });
    expect(submitRes.statusCode).toBe(200);

    // Verify application state transitioned to screening_queued
    const appQuery = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
    expect(appQuery.rows[0].status).toBe("screening_queued");

    // Verify outbox record created
    const outboxQuery = await pool.query("SELECT * FROM outbox_event WHERE aggregate_id = $1", [appId]);
    expect(outboxQuery.rows.length).toBe(1);
    expect(outboxQuery.rows[0].event_type).toBe("subcontractor_application.submitted");
    expect(outboxQuery.rows[0].deduplication_key).toContain(`marketplace-screening:${tenant.id}:${appId}`);

    // Verify snapshot record created
    const snapQuery = await pool.query("SELECT * FROM subcontractor_application_snapshot WHERE application_id = $1", [appId]);
    expect(snapQuery.rows.length).toBe(1);
    expect(snapQuery.rows[0].application_version).toBe(1);
  });

  test("2. Duplicate submission for same version is rejected", async () => {
    const tenant = await createTestTenant(pool);
    // Create complete application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Outbox Tech 2",
        registrationNumber: "REG-OUT-2",
        taxIdentifier: "TAX-OUT-2",
        contactEmail: "out2@test.gov.ng",
        contactPhone: "0801122",
        operatingAddress: "Lagos",
        experienceYears: 4,
        licenseType: "environmental-consultant"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Upload document
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });

    // First submit succeeds
    const submit1 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });
    expect(submit1.statusCode).toBe(200);

    // Second submit fails because version has incremented (and even if version forced, status check blocks it)
    const submit2 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: { accessToken: token, expectedVersion: 1 }
    });
    expect(submit2.statusCode).toBe(409); // Version conflict
  });
});
