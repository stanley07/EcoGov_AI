import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser, createTestTenant, createTestUser, createTestSession } from "./platform-admin-test-helpers.js";
import { AccessTokenService } from "@govos/core";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

async function assignTenantRole(pool: Pool, userId: string, roleName: string, tenantId: string) {
  const roleRes = await pool.query("SELECT id FROM role WHERE name = $1 AND tenant_id = $2", [roleName, tenantId]);
  let roleId: string;
  if (roleRes.rows.length > 0) {
    roleId = roleRes.rows[0].id;
  } else {
    roleId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO role (id, tenant_id, name, description, is_system) VALUES ($1, $2, $3, $4, TRUE)",
      [roleId, tenantId, roleName, `Canonical ${roleName} test role`]
    );
  }
  await pool.query("INSERT INTO membership (id, user_id, role_id, tenant_id) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), userId, roleId, tenantId]);
  const tenantMatch = await pool.query(
    `SELECT 1 FROM membership m
     JOIN user_account u ON u.id = m.user_id
     JOIN role r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.tenant_id = $2
       AND u.tenant_id = m.tenant_id AND r.tenant_id = m.tenant_id`,
    [userId, tenantId]
  );
  if (tenantMatch.rowCount !== 1) throw new Error("Test membership must use a role from the same tenant");
}

async function seedWorkflowForTenant(pool: Pool, tenantId: string, userId: string) {
  const wfDefId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO workflow_definition (id, tenant_id, name, description)
     VALUES ($1, $2, 'facility_registration', 'Test registration workflow')`,
    [wfDefId, tenantId]
  );

  const wfVerId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO workflow_version (id, tenant_id, definition_id, version_number, status, published_at, published_by, configuration_hash)
     VALUES ($1, $2, $3, 1, 'active', NOW(), $4, 'initial-hash')`,
    [wfVerId, tenantId, wfDefId, userId]
  );

  const stepIds = {
    submission: crypto.randomUUID(),
    ai_review: crypto.randomUUID(),
    officer_review: crypto.randomUUID(),
    approved: crypto.randomUUID(),
    rejected: crypto.randomUUID(),
  };

  for (const [name, id] of Object.entries(stepIds)) {
    const isEntry = name === "submission";
    const isTerminal = name === "approved" || name === "rejected";
    await pool.query(
      `INSERT INTO workflow_step_definition (id, tenant_id, version_id, step_name, step_type, is_entry_step, is_terminal_step, configuration, configuration_schema_version)
       VALUES ($1, $2, $3, $4, 'human_review', $5, $6, '{}'::jsonb, '1.0')`,
      [id, tenantId, wfVerId, name, isEntry, isTerminal]
    );
  }

  const transitions = [
    { from: "submission", to: "ai_review", trigger: "submit" },
    { from: "ai_review", to: "officer_review", trigger: "ai_complete" },
    { from: "officer_review", to: "approved", trigger: "approve" },
    { from: "officer_review", to: "rejected", trigger: "reject" },
  ];

  for (const trans of transitions) {
    const fromId = stepIds[trans.from as keyof typeof stepIds];
    const toId = stepIds[trans.to as keyof typeof stepIds];
    await pool.query(
      `INSERT INTO workflow_transition (tenant_id, version_id, from_step_definition_id, outcome_code, to_step_definition_id, condition_expression, priority)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 1)`,
      [tenantId, wfVerId, fromId, trans.trigger, toId]
    );
  }
}

