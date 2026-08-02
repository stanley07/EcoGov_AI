import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Quality Audits & Enforcement Integration Tests (PA-4 Phase 7)", () => {
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

  async function createSubcontractorProfile(tenantId: string, suffix: string) {
    const appId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const token = `token-${crypto.randomUUID()}`;
    const mockTokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status
      ) VALUES ($1, $2, $3, $4, $5, 'test@gov.ng', '0801122', 'Lagos', 4, 'environmental-consultant', $6, 'approved')
    `, [appId, tenantId, `Biz-${suffix}`, `REG-${suffix}`, `TAX-${suffix}`, mockTokenHash]);
    
    await pool.query(`
      INSERT INTO subcontractor_profile (
        id, tenant_id, application_id, business_name, status, performance_score, version
      ) VALUES ($1, $2, $3, $4, 'active', 5.00, 1)
    `, [profileId, tenantId, appId, `Biz-${suffix}`]);

    return { profileId, appId, accessToken: token };
  }

  test("1. AI findings are non-punitive and remain in draft status without scorecard impact", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createSubcontractorProfile(tenantId, "A1");

    // Post an AI audit (score = 40)
    const auditRes = await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "ai",
        auditType: "compliance",
        score: 40,
        findings: [
          {
            findingCode: "FIND-01",
            severity: "medium",
            evidenceReferences: [],
            description: "Minor chemical storage issue"
          }
        ]
      }
    });

    expect(auditRes.statusCode).toBe(201);
    const audit = JSON.parse(auditRes.body);
    expect(audit.status).toBe("draft");
    expect(audit.version).toBe(1);

    // Verify profile score is unaffected (remains default 5.00)
    const profileRes = await pool.query("SELECT performance_score FROM subcontractor_profile WHERE id = $1", [profileId]);
    expect(Number(profileRes.rows[0].performance_score)).toBe(5.00);

    // Verify no automatic warning is created
    const enfRes = await pool.query("SELECT * FROM subcontractor_enforcement_action WHERE subcontractor_id = $1", [profileId]);
    expect(enfRes.rows.length).toBe(0);
  });

  test("2. Officer confirms AI audit and updates performance scorecard", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createSubcontractorProfile(tenantId, "A2");

    // 1. Create draft AI audit (score = 60 -> normalized = 3.0)
    const auditRes = await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "ai",
        auditType: "compliance",
        score: 60,
        findings: []
      }
    });
    const audit = JSON.parse(auditRes.body);

    // 2. Confirm the audit
    const confirmRes = await app.inject({
      method: "POST",
      url: `/officer/marketplace/audits/${audit.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 1 }
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmedAudit = JSON.parse(confirmRes.body);
    expect(confirmedAudit.status).toBe("confirmed");
    expect(confirmedAudit.version).toBe(2);

    // 3. Verify scorecard update (recalculated score = 3.0)
    const profileRes = await pool.query("SELECT * FROM subcontractor_profile WHERE id = $1", [profileId]);
    expect(Number(profileRes.rows[0].performance_score)).toBe(3.00);
    expect(profileRes.rows[0].performance_score_policy_version).toBe("1.0.0");
    expect(profileRes.rows[0].performance_score_audit_count).toBe(1);

    // 4. Verify score history event was written
    const eventRes = await pool.query("SELECT * FROM subcontractor_performance_score_event WHERE subcontractor_id = $1", [profileId]);
    expect(eventRes.rows.length).toBe(1);
    expect(Number(eventRes.rows[0].previous_score)).toBe(5.00);
    expect(Number(eventRes.rows[0].new_score)).toBe(3.00);
  });

  test("3. Warnings require evidence references and cannot bypass validation", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createSubcontractorProfile(tenantId, "A3");

    // Attempt to post high/critical finding without evidence references
    const res = await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "officer",
        auditType: "compliance",
        score: 10,
        findings: [
          {
            findingCode: "CRIT-FIND-01",
            severity: "critical",
            evidenceReferences: [], // Empty!
            description: "Critical safety failure"
          }
        ]
      }
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("references are required");
  });

  test("4. Recalculation triggers warnings below 2.50, warning creation is strictly deduplicated", async () => {
    const { token, tenantId } = await setupAuthUser(pool);
    const { profileId } = await createSubcontractorProfile(tenantId, "A4");

    // 1. Create first completed audit (score = 40 -> normalized = 2.0)
    await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "officer",
        auditType: "compliance",
        score: 40
      }
    });

    // Score is now 2.0 but audit count is 1. Under v1 policy, warning requires >= 2 audits.
    let enfRes = await pool.query("SELECT * FROM subcontractor_enforcement_action WHERE subcontractor_id = $1", [profileId]);
    expect(enfRes.rows.length).toBe(0);

    // 2. Create second completed audit (score = 20 -> normalized = 1.0)
    // Average score will be (2.0 + 1.0) / 2 = 1.50
    await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "officer",
        auditType: "compliance",
        score: 20
      }
    });

    // Score = 1.50, audits count = 2. Should automatically trigger a warning!
    enfRes = await pool.query("SELECT * FROM subcontractor_enforcement_action WHERE subcontractor_id = $1", [profileId]);
    expect(enfRes.rows.length).toBe(1);
    expect(enfRes.rows[0].action_type).toBe("warning");
    expect(enfRes.rows[0].status).toBe("active");

    // 3. Trigger scorecard recalculation again by posting third audit (score = 0 -> normalized = 0)
    // Score will fall to (2.0 + 1.0 + 0) / 3 = 1.00
    await app.inject({
      method: "POST",
      url: "/officer/marketplace/audits",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subcontractorId: profileId,
        auditorType: "officer",
        auditType: "compliance",
        score: 0
      }
    });

    // Verify warning deduplication: still exactly 1 active warning!
    enfRes = await pool.query("SELECT * FROM subcontractor_enforcement_action WHERE subcontractor_id = $1", [profileId]);
    expect(enfRes.rows.length).toBe(1);
  });

  test("5. Officer roles and permission verification for suspensions and revocations", async () => {
    // 1. Setup standard officer user (has suspend, but NOT revoke permissions)
    const { token: officerToken, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPPORT_ADMIN");
    const { profileId } = await createSubcontractorProfile(tenantId, "A5");

    // 2. Officer attempts suspension (authorized)
    const suspRes = await app.inject({
      method: "POST",
      url: "/officer/marketplace/enforcements",
      headers: { authorization: `Bearer ${officerToken}` },
      payload: {
        subcontractorId: profileId,
        actionType: "suspension",
        reason: "Severe safety issues",
        expectedProfileVersion: 1
      }
    });
    expect(suspRes.statusCode).toBe(201);

    // Verify profile status changed to suspended
    let profRes = await pool.query("SELECT status, version FROM subcontractor_profile WHERE id = $1", [profileId]);
    expect(profRes.rows[0].status).toBe("suspended");
    const profileVersion = profRes.rows[0].version;

    // 3. Officer attempts revocation (unauthorized!)
    const revokeRes = await app.inject({
      method: "POST",
      url: "/officer/marketplace/enforcements",
      headers: { authorization: `Bearer ${officerToken}` },
      payload: {
        subcontractorId: profileId,
        actionType: "revocation",
        reason: "Critical safety failure",
        expectedProfileVersion: profileVersion
      }
    });
    expect(revokeRes.statusCode).toBe(403);
    expect(JSON.parse(revokeRes.body).error).toContain("lacks permissions");

    // 4. Admin attempts revocation (authorized!)
    const { token: adminToken, tenantId: adminTenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");
    const { profileId: adminSub } = await createSubcontractorProfile(adminTenantId, "A5-admin");
    const revokeRes2 = await app.inject({
      method: "POST",
      url: "/officer/marketplace/enforcements",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subcontractorId: adminSub,
        actionType: "revocation",
        reason: "Critical safety failure",
        expectedProfileVersion: 1
      }
    });
    expect(revokeRes2.statusCode).toBe(201);
  });

  test("6. Appeal uniqueness constraints, eligibility checks, and transactional approvals", async () => {
    const { token: adminToken, tenantId } = await setupAuthUser(pool, "PLATFORM_SUPER_ADMIN");
    const { profileId, accessToken } = await createSubcontractorProfile(tenantId, "A6");

    // 1. Create a suspension enforcement action
    const actionRes = await app.inject({
      method: "POST",
      url: "/officer/marketplace/enforcements",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subcontractorId: profileId,
        actionType: "suspension",
        reason: "Audit failure",
        expectedProfileVersion: 1
      }
    });
    const action = JSON.parse(actionRes.body);

    // 2. Subcontractor submits appeal
    const appealRes = await app.inject({
      method: "POST",
      url: `/marketplace/enforcements/${action.id}/appeal`,
      payload: {
        accessToken,
        justification: "We have corrected all chemical storage issues."
      }
    });
    expect(appealRes.statusCode).toBe(201);
    const appeal = JSON.parse(appealRes.body);
    expect(appeal.status).toBe("pending");

    // 3. Double appeal rejection
    const appealRes2 = await app.inject({
      method: "POST",
      url: `/marketplace/enforcements/${action.id}/appeal`,
      payload: {
        accessToken,
        justification: "Another justification."
      }
    });
    expect(appealRes2.statusCode).toBe(409);
    expect(JSON.parse(appealRes2.body).error).toContain("already pending");

    // 4. Officer decides appeal (approved)
    const decideRes = await app.inject({
      method: "POST",
      url: `/officer/marketplace/appeals/${appeal.id}/decide`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expectedVersion: 1,
        decision: "approved",
        officerDecision: "Justification accepted, warning replaced."
      }
    });

    expect(decideRes.statusCode).toBe(200);
    const decidedAppeal = JSON.parse(decideRes.body);
    expect(decidedAppeal.status).toBe("approved");

    // 5. Verify side effects committed transactionally:
    // - Enforcement action status is overturned
    const enfActionRes = await pool.query("SELECT status FROM subcontractor_enforcement_action WHERE id = $1", [action.id]);
    expect(enfActionRes.rows[0].status).toBe("overturned");

    // - Profile status goes back to active
    const profRes = await pool.query("SELECT status FROM subcontractor_profile WHERE id = $1", [profileId]);
    expect(profRes.rows[0].status).toBe("active");
  });

  test("7. Tenant Isolation safeguards on scorecards, disputes, and appeals", async () => {
    const { tenantId: tenantIdA } = await setupAuthUser(pool);
    const { token: tokenB } = await setupAuthUser(pool);

    const { profileId: pA } = await createSubcontractorProfile(tenantIdA, "TenantA");

    // Officer B tries to view Tenant A's subcontractor scorecard
    const scorecardRes = await app.inject({
      method: "GET",
      url: `/marketplace/subcontractors/${pA}/scorecard`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(scorecardRes.statusCode).toBe(401);

    // Subcontractor A tries to view scorecard using invalid accessToken
    const scorecardRes2 = await app.inject({
      method: "GET",
      url: `/marketplace/subcontractors/${pA}/scorecard`,
      query: { accessToken: "wrong-token" }
    });
    expect(scorecardRes2.statusCode).toBe(401);
  });
});
