import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import { 
  validateApplicationTransition,
  validateProfileTransition,
  validateLicenceTransition
} from "@govos/core";

// Database URL configuration
const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Onboarding & Lifecycle Policies (PA-4 Phase 1)", () => {
  let pool: Pool;
  const systemTenantId = "00000000-0000-0000-0000-000000000000";

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  // 1. Check Constraint Values
  describe("CHECK constraints and status values validation", () => {
    it("inserts valid application status values and rejects invalid values", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Insert standard valid application
        const appId = "11111111-1111-1111-1111-111111111111";
        const tokenHash = "d5a3c42813123b32000000000000000000000000000000000000000000000000";
        
        await client.query(`
          INSERT INTO subcontractor_application (
            id, tenant_id, business_name, registration_number, tax_identifier,
            contact_email, contact_phone, operating_address, experience_years,
            license_type, access_token_hash, status, version
          ) VALUES ($1, $2, 'Test Business', 'REG-100', 'TAX-100', 'test@test.gov', '123456', '123 St', 5, 'remediation', $3, 'draft', 1)
        `, [appId, systemTenantId, tokenHash]);

        // Attempting to set an invalid status should fail check constraints
        let errorThrown = false;
        try {
          await client.query(
            "UPDATE subcontractor_application SET status = 'invalid_state_name' WHERE id = $1",
            [appId]
          );
        } catch (err: any) {
          errorThrown = true;
          expect(err.message).toContain("chk_subcontractor_application_status");
        }
        expect(errorThrown).toBe(true);

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    it("rejects invalid numeric values such as negative experience years", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tokenHash = "d5a3c42813123b32000000000000000000000000000000000000000000000000";

        let errorThrown = false;
        try {
          await client.query(`
            INSERT INTO subcontractor_application (
              tenant_id, business_name, registration_number, tax_identifier,
              contact_email, contact_phone, operating_address, experience_years,
              license_type, access_token_hash, status, version
            ) VALUES ($1, 'Test Business', 'REG-101', 'TAX-101', 'test@test.gov', '123456', '123 St', -2, 'remediation', $2, 'draft', 1)
          `, [systemTenantId, tokenHash]);
        } catch (err: any) {
          errorThrown = true;
          expect(err.message).toContain("experience_years");
        }
        expect(errorThrown).toBe(true);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });

  // 2. Cross-tenant FK Consistency Bounds
  describe("Cross-tenant composite constraints checks", () => {
    it("prevents referencing another tenant's application in child documents", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tenantA = "00000000-0000-0000-0000-000000000000"; // system tenant
        // Create Tenant B
        const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        await client.query("INSERT INTO tenant (id, name, slug, type, status) VALUES ($1, 'Tenant B', 'tenant-b', 'ministry', 'active')", [tenantB]);

        // Insert Application on Tenant A
        const appId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const tokenHash = "d5a3c42813123b32000000000000000000000000000000000000000000000000";
        await client.query(`
          INSERT INTO subcontractor_application (
            id, tenant_id, business_name, registration_number, tax_identifier,
            contact_email, contact_phone, operating_address, experience_years,
            license_type, access_token_hash, status, version
          ) VALUES ($1, $2, 'Business A', 'REG-A', 'TAX-A', 'a@test.gov', '111', 'Address A', 3, 'remediation', $3, 'draft', 1)
        `, [appId, tenantA, tokenHash]);

        // Attempt to insert application document using Tenant B's scope pointing to Tenant A's application
        let errorThrown = false;
        try {
          await client.query(`
            INSERT INTO subcontractor_application_document (
              tenant_id, application_id, document_type, storage_key, content_hash, mime_type, size_bytes
            ) VALUES ($1, $2, 'tax_registry', 'key-1', 'hash-1', 'application/pdf', 1024)
          `, [tenantB, appId]);
        } catch (err: any) {
          errorThrown = true;
          expect(err.message).toContain("fk_document_app");
        }
        expect(errorThrown).toBe(true);

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });

  // 3. Transition Matrix Verification
  describe("State Transition Policies", () => {
    it("validates application status transitions correctly", () => {
      expect(validateApplicationTransition("draft", "submitted")).toBe(true);
      expect(validateApplicationTransition("draft", "withdrawn")).toBe(true);
      expect(validateApplicationTransition("draft", "licence_issued")).toBe(false);
      expect(validateApplicationTransition("submitted", "screening_queued")).toBe(true);
      expect(validateApplicationTransition("licence_issued", "expired")).toBe(true);
      expect(validateApplicationTransition("licence_issued", "draft")).toBe(false);
    });

    it("validates profile status transitions correctly", () => {
      expect(validateProfileTransition("active", "suspended")).toBe(true);
      expect(validateProfileTransition("suspended", "active")).toBe(true);
      expect(validateProfileTransition("revoked", "active")).toBe(false);
    });

    it("validates licence status transitions correctly", () => {
      expect(validateLicenceTransition("pending", "active")).toBe(true);
      expect(validateLicenceTransition("active", "expired")).toBe(true);
      expect(validateLicenceTransition("expired", "active")).toBe(false);
    });
  });

  // 4. Optimistic Concurrency Checks
  describe("Optimistic Concurrency Controls", () => {
    it("returns conflict error when the expected version does not match", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tokenHash = "d5a3c42813123b32000000000000000000000000000000000000000000000000";
        const appId = "33333333-3333-3333-3333-333333333333";
        
        await client.query(`
          INSERT INTO subcontractor_application (
            id, tenant_id, business_name, registration_number, tax_identifier,
            contact_email, contact_phone, operating_address, experience_years,
            license_type, access_token_hash, status, version
          ) VALUES ($1, $2, 'Concurrent Biz', 'REG-CONC', 'TAX-CONC', 'c@test.gov', '111', 'Address C', 4, 'remediation', $3, 'draft', 1)
        `, [appId, systemTenantId, tokenHash]);

        // Attempting to update application with correct expected version 1 succeeds
        const expectedVersion = 1;
        const res = await client.query(
          "UPDATE subcontractor_application SET status = 'submitted', version = version + 1 WHERE id = $1 AND version = $2 RETURNING version",
          [appId, expectedVersion]
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0].version).toBe(2);

        // Attempting to update application with stale expected version 1 fails
        const staleRes = await client.query(
          "UPDATE subcontractor_application SET status = 'screening_queued', version = version + 1 WHERE id = $1 AND version = $2",
          [appId, expectedVersion]
        );
        expect(staleRes.rowCount).toBe(0); // Version in DB is now 2

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });
});
