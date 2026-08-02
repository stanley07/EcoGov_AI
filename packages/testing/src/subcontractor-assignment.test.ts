import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Territory Assignment Integration Tests (PA-4 Phase 6)", () => {
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

  async function createLicensedProfile(tenantId: string, nameSegment: string) {
    const appId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const mockTokenHash = crypto.createHash("sha256").update("token").digest("hex");

    // 1. Create dummy application
    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status
      ) VALUES ($1, $2, $3, $4, $5, 'test@gov.ng', '0801122', 'Lagos', 4, 'environmental-consultant', $6, 'approved')
    `, [appId, tenantId, `Biz-${nameSegment}`, `REG-${nameSegment}`, `TAX-${nameSegment}`, mockTokenHash]);
    
    // 2. Create profile
    await pool.query(`
      INSERT INTO subcontractor_profile (
        id, tenant_id, application_id, business_name, status, performance_score, version
      ) VALUES ($1, $2, $3, $4, 'active', 5.00, 1)
    `, [profileId, tenantId, appId, `Biz-${nameSegment}`]);

    // 3. Create paid invoice
    await pool.query(`
      INSERT INTO marketplace_invoice (
        id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status
      ) VALUES ($1, $2, $3, $4, NOW() - interval '1 month', NOW() + interval '11 months', 500000000, 'USD', 'paid')
    `, [invoiceId, tenantId, appId, `INV-${crypto.randomUUID()}`]);

    // 4. Create active licence
    await pool.query(`
      INSERT INTO subcontractor_licence (
        tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'environmental-consultant', 'active', NOW() - interval '1 month', NOW() - interval '1 month', NOW() + interval '11 months', 1)
    `, [tenantId, profileId, invoiceId, `LIC-${crypto.randomUUID()}`, crypto.randomUUID()]);

    return { profileId, appId, invoiceId };
  }

  test("1. List Geography Regions returns seeded local government areas and clusters", async () => {
    const { token } = await setupAuthUser(pool);

    const res = await app.inject({
      method: "GET",
      url: "/marketplace/regions",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.lgas).toBeDefined();
    expect(body.clusters).toBeDefined();

    // Verify seeded regions are present
    const awkaLga = body.lgas.find((l: any) => l.name === "Awka South");
    expect(awkaLga).toBeDefined();
    expect(awkaLga.stateName).toBe("Anambra");

    const industrialCluster = body.clusters.find((c: any) => c.name === "Central Industrial Zone");
    expect(industrialCluster).toBeDefined();
    expect(industrialCluster.regionDetails).toContain("Covers industrial zones");
  });

  test("2. Create Assignment successfully allocates active LGA territory", async () => {
    const { token, tenantId, userId } = await setupAuthUser(pool);
    const { profileId } = await createLicensedProfile(tenantId, "T2");

    // Fetch seeded LGA ID
    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Awka South'",
      [tenantId]
    );
    const lgaId = lgaQuery.rows[0].id;

    // Create assignment
    const startsAt = new Date().toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        assignmentType: "lga",
        targetId: lgaId,
        startsAt
      }
    });

    expect(res.statusCode).toBe(201);
    const assignment = JSON.parse(res.body);
    expect(assignment.id).toBeDefined();
    expect(assignment.status).toBe("active");
    expect(assignment.lgaId).toBe(lgaId);
    expect(assignment.clusterId).toBeNull();
    expect(assignment.assignedBy).toBe(userId);

    // Verify DB details
    const dbRes = await pool.query("SELECT * FROM subcontractor_assignment WHERE id = $1", [assignment.id]);
    expect(dbRes.rows[0].status).toBe("active");
    expect(dbRes.rows[0].ends_at).toBeNull();
  });

  test("3. Create Assignment fails if subcontractor does not hold an active licence", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const profileId = crypto.randomUUID();

    // Create profile but NO licence
    await pool.query(`
      INSERT INTO subcontractor_profile (
        id, tenant_id, business_name, status, performance_score, version
      ) VALUES ($1, $2, 'Unlicensed Ltd', 'active', 5.00, 1)
    `, [profileId, tenantId]);

    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Awka South'",
      [tenantId]
    );
    const lgaId = lgaQuery.rows[0].id;

    const res = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        assignmentType: "lga",
        targetId: lgaId
      }
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("active licence");
  });

  test("4. Required Correction 1: StartsAt in the future is strictly rejected", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createLicensedProfile(tenantId, "T4");

    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Awka South'",
      [tenantId]
    );
    const lgaId = lgaQuery.rows[0].id;

    // Future date: 1 day in the future
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        assignmentType: "lga",
        targetId: lgaId,
        startsAt: futureDate
      }
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("future");
  });

  test("5. Territory Exclusivity: Overlapping active assignments on same LGA are rejected", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId: p1 } = await createLicensedProfile(tenantId, "T5-1");
    const { profileId: p2 } = await createLicensedProfile(tenantId, "T5-2");

    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Onitsha North'",
      [tenantId]
    );
    const lgaId = lgaQuery.rows[0].id;

    // First assignment
    const res1 = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: p1,
        assignmentType: "lga",
        targetId: lgaId
      }
    });
    expect(res1.statusCode).toBe(201);

    // Second assignment (overlaps Awka South/Onitsha North)
    const res2 = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: p2,
        assignmentType: "lga",
        targetId: lgaId
      }
    });

    expect(res2.statusCode).toBe(409);
    expect(JSON.parse(res2.body).error).toContain("already assigned");
  });

  test("6. Terminate Assignment transitions status to terminated and sets ends_at", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createLicensedProfile(tenantId, "T6");

    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Awka South'",
      [tenantId]
    );
    const lgaId = lgaQuery.rows[0].id;

    // Create assignment
    const res = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        assignmentType: "lga",
        targetId: lgaId
      }
    });
    const assignment = JSON.parse(res.body);

    // Terminate with correct version
    const termRes = await app.inject({
      method: "POST",
      url: `/marketplace/assignments/${assignment.id}/terminate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 1 }
    });

    expect(termRes.statusCode).toBe(200);
    const termAss = JSON.parse(termRes.body);
    expect(termAss.status).toBe("terminated");
    expect(termAss.endsAt).toBeDefined();
    expect(termAss.version).toBe(2);

    // Double termination fails
    const termRes2 = await app.inject({
      method: "POST",
      url: `/marketplace/assignments/${assignment.id}/terminate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2 }
    });
    expect(termRes2.statusCode).toBe(400);
    expect(JSON.parse(termRes2.body).error).toContain("already terminated");
  });

  test("7. Cross-Tenant Isolation: Officer from Tenant A cannot access Tenant B's assignments", async () => {
    const { token: tokenA } = await setupAuthUser(pool);
    const { tenantId: tenantIdB } = await setupAuthUser(pool);

    const { profileId } = await createLicensedProfile(tenantIdB, "T7");

    const lgaQuery = await pool.query(
      "SELECT id FROM local_government_area WHERE tenant_id = $1 AND name = 'Awka South'",
      [tenantIdB]
    );
    const lgaId = lgaQuery.rows[0].id;

    // Officer A attempts to assign Tenant B's subcontractor to Tenant B's LGA
    const res = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${tokenA}` }, // Auth as A
      payload: {
        subcontractorId: profileId, // Profile of B
        assignmentType: "lga",
        targetId: lgaId
      }
    });

    // Rejects because Officer A does not see profile B or LGA B under Tenant A
    expect(res.statusCode).toBe(404);
  });
});
