import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import * as crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser, createTestTenant } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Officer Review Integration Tests (PA-4 Phase 3)", () => {
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

  async function createApplicationAndScreening(
    tenantId: string,
    businessName: string,
    recommendation: "recommended" | "needs_review" | "high_risk",
    score: number
  ) {
    // 1. Insert application directly in awaiting_officer_review state to skip worker timer dependency
    const appId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, status, business_name, registration_number, tax_identifier,
        contact_email, contact_phone, operating_address, experience_years, license_type, version, access_token_hash
      ) VALUES ($1, $2, 'awaiting_officer_review', $3, 'REG-REV', 'TAX-REV', 'rev@test.gov.ng', '080', 'Lagos', 5, 'environmental-consultant', 2, 'dummy-hash')
    `, [appId, tenantId, businessName]);

    // 2. Insert mock snapshot
    const snapHash = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_application_snapshot (
        tenant_id, application_id, application_version, input_schema_version, canonical_payload, input_snapshot_hash
      ) VALUES ($1, $2, 2, '1', '{"mock": true}', $3)
    `, [tenantId, appId, snapHash]);

    // 3. Insert mock ai_execution record to satisfy foreign key
    const executionId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO ai_execution (
        id, tenant_id, agent_name, model_provider, model_name,
        prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
      ) VALUES ($1, $2, 'test-agent', 'deterministic', 'simulator', '1.0.0', 'hash', 'succeeded', 'completed', 'valid', NOW(), 'system')
    `, [executionId, tenantId]);

    // 4. Insert screening result with criteria
    const resultId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_screening_result (
        id, tenant_id, application_id, ai_execution_id, screening_policy_version,
        input_snapshot_hash, screening_status, application_version, recommendation, score, criteria, model_version
      ) VALUES ($1, $2, $3, $4, '1.0.0', $5, 'completed', 2, $6, $7, '[]', 'mock-model')
    `, [resultId, tenantId, appId, executionId, snapHash, recommendation, score]);

    return { appId, resultId };
  }

  test("1. Officer can approve a recommended application, transitions state to invoice_pending", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Good Subcontractor Ltd", "recommended", 95);

    const res = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Meets all criteria.",
        screeningResultId: resultId
      }
    });

    expect(res.statusCode).toBe(200);
    const appQuery = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(appQuery.rows[0].status).toBe("invoice_pending");
    expect(appQuery.rows[0].version).toBe(3); // Incremented
  });

  test("2. Officer approval of a high_risk application requires an overrideReason", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Risky Business Ltd", "high_risk", 35);

    // Fail without overrideReason
    const failRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Accept anyway.",
        screeningResultId: resultId
      }
    });
    expect(failRes.statusCode).toBe(400);
    expect(JSON.parse(failRes.body).error).toContain("Override reason is required");

    // Pass with overrideReason
    const passRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Accept anyway.",
        screeningResultId: resultId,
        overrideReason: "Officer reviewed safety profile manually."
      }
    });
    expect(passRes.statusCode).toBe(200);
  });

  test("3. Officer can request information, transitions state to more_information_required", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Incomplete Ltd", "needs_review", 65);

    const res = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/request-information`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Please upload tax registry documents for 2025.",
        screeningResultId: resultId
      }
    });

    expect(res.statusCode).toBe(200);
    const appQuery = await pool.query("SELECT status FROM subcontractor_application WHERE id = $1", [appId]);
    expect(appQuery.rows[0].status).toBe("more_information_required");
  });

  test("4. Stale version concurrency returns conflict 409", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Stale Ltd", "recommended", 80);

    const res = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 999, // Stale version
        decisionReason: "Okay",
        screeningResultId: resultId
      }
    });

    expect(res.statusCode).toBe(409);
  });

  test("5. Officer cannot review application of another tenant", async () => {
    const tenantA = await createTestTenant(pool);
    const officerB = await setupAuthUser(pool); // tenant B

    const { appId, resultId } = await createApplicationAndScreening(tenantA.id, "Tenant A Company", "recommended", 90);

    const res = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${officerB.token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Attempt hack",
        screeningResultId: resultId
      }
    });

    // Should fail because application is not found under officer B's tenant context
    expect(res.statusCode).toBe(400);
  });
});
