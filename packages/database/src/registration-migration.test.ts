import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Registration Migration Schema Safety and Integrity", () => {
  it("verifies that the SQL migration creates the registration table with constraints and indexes", () => {
    const migrationPath = path.join(__dirname, "../migrations/000008_facility_registration_fields.sql");
    const sqlContent = fs.readFileSync(migrationPath, "utf8");

    // Table creation check
    expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS facility_registration");

    // Decoupled structure checks
    expect(sqlContent).toContain("reference_number VARCHAR(100) NOT NULL");
    expect(sqlContent).toContain("client_submission_id VARCHAR(255) NOT NULL");
    expect(sqlContent).toContain("submitted_by UUID NOT NULL");
    expect(sqlContent).toContain("record_version INTEGER NOT NULL DEFAULT 1");

    // Status and risk constraints
    expect(sqlContent).toContain("CHECK (status IN (");
    expect(sqlContent).toContain("'submitted'");
    expect(sqlContent).toContain("'ai_review_pending'");
    expect(sqlContent).toContain("'officer_review'");
    expect(sqlContent).toContain("CHECK (preliminary_risk_rating IS NULL OR preliminary_risk_rating IN ('low', 'medium', 'high'))");
    expect(sqlContent).toContain("CHECK (official_risk_rating IS NULL OR official_risk_rating IN ('low', 'medium', 'high'))");

    // Database enforced unique constraints
    expect(sqlContent).toContain("UNIQUE (tenant_id, reference_number)");
    expect(sqlContent).toContain("UNIQUE (tenant_id, client_submission_id)");

    // Indexes checks
    expect(sqlContent).toContain("CREATE INDEX IF NOT EXISTS idx_facility_registration_status");
    expect(sqlContent).toContain("CREATE INDEX IF NOT EXISTS idx_facility_registration_created_at");
    expect(sqlContent).toContain("CREATE INDEX IF NOT EXISTS idx_facility_tenant_registration_status");
  });
});
