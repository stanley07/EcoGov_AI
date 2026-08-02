import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser } from "./platform-admin-test-helpers.js";
import { LicenceIssuanceService } from "@govos/core";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";
const webhookSecret = process.env.WEBHOOK_SECRET || "mock-secret-key";

describe("Subcontractor Onboarding & Monetization E2E System Boundary Tests", () => {
  let pool: Pool;
  let app: any;
  let tenantId: string;
  let officerToken: string;
  let officerUserId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;

    // Create an officer session on a new tenant
    const auth = await setupAuthUser(pool);
    tenantId = auth.tenantId;
    officerToken = auth.token;
    officerUserId = auth.userId;

    // Create a mock organization for the tenant
    await pool.query(
      `INSERT INTO organization (id, tenant_id, name, status) 
       VALUES ($1, $2, 'Default Ministry Org', 'active')`,
      [crypto.randomUUID(), tenantId]
    );
  });

  afterAll(async () => {
    // Disable triggers during final deletion to keep it clean
    await pool.query("ALTER TABLE subcontractor_application_event DISABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("ALTER TABLE subcontractor_facility_attribution DISABLE TRIGGER trg_protect_facility_attribution");
    await pool.query("ALTER TABLE marketplace_revenue_ledger DISABLE TRIGGER trg_protect_revenue_ledger");

    try {
      await pool.query("DELETE FROM subcontractor_appeal WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_enforcement_action WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_quality_audit WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_facility_attribution WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM facility_registration WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM facility WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_assignment WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_licence WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_profile WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM marketplace_revenue_ledger WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM marketplace_payment WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM marketplace_invoice WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_screening_result WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_model_call WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_tool_invocation WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_policy_decision WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_tool_invocation WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_execution_attempt WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_execution_event WHERE ai_execution_id IN (SELECT id FROM ai_execution WHERE tenant_id = $1) OR tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_usage_reservation WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM ai_execution WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application_snapshot WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application_document WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM outbox_event WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application_event WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM cluster WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM local_government_area WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM organization WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM tenant WHERE id = $1", [tenantId]);
    } finally {
      await pool.query("ALTER TABLE subcontractor_application_event ENABLE TRIGGER trg_protect_subcontractor_application_event");
      await pool.query("ALTER TABLE subcontractor_facility_attribution ENABLE TRIGGER trg_protect_facility_attribution");
      await pool.query("ALTER TABLE marketplace_revenue_ledger ENABLE TRIGGER trg_protect_revenue_ledger");
    }

    await pool.end();
  });

  function computeSignature(payload: string, secret: string = webhookSecret): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  test("1. Subcontractor application lifecycle from draft -> licence issued -> assignment -> register facility", async () => {
    // Phase A: Create Application (Draft)
    const createRes = await app.inject({
      method: "POST",
      url: "/marketplace/applications",
      payload: {
        tenantId,
        businessName: "E2E Subcontractor",
        registrationNumber: `REG-E2E-${crypto.randomUUID().substring(0, 6)}`,
        taxIdentifier: `TAX-E2E-${crypto.randomUUID().substring(0, 6)}`,
        contactEmail: "e2e@sub.ng",
        contactPhone: "08055551122",
        operatingAddress: "123 Awka Road, Onitsha",
        experienceYears: 6,
        licenseType: "environmental-consultant"
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.body);
    const appId = createBody.applicationId;
    const accessToken = createBody.accessToken;

    expect(appId).toBeDefined();
    expect(accessToken).toBeDefined();

    // Verify application state is draft in database
    const dbAppDraft = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(dbAppDraft.rows[0].status).toBe("draft");
    expect(dbAppDraft.rows[0].version).toBe(1);

    // Seed compliance document directly to satisfy SubmissionService document check
    await pool.query(
      `INSERT INTO subcontractor_application_document (
         id, tenant_id, application_id, document_type, storage_key, content_hash, mime_type, size_bytes, scan_status, verification_status
       ) VALUES ($1, $2, $3, 'tax_registry', 'key-123', 'hash-123', 'application/pdf', 1024, 'passed', 'verified')`,
      [crypto.randomUUID(), tenantId, appId]
    );

    // Phase B: Submit Application (transitions status to screening_queued)
    const submitRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/submit`,
      payload: {
        accessToken,
        expectedVersion: 1
      }
    });
    console.log("SUBMIT RES BODY:", submitRes.body);
    expect(submitRes.statusCode).toBe(200);

    const dbAppSubmitted = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(dbAppSubmitted.rows[0].status).toBe("screening_queued");

    // Phase C: Mock Asynchronous AI Screening completed & transitioned to awaiting_officer_review
    const executionId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO ai_execution (
        id, tenant_id, agent_name, model_provider, model_name,
        prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
      ) VALUES ($1, $2, 'screening-agent', 'gemini', 'gemini-1.5-pro', '1.0.0', 'hash', 'succeeded', 'completed', 'valid', NOW(), 'system')
    `, [executionId, tenantId]);

    // Fetch the real snapshot hash generated by SubmissionService
    const snapRes = await pool.query(
      "SELECT input_snapshot_hash FROM subcontractor_application_snapshot WHERE application_id = $1",
      [appId]
    );
    const snapHash = snapRes.rows[0].input_snapshot_hash;

    const screeningResultId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_screening_result (
        id, tenant_id, application_id, ai_execution_id, screening_policy_version,
        input_snapshot_hash, screening_status, application_version, recommendation, score, criteria, model_version, risk_flags
      ) VALUES ($1, $2, $3, $4, '1.0.0', $5, 'completed', 2, 'recommended', 92.50, '[]'::jsonb, 'gemini-1.5-pro', ARRAY[]::varchar[])
    `, [screeningResultId, tenantId, appId, executionId, snapHash]);

    await pool.query(
      "UPDATE subcontractor_application SET status = 'awaiting_officer_review', version = 2 WHERE id = $1",
      [appId]
    );

    // Phase D: Officer Reviews and Approves Application (transitions to invoice_pending)
    const approveRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${officerToken}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Meets all criteria",
        screeningResultId
      }
    });
    if (approveRes.statusCode !== 200) {
      console.log("APPROVE ERROR BODY:", approveRes.body);
    }
    expect(approveRes.statusCode).toBe(200);

    const dbAppApproved = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(dbAppApproved.rows[0].status).toBe("invoice_pending");

    // Phase E: Subcontractor Creates Checkout Session (transitions to payment_pending)
    const checkoutRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: {
        accessToken,
        expectedVersion: 3
      }
    });
    expect(checkoutRes.statusCode).toBe(200);
    const checkoutBody = JSON.parse(checkoutRes.body);
    const checkoutSessionId = checkoutBody.checkoutSessionId;
    const paymentId = checkoutBody.paymentId;

    expect(checkoutSessionId).toBeDefined();
    expect(paymentId).toBeDefined();

    const dbAppPaymentPending = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(dbAppPaymentPending.rows[0].status).toBe("payment_pending");

    // Phase F: Stripe Webhook confirms payment
    const webhookPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: `tx-ref-e2e-${crypto.randomUUID().substring(0, 6)}`,
      amount: 500000000,
      currency: "ngn"
    };
    const rawBody = JSON.stringify(webhookPayload);
    const webhookRes = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: {
        "x-webhook-signature": computeSignature(rawBody),
        "content-type": "application/json"
      },
      payload: rawBody
    });
    if (webhookRes.statusCode !== 200) {
      console.log("WEBHOOK ERROR BODY:", webhookRes.body);
    }
    expect(webhookRes.statusCode).toBe(200);

    const dbAppPaid = await pool.query("SELECT status, version FROM subcontractor_application WHERE id = $1", [appId]);
    expect(dbAppPaid.rows[0].status).toBe("payment_confirmed");

    // Phase G: Mock Worker outbox processing -> issues licence
    const outboxRes = await pool.query("SELECT * FROM outbox_event WHERE tenant_id = $1 AND event_type = 'subcontractor_application.payment_confirmed'", [tenantId]);
    expect(outboxRes.rows.length).toBe(1);

    const outboxEvent = outboxRes.rows[0];
    const outboxPayload = typeof outboxEvent.payload === "string" ? JSON.parse(outboxEvent.payload) : outboxEvent.payload;

    const issuanceService = new LicenceIssuanceService(pool);
    const issuanceResult = await issuanceService.issueLicence(
      outboxPayload.tenantId,
      outboxPayload.applicationId,
      outboxPayload.invoiceId,
      outboxPayload.paymentId,
      outboxEvent.id,
      outboxPayload.applicationVersion
    );
    expect(issuanceResult.subcontractorLicence).toBeDefined();
    expect(issuanceResult.subcontractorLicence.status).toBe("active");
    expect(issuanceResult.subcontractorProfile).toBeDefined();

    const subcontractorId = issuanceResult.subcontractorProfile.id;

    // Phase H: Officer Assigns Territory (LGA)
    // First let's get the seeded LGA ID from the tenant
    const lgaRes = await pool.query("SELECT id FROM local_government_area WHERE tenant_id = $1 LIMIT 1", [tenantId]);
    const lgaId = lgaRes.rows[0].id;

    const assignRes = await app.inject({
      method: "POST",
      url: "/marketplace/assignments",
      headers: { authorization: `Bearer ${officerToken}` },
      payload: {
        subcontractorId,
        assignmentType: "lga",
        targetId: lgaId,
        startsAt: new Date().toISOString()
      }
    });
    expect(assignRes.statusCode).toBe(201);

    // Phase I: Subcontractor registers a facility inside territory
    const registerPayload = {
      businessName: "E2E Registered Facility",
      category: "waste-disposal",
      address: "123 Awka Road, Onitsha",
      latitude: 6.22,
      longitude: 7.07,
      lgaId,
      correlationId: crypto.randomUUID()
    };

    const idempotencyKey = `idemp-key-e2e-${crypto.randomUUID()}`;

    const regRes = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": idempotencyKey
      },
      payload: registerPayload
    });
    if (regRes.statusCode !== 200) {
      console.log("REGISTRATION ERROR BODY:", regRes.body);
    }
    expect(regRes.statusCode).toBe(200);
    const regBody = JSON.parse(regRes.body);
    expect(regBody.attribution?.id).toBeDefined();

    // Verify attribution records
    const dbAttr = await pool.query("SELECT * FROM subcontractor_facility_attribution WHERE id = $1", [regBody.attribution.id]);
    expect(dbAttr.rows[0].registration_status).toBe("completed");

    // Phase J: Idempotency check 1 (Resend same key, same payload) -> expect same response/success
    const regResDup = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": idempotencyKey
      },
      payload: registerPayload
    });
    expect(regResDup.statusCode).toBe(200);
    const regBodyDup = JSON.parse(regResDup.body);
    expect(regBodyDup.attribution?.id).toBe(regBody.attribution.id);

    // Phase K: Idempotency check 2 (Resend same key, different payload) -> expect 409 conflict
    const differentPayload = {
      ...registerPayload,
      businessName: "Another Name entirely"
    };
    const regResConflict = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": idempotencyKey
      },
      payload: differentPayload
    });
    expect(regResConflict.statusCode).toBe(409);

    // Phase L: Geographic boundary violation (Attempt to register with another LGA ID)
    const randomLgaId = crypto.randomUUID();
    const badGeoPayload = {
      ...registerPayload,
      lgaId: randomLgaId,
      correlationId: crypto.randomUUID()
    };
    const regResBadGeo = await app.inject({
      method: "POST",
      url: "/marketplace/facilities/register",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": `idemp-key-e2e-${crypto.randomUUID()}`
      },
      payload: badGeoPayload
    });
    expect(regResBadGeo.statusCode).toBe(400);
  });
});
