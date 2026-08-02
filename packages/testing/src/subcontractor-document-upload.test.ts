import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { setupTestEnvironment, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Document Upload Integration Tests", () => {
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

  test("1. Document upload validations and superseding lifecycle", async () => {
    const tenant = await createTestTenant(pool);

    // Create Application
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Doc Biz",
        registrationNumber: "REG-DOC-1",
        taxIdentifier: "TAX-DOC-1"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Test Invalid MIME Type (expect 400)
    const mimeRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "test.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });
    expect(mimeRes.statusCode).toBe(400);

    // Test Oversized File (expect 400)
    const sizeRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 20 * 1024 * 1024, // 20 MB
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });
    expect(sizeRes.statusCode).toBe(400);

    // Test Valid Document Upload (passed scan)
    const uploadRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "tax.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500 * 1024,
        contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
      }
    });
    expect(uploadRes.statusCode).toBe(201);
    const uploadBody = JSON.parse(uploadRes.body);
    expect(uploadBody.documentId).toBeDefined();
    expect(uploadBody.scanStatus).toBe("passed");

    const firstDocId = uploadBody.documentId;

    // Test replacement (supersedes the old one)
    const replaceRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/documents`,
      payload: {
        accessToken: token,
        documentType: "tax_registry",
        filename: "tax_updated.pdf",
        mimeType: "application/pdf",
        sizeBytes: 600 * 1024,
        contentHash: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"
      }
    });
    expect(replaceRes.statusCode).toBe(201);

    // Verify first document is superseded in the DB (has superseded_at set)
    const docQuery = await pool.query("SELECT superseded_at FROM subcontractor_application_document WHERE id = $1", [firstDocId]);
    expect(docQuery.rows[0].superseded_at).not.toBeNull();
  });

  test("2. Failed virus scan simulation", async () => {
    const tenant = await createTestTenant(pool);
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId: tenant.id,
        businessName: "Virus Doc Biz",
        registrationNumber: "REG-VIR-1",
        taxIdentifier: "TAX-VIR-1"
      }
    });
    const { applicationId: appId, accessToken: token } = JSON.parse(createRes.body);

    // Upload document with hash starting with '0000' (triggers failed scan in mock store)
    const uploadRes = await app.inject({
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
    expect(uploadRes.statusCode).toBe(201);
    const body = JSON.parse(uploadRes.body);
    expect(body.scanStatus).toBe("failed");
  });
});