describe("Facility Registry & Wizard Backend Foundation Tests", () => {
  let pool: Pool;
  let app: any;
  let tenantId: string;
  let token: string;
  let userId: string;
  let organizationId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;

    const auth = await setupAuthUser(pool);
    tenantId = auth.tenantId;
    token = auth.token;
    userId = auth.userId;

    // Assign 'super_admin' role to test user so they can read and write facilities
    await assignTenantRole(pool, userId, "super_admin", tenantId);

    organizationId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organization (id, tenant_id, name, status)
       VALUES ($1, $2, 'Ministry organization', 'active')`,
      [organizationId, tenantId]
    );

    // Seed workflows
    await seedWorkflowForTenant(pool, tenantId, userId);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM registration_review WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM complaint_triage_review WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_screening_result WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_quality_audit WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_model_call WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_policy_decision WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_tool_invocation WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_execution_attempt WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_execution_event WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_usage_reservation WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM ai_execution WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_step_execution WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_audit WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_instance WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_transition WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_step_definition WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_version WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM workflow_definition WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM task_execution WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM authz_audit_log WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM facility_registration WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM facility WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM organization WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM session WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM membership WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM user_account WHERE id = $1", [userId]);
    await pool.query("DELETE FROM role WHERE tenant_id = $1 AND name = 'super_admin'", [tenantId]);
    await pool.query("ALTER TABLE subcontractor_facility_attribution DISABLE TRIGGER trg_protect_facility_attribution");
    await pool.query("DELETE FROM subcontractor_facility_attribution WHERE tenant_id = $1", [tenantId]);
    await pool.query("ALTER TABLE subcontractor_facility_attribution ENABLE TRIGGER trg_protect_facility_attribution");
    await pool.query("DELETE FROM subcontractor_assignment WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_licence WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_profile WHERE tenant_id = $1", [tenantId]);
    await pool.query("ALTER TABLE subcontractor_application_event DISABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("DELETE FROM subcontractor_application_event WHERE tenant_id = $1", [tenantId]);
    await pool.query("ALTER TABLE subcontractor_application_event ENABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("DELETE FROM marketplace_invoice WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_application WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM local_government_area WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM cluster WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM tenant WHERE id = $1", [tenantId]);
    await pool.end();
  });

  // --- GET /facilities tests ---

  test("1. GET /facilities default listing return correctly paginated metadata and headers", async () => {
    // Insert some mock facilities
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, registration_source, created_by, registered_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          crypto.randomUUID(),
          tenantId,
          organizationId,
          `Test Facility ${i}`,
          "Car Wash",
          `Street Address ${i}`,
          6.15,
          6.78,
          "approved",
          "low",
          "officer",
          userId
        ]
      );
    }

    const res = await app.inject({
      method: "GET",
      url: "/facilities?limit=2&offset=0",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBe(2);
    expect(body.pagination.total).toBeGreaterThanOrEqual(5);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.hasNext).toBe(true);

    expect(res.headers["x-total-count"]).toBeDefined();
    expect(res.headers["x-limit"]).toBe("2");
    expect(res.headers["x-offset"]).toBe("0");
  });

  test("2. GET /facilities combined status, riskRating, and search filter execution", async () => {
    // Insert a specific facility to match search and filters
    const matchedId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, registration_source, created_by, registered_by_user_id)
       VALUES ($1, $2, $3, 'Anambra Cleaners Inc.', 'Guest House', 'Avenue Road, Awka', 6.2, 6.8, 'rejected', 'medium', 'officer', $4, $4)`,
      [matchedId, tenantId, organizationId, userId]
    );

    const res = await app.inject({
      method: "GET",
      url: "/facilities?status=rejected&riskRating=medium&search=cleaners",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.some((item: any) => item.id === matchedId)).toBe(true);
  });

  test("3. GET /facilities strict whitelisted sorting parameter mapping", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/facilities?sortBy=businessName&sortOrder=asc",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items).toBeDefined();
  });

  test("4. GET /facilities invalid filter/sort parameter values rejection (400 Bad Request)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/facilities?sortBy=maliciousColumn&sortOrder=invalid",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(400);
  });

  test("5. GET /facilities bounds enforcement (limit, offset)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/facilities?limit=250", // Exceeds max limit 100
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(400);
  });

  test("6. GET /facilities cross-tenant queries isolation", async () => {
    // Set up a second tenant and session
    const secondTenant = await createTestTenant(pool);
    const secondUserId = await createTestUser(pool, secondTenant.id);
    const secondToken = await createTestSession(pool, secondTenant.id, secondUserId);
    await assignTenantRole(pool, secondUserId, "super_admin", secondTenant.id);

    const res = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${secondToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Should NOT see first tenant's facilities
    expect(body.items.every((item: any) => item.tenantId === secondTenant.id)).toBe(true);

    // Clean up second tenant
    await pool.query("DELETE FROM membership WHERE user_id = $1", [secondUserId]);
    await pool.query("DELETE FROM session WHERE user_id = $1", [secondUserId]);
    await pool.query("DELETE FROM user_account WHERE id = $1", [secondUserId]);
    await pool.query("DELETE FROM role WHERE tenant_id = $1 AND name = 'super_admin'", [secondTenant.id]);
    await pool.query("DELETE FROM local_government_area WHERE tenant_id = $1", [secondTenant.id]);
    await pool.query("DELETE FROM cluster WHERE tenant_id = $1", [secondTenant.id]);
    await pool.query("DELETE FROM tenant WHERE id = $1", [secondTenant.id]);
  });

  // --- POST /facilities/register tests ---

  test("7. POST /facilities/register derives source as 'officer' and captures user details", async () => {
    const clientSubmissionId = `sub-${crypto.randomUUID()}`;
    const payload = {
      organizationId,
      businessName: "Officer Created Clinic",
      category: "Clinic",
      address: "456 Hospital Road, Awka",
      latitude: 6.2045,
      longitude: 6.8923,
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Dr. Stanley",
      contactEmail: "stanley@clinic.gov.ng",
      clientSubmissionId
    };

    const res = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.facilityId).toBeDefined();

    // Verify written source and actor ID in database
    const dbFac = await pool.query("SELECT registration_source, registered_by_user_id FROM facility WHERE id = $1", [body.facilityId]);
    expect(dbFac.rows[0].registration_source).toBe("officer");
    expect(dbFac.rows[0].registered_by_user_id).toBe(userId);
  });

  test("8. POST /facilities/register idempotency replay handles duplicates safely", async () => {
    const clientSubmissionId = `sub-${crypto.randomUUID()}`;
    const payload = {
      organizationId,
      businessName: "Idempotent Guest House",
      category: "Guest House",
      address: "789 Hotel Lane, Awka",
      latitude: 6.2111,
      longitude: 6.8122,
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Manager Jane",
      contactEmail: "jane@guesthouse.ng",
      clientSubmissionId
    };

    // First call
    const res1 = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    expect(res1.statusCode).toBe(201);
    const result1 = JSON.parse(res1.payload);

    // Second call with same submission ID and payload
    const res2 = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    expect(res2.statusCode).toBe(200);
    const result2 = JSON.parse(res2.payload);

    expect(result2.facilityId).toBe(result1.facilityId);
    expect(result2.referenceNumber).toBe(result1.referenceNumber);
  });

  test("9. POST /facilities/register invalid coordinates boundaries rejection", async () => {
    const payload = {
      organizationId,
      businessName: "Bad Coordinate Hotel",
      category: "Hotel",
      address: "Invalid Road, Awka",
      latitude: 105.0, // Invalid lat (> 90)
      longitude: 6.8122,
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Manager Jane",
      contactEmail: "jane@guesthouse.ng",
      clientSubmissionId: `sub-${crypto.randomUUID()}`
    };

    const res = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });

    expect(res.statusCode).toBe(400);
  });

  test("10. POST /facilities/register business duplicate detection warning (409 Conflict)", async () => {
    // Register the first facility
    const clientSubmissionId1 = `sub-${crypto.randomUUID()}`;
    const payload = {
      organizationId,
      businessName: "Duplicate Clinic",
      category: "Clinic",
      address: "123 Same Street, Awka",
      latitude: 6.2045,
      longitude: 6.8923,
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Dr. Stanley",
      contactEmail: "dup1@clinic.gov.ng",
      clientSubmissionId: clientSubmissionId1
    };

    const res1 = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    expect(res1.statusCode).toBe(201);

    // Register a duplicate facility (different submission ID but same normalized name, address, LGA)
    const clientSubmissionId2 = `sub-${crypto.randomUUID()}`;
    const dupPayload = {
      ...payload,
      contactEmail: "dup2@clinic.gov.ng",
      clientSubmissionId: clientSubmissionId2
    };

    const res2 = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload: dupPayload
    });

    expect(res2.statusCode).toBe(409);
    const body = JSON.parse(res2.payload);
    expect(body.error).toContain("duplicate facility detected");
    expect(body.existingFacilityId).toBeDefined();
    expect(body.confidence).toBe("high");
  });

  test("11. POST /facilities/register officer duplicate override success", async () => {
    const clientSubmissionId = `sub-${crypto.randomUUID()}`;
    const payload = {
      organizationId,
      businessName: "Duplicate Clinic",
      category: "Clinic",
      address: "123 Same Street, Awka",
      latitude: 6.2045,
      longitude: 6.8923,
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Dr. Stanley",
      contactEmail: "dup3@clinic.gov.ng",
      clientSubmissionId,
      overrideReason: "Legitimate second branch verified by officer"
    };

    const res = await app.inject({
      method: "POST",
      url: "/facilities/register",
      headers: { authorization: `Bearer ${token}` },
      payload
    });

    expect(res.statusCode).toBe(201);
  });

  test("12. Subcontractor duplicate registration rejection without override capability", async () => {
    // Seed subcontractor structures
    const appId = crypto.randomUUID();
    const subProfileId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const lgaId = crypto.randomUUID();
    
    // Seed LGA
    await pool.query(
      `INSERT INTO local_government_area (id, tenant_id, name, state_name)
       VALUES ($1, $2, 'Awka North', 'Anambra')`,
      [lgaId, tenantId]
    );

    const rawToken = `sub-token-${crypto.randomUUID()}`;
    const clientHash = AccessTokenService.hashToken(rawToken);

    const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
    const regNum = `REG-SUB-${rand}`;
    const taxId = `TAX-SUB-${rand}`;
    const invNum = `SUB-INV-${rand}`;
    const licNum = `LIC-SUB-${rand}`;

    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status
      ) VALUES ($1, $2, 'Sub Clinic Ltd', $4, $5, 'sub@test.gov.ng', '0802233', 'Lagos', 5, 'environmental-consultant', $3, 'approved')
    `, [appId, tenantId, clientHash, regNum, taxId]);

    await pool.query(`
      INSERT INTO subcontractor_profile (
        id, tenant_id, application_id, business_name, status, performance_score, version
      ) VALUES ($1, $2, $3, 'Sub Clinic Ltd', 'active', 5.00, 1)
    `, [subProfileId, tenantId, appId]);

    await pool.query(`
      INSERT INTO marketplace_invoice (
        id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status
      ) VALUES ($1, $2, $3, $4, NOW(), NOW() + interval '1 year', 500000000, 'USD', 'paid')
    `, [invoiceId, tenantId, appId, invNum]);

    await pool.query(`
      INSERT INTO subcontractor_licence (
        tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'environmental-consultant', 'active', NOW(), NOW(), NOW() + interval '1 year', 1)
    `, [tenantId, subProfileId, invoiceId, licNum, crypto.randomUUID()]);

    await pool.query(`
      INSERT INTO subcontractor_assignment (
        id, tenant_id, subcontractor_id, status, assignment_type, lga_id, starts_at, assigned_by
      ) VALUES ($1, $2, $3, 'active', 'lga', $4, NOW(), $5)
    `, [crypto.randomUUID(), tenantId, subProfileId, lgaId, userId]);


    // First subcontractor registration (valid geography)
    const clientSubmissionId1 = `sub-${crypto.randomUUID()}`;
    const res1 = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${rawToken}`,
        "idempotency-key": clientSubmissionId1
      },
      payload: {
        businessName: "Subcontractor Duplicate Clinic",
        category: "Clinic",
        address: "789 Road, Awka North",
        latitude: 6.25,
        longitude: 6.9,
        town: "Awka North",
        lgaId,
        correlationId: crypto.randomUUID()
      }
    });

    expect(res1.statusCode).toBe(200);

    // Second registration with duplicate name, address, LGA name, but with overrideReason (which subcontractors cannot use)
    const clientSubmissionId2 = `sub-${crypto.randomUUID()}`;
    const res2 = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${rawToken}`,
        "idempotency-key": clientSubmissionId2
      },
      payload: {
        businessName: "Subcontractor Duplicate Clinic",
        category: "Clinic",
        address: "789 Road, Awka North",
        latitude: 6.25,
        longitude: 6.9,
        town: "Awka North",
        lgaId,
        correlationId: crypto.randomUUID(),
        overrideReason: "I am a subcontractor trying to override"
      }
    });

    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.payload);
    expect(body2.error).toContain("duplicate facility detected");

    // Clean up seeded subcontractor structures and LGA
    await pool.query("ALTER TABLE subcontractor_facility_attribution DISABLE TRIGGER trg_protect_facility_attribution");
    await pool.query("DELETE FROM subcontractor_facility_attribution WHERE subcontractor_id = $1", [subProfileId]);
    await pool.query("ALTER TABLE subcontractor_facility_attribution ENABLE TRIGGER trg_protect_facility_attribution");
    await pool.query("DELETE FROM subcontractor_assignment WHERE subcontractor_id = $1", [subProfileId]);
    await pool.query("DELETE FROM subcontractor_licence WHERE subcontractor_id = $1", [subProfileId]);
    await pool.query("DELETE FROM facility_registration WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM facility WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM subcontractor_profile WHERE id = $1", [subProfileId]);
    await pool.query("ALTER TABLE subcontractor_application_event DISABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("DELETE FROM subcontractor_application_event WHERE tenant_id = $1", [tenantId]);
    await pool.query("ALTER TABLE subcontractor_application_event ENABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("DELETE FROM marketplace_invoice WHERE application_id = $1", [appId]);
    await pool.query("DELETE FROM subcontractor_application WHERE id = $1", [appId]);
    await pool.query("DELETE FROM local_government_area WHERE id = $1", [lgaId]);
  });
});
