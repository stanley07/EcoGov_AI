import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { buildDemoScenario } from "./fixtures/marketplace-demo-scenario.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Marketplace Demo Scenario Seeder Tests", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Seeder builds demo scenario with correct ratios, isolations, and limits", async () => {
    const slug = "anambra-test-seeder";
    const result = await buildDemoScenario(pool, slug);

    expect(result.tenantId).toBeDefined();
    expect(result.lgas).toHaveLength(3);
    expect(result.clusters).toHaveLength(6);
    expect(result.subcontractors).toHaveLength(8);

    // Verify subcontractor 8 has 25 facilities attributed
    const client = await pool.connect();
    try {
      const sub8 = result.subcontractors.find(s => s.businessName === "Awka Green Shield Ltd");
      expect(sub8).toBeDefined();
      expect(sub8?.profileId).toBeDefined();

      const facRes = await client.query(
        "SELECT COUNT(*) FROM subcontractor_facility_attribution WHERE tenant_id = $1 AND subcontractor_id = $2",
        [result.tenantId, sub8?.profileId]
      );
      expect(Number(facRes.rows[0].count)).toBe(25);

      // Verify subcontractor 8 has 4 completed/confirmed audits
      const auditRes = await client.query(
        "SELECT COUNT(*) FROM subcontractor_quality_audit WHERE tenant_id = $1 AND subcontractor_id = $2 AND status IN ('completed', 'confirmed')",
        [result.tenantId, sub8?.profileId]
      );
      expect(Number(auditRes.rows[0].count)).toBe(4);

      // Verify events log counts
      const eventRes = await client.query(
        "SELECT COUNT(DISTINCT event_type) FROM subcontractor_application_event WHERE tenant_id = $1",
        [result.tenantId]
      );
      expect(Number(eventRes.rows[0].count)).toBeGreaterThanOrEqual(10);
    } finally {
      client.release();
    }
  });
});
