import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Rebranding Migration Idempotency and Safety", () => {
  it("verifies that the SQL migration is safe, idempotent, and updates the correct entities", () => {
    const migrationPath = path.join(__dirname, "../migrations/000007_rebrand_anambra.sql");
    const sqlContent = fs.readFileSync(migrationPath, "utf8");

    // Assert that the migration file contains the expected update statements
    expect(sqlContent).toContain("UPDATE tenant");
    expect(sqlContent).toContain("UPDATE organization");

    // Verify correct Anambra names are present in the SQL migration file
    expect(sqlContent).toContain("Anambra State Ministry of Environment");
    expect(sqlContent).toContain("Anambra State Ministry of Environment Headquarters");

    // Verify safety check 'IS DISTINCT FROM' is present to ensure idempotency
    expect(sqlContent).toContain("IS DISTINCT FROM 'Anambra State Ministry of Environment'");
    expect(sqlContent).toContain("IS DISTINCT FROM 'Anambra State Ministry of Environment Headquarters'");

    // Verify that the deterministic IDs are targeted correctly
    expect(sqlContent).toContain("00000000-0000-0000-0000-000000000001"); // Default Tenant ID
    expect(sqlContent).toContain("00000000-0000-0000-0000-000000000010"); // Default Org ID
  });
});
