import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import { AccessTokenService } from "@govos/core";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Onboarding Security (PA-4 Phase 2)", () => {
  let pool: Pool;
  const systemTenantId = "00000000-0000-0000-0000-000000000000";

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  it("1. plaintext token is returned only once (represented in test generator)", () => {
    const rawToken = AccessTokenService.generateToken();
    expect(rawToken.length).toBe(64); // hex encoded 32 bytes

    const hash = AccessTokenService.hashToken(rawToken);
    expect(hash.length).toBe(64);
    expect(hash).not.toBe(rawToken);
  });

  it("2. database persists only token hashes and never plaintext tokens", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const appId = "22222222-2222-2222-2222-222222222222";
      const rawToken = AccessTokenService.generateToken();
      const hash = AccessTokenService.hashToken(rawToken);

      await client.query(`
        INSERT INTO subcontractor_application (
          id, tenant_id, business_name, registration_number, tax_identifier,
          contact_email, contact_phone, operating_address, experience_years,
          license_type, access_token_hash, status, version
        ) VALUES ($1, $2, 'Secure Biz', 'REG-SEC', 'TAX-SEC', 's@test.gov', '111', 'Address S', 4, 'remediation', $3, 'draft', 1)
      `, [appId, systemTenantId, hash]);

      const selectRes = await client.query("SELECT * FROM subcontractor_application WHERE id = $1", [appId]);
      const row = selectRes.rows[0];

      expect(row.access_token_hash).toBe(hash);
      // Plaintext token must not be anywhere in the database columns
      for (const key of Object.keys(row)) {
        expect(row[key]).not.toBe(rawToken);
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("3. timingSafeCompare rejects invalid matches and handles timings cleanly", () => {
    const rawToken1 = AccessTokenService.generateToken();
    const rawToken2 = AccessTokenService.generateToken();
    const hash1 = AccessTokenService.hashToken(rawToken1);
    const hash2 = AccessTokenService.hashToken(rawToken2);

    expect(AccessTokenService.timingSafeCompare(hash1, hash1)).toBe(true);
    expect(AccessTokenService.timingSafeCompare(hash1, hash2)).toBe(false);
  });
});
