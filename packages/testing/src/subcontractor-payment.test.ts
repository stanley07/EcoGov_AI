import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { AccessTokenService, LicenceIssuanceService } from "@govos/core";
import { 
  setupTestEnvironment, 
  createTestTenant, 
  createTestUser, 
  createTestSession 
} from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";
const webhookSecret = process.env.WEBHOOK_SECRET || "mock-secret-key";

describe("Subcontractor Payment Integration Tests (PA-4 Phase 4)", () => {
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

  async function setupAuthUser(pool: Pool) {
    const tenant = await createTestTenant(pool);
    const userId = await createTestUser(pool, tenant.id);
    const token = await createTestSession(pool, tenant.id, userId);
    return { tenantId: tenant.id, token, userId };
  }

  async function createApplicationAndScreening(tenantId: string, businessName: string, recommendation: string, score: number) {
    const appId = crypto.randomUUID();
    const tokenHash = AccessTokenService.hashToken("raw-token");
    
    const regSuffix = crypto.randomBytes(4).toString("hex");
    const taxSuffix = crypto.randomBytes(4).toString("hex");

    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, status, business_name, registration_number, tax_identifier,
        contact_email, contact_phone, operating_address, experience_years, license_type, version, access_token_hash
      ) VALUES ($1, $2, 'awaiting_officer_review', $3, $4, $5, 'rev@test.gov.ng', '080', 'Lagos', 5, 'environmental-consultant', 2, $6)
    `, [appId, tenantId, businessName, `REG-${regSuffix}`, `TAX-${taxSuffix}`, tokenHash]);

    const snapHash = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_application_snapshot (
        tenant_id, application_id, application_version, input_schema_version, canonical_payload, input_snapshot_hash
      ) VALUES ($1, $2, 2, '1', '{"mock": true}', $3)
    `, [tenantId, appId, snapHash]);

    const executionId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO ai_execution (
        id, tenant_id, agent_name, model_provider, model_name,
        prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
      ) VALUES ($1, $2, 'test-agent', 'deterministic', 'simulator', '1.0.0', 'hash', 'succeeded', 'completed', 'valid', NOW(), 'system')
    `, [executionId, tenantId]);

    const resultId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_screening_result (
        id, tenant_id, application_id, ai_execution_id, screening_policy_version,
        input_snapshot_hash, screening_status, application_version, recommendation, score, criteria, model_version
      ) VALUES ($1, $2, $3, $4, '1.0.0', $5, 'completed', 2, $6, $7, '[]', 'mock-model')
    `, [resultId, tenantId, appId, executionId, snapHash, recommendation, score]);

    return { appId, resultId };
  }

  function computeSignature(payload: string, secret: string = webhookSecret): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  test("1. Application approval generates invoice, checkout-session is idempotent", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Payment Inc", "recommended", 85);

    // Approve the application
    const approveRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        expectedVersion: 2,
        decisionReason: "Accept",
        screeningResultId: resultId
      }
    });
    expect(approveRes.statusCode).toBe(200);

    // Verify invoice was created
    const invoiceQuery = await pool.query(
      "SELECT * FROM marketplace_invoice WHERE application_id = $1",
      [appId]
    );
    expect(invoiceQuery.rows.length).toBe(1);
    expect(invoiceQuery.rows[0].status).toBe("unpaid");
    expect(Number(invoiceQuery.rows[0].amount_due_microunits)).toBe(500000000);
    expect(invoiceQuery.rows[0].currency).toBe("NGN");

    // Call checkout session with invalid token -> 401
    const invalidSession = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: {
        accessToken: "wrong-token",
        expectedVersion: 3
      }
    });
    expect(invalidSession.statusCode).toBe(401);

    // Call checkout session with valid token -> 200
    const sessionRes1 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: {
        accessToken: "raw-token",
        expectedVersion: 3
      }
    });
    expect(sessionRes1.statusCode).toBe(200);
    const body1 = JSON.parse(sessionRes1.body);
    expect(body1.checkoutSessionId).toBeDefined();
    expect(body1.redirectUrl).toContain(body1.paymentId);

    // Call checkout session again -> should be idempotent and return same IDs
    const sessionRes2 = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: {
        accessToken: "raw-token",
        expectedVersion: 4 // version incremented after transition to payment_pending
      }
    });
    expect(sessionRes2.statusCode).toBe(200);
    const body2 = JSON.parse(sessionRes2.body);
    expect(body2.paymentId).toBe(body1.paymentId);
    expect(body2.checkoutSessionId).toBe(body1.checkoutSessionId);
  });

  test("2. Signature checking rejects invalid headers", async () => {
    const payloadObj = { id: "evt_test_sig", type: "checkout.session.completed" };
    const rawBody = JSON.stringify(payloadObj);

    const res = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: {
        "x-webhook-signature": "bad-signature",
        "content-type": "application/json"
      },
      payload: rawBody
    });
    expect(res.statusCode).toBe(401);
  });

  test("3. Webhook completes payment successfully and reconciles ledger", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Webhook Test Ltd", "recommended", 95);

    // Approve
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2, decisionReason: "Yes", screeningResultId: resultId }
    });

    // Create session
    const sessionRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: { accessToken: "raw-token", expectedVersion: 3 }
    });
    const { checkoutSessionId, paymentId } = JSON.parse(sessionRes.body);

    // Construct valid webhook payload
    const txRef = `ch_mock_tx_${crypto.randomBytes(4).toString("hex")}`;
    const webhookPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: txRef,
      amount: 500000000,
      currency: "ngn"
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    // Trigger webhook
    const res = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: {
        "x-webhook-signature": signature,
        "content-type": "application/json"
      },
      payload: rawBody
    });
    console.log("TEST 3 RESPONSE:", res.statusCode, res.body);
    expect(res.statusCode).toBe(200);

    // Verify application status is now payment_confirmed
    const appQuery = await pool.query(
      "SELECT status, version FROM subcontractor_application WHERE id = $1",
      [appId]
    );
    expect(appQuery.rows[0].status).toBe("payment_confirmed");

    // Verify invoice is paid
    const invoiceQuery = await pool.query(
      "SELECT status FROM marketplace_invoice WHERE application_id = $1",
      [appId]
    );
    expect(invoiceQuery.rows[0].status).toBe("paid");

    // Verify payment record is succeeded
    const paymentQuery = await pool.query(
      "SELECT status, provider_transaction_reference FROM marketplace_payment WHERE id = $1",
      [paymentId]
    );
    expect(paymentQuery.rows[0].status).toBe("succeeded");
    expect(paymentQuery.rows[0].provider_transaction_reference).toBe(txRef);

    // Verify revenue ledger has credit entry
    const ledgerQuery = await pool.query(
      "SELECT * FROM marketplace_revenue_ledger WHERE payment_id = $1",
      [paymentId]
    );
    expect(ledgerQuery.rows.length).toBe(1);
    expect(ledgerQuery.rows[0].entry_type).toBe("credit");
    expect(Number(ledgerQuery.rows[0].amount_microunits)).toBe(500000000);
    expect(ledgerQuery.rows[0].currency).toBe("NGN");

    // Verify payment event recorded latency metrics
    const eventQuery = await pool.query(
      "SELECT * FROM marketplace_payment_event WHERE webhook_event_id = $1",
      [webhookPayload.id]
    );
    expect(eventQuery.rows[0].processing_latency_ms).toBeGreaterThanOrEqual(0);
    expect(eventQuery.rows[0].signature_validation_duration_ms).toBeGreaterThanOrEqual(0);
    expect(eventQuery.rows[0].reconciliation_duration_ms).toBeGreaterThanOrEqual(0);

    // 4. Verify outbox event is queued
    const outboxQuery = await pool.query(
      "SELECT * FROM outbox_event WHERE tenant_id = $1 AND event_type = 'subcontractor_application.payment_confirmed'",
      [tenantId]
    );
    expect(outboxQuery.rows.length).toBe(1);
    const outboxEvent = outboxQuery.rows[0];
    const outboxPayload = typeof outboxEvent.payload === "string" ? JSON.parse(outboxEvent.payload) : outboxEvent.payload;

    // 5. Invoke LicenceIssuanceService to issue the licence (simulating the worker processing the outbox event)
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
    expect(issuanceResult.subcontractorLicence.workerIssueDuration).toBeGreaterThanOrEqual(0);
    expect(issuanceResult.subcontractorProfile).toBeDefined();
    expect(issuanceResult.subcontractorProfile.status).toBe("active");

    // Verify application status transitioned to licence_issued
    const appQueryAfterIssuance = await pool.query(
      "SELECT status FROM subcontractor_application WHERE id = $1",
      [appId]
    );
    expect(appQueryAfterIssuance.rows[0].status).toBe("licence_issued");

    // 6. Test Idempotency: Re-running/replaying the outbox event must return the same licence without throwing or duplicating
    const replayResult = await issuanceService.issueLicence(
      outboxPayload.tenantId,
      outboxPayload.applicationId,
      outboxPayload.invoiceId,
      outboxPayload.paymentId,
      outboxEvent.id,
      outboxPayload.applicationVersion
    );
    expect(replayResult.subcontractorLicence.id).toBe(issuanceResult.subcontractorLicence.id);
    expect(replayResult.subcontractorProfile.id).toBe(issuanceResult.subcontractorProfile.id);

    // 7. Test Public QR Verification endpoint
    const verificationCode = issuanceResult.subcontractorLicence.verificationCode;
    const verifyRes = await app.inject({
      method: "GET",
      url: `/public/marketplace/licences/${verificationCode}`
    });
    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = JSON.parse(verifyRes.body);
    expect(verifyBody.verified).toBe(true);
    expect(verifyBody.verificationTime).toBeDefined();
    expect(verifyBody.issuingAuthority).toBe("Anambra State Ministry of Environment");
    expect(verifyBody.businessName).toBe("Webhook Test Ltd");
    expect(verifyBody.licenceNumber).toBe(issuanceResult.subcontractorLicence.licenceNumber);
    expect(verifyBody.email).toBeUndefined(); // PII redacted
    expect(verifyBody.contact_email).toBeUndefined(); // PII redacted
    expect(verifyBody.contact_phone).toBeUndefined(); // PII redacted

    // Webhook event deduplication check: trigger webhook again with exact same payload
    const resDup = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { 
        "x-webhook-signature": signature,
        "content-type": "application/json"
      },
      payload: rawBody
    });
    expect(resDup.statusCode).toBe(200);
    const bodyDup = JSON.parse(resDup.body);
    expect(bodyDup.deduplicated).toBe(true);

    // Verify ledger count did not duplicate
    const ledgerQuery2 = await pool.query(
      "SELECT COUNT(*) FROM marketplace_revenue_ledger WHERE payment_id = $1",
      [paymentId]
    );
    expect(Number(ledgerQuery2.rows[0].count)).toBe(1);
  });

  test("4. Webhook mismatch rejects transaction and updates state to failed", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Mismatch Ltd", "recommended", 95);

    // Approve
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2, decisionReason: "Yes", screeningResultId: resultId }
    });

    // Create session
    const sessionRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: { accessToken: "raw-token", expectedVersion: 3 }
    });
    const { checkoutSessionId } = JSON.parse(sessionRes.body);

    // Webhook payload with mismatched amount (e.g. $400 instead of $500)
    const txRef = `ch_mock_tx_${crypto.randomBytes(4).toString("hex")}`;
    const webhookPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: txRef,
      amount: 400000000,
      currency: "ngn"
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { 
        "x-webhook-signature": signature,
        "content-type": "application/json"
      },
      payload: rawBody
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Amount mismatch");

    // Verify database logged event in failed status
    const eventQuery = await pool.query(
      "SELECT * FROM marketplace_payment_event WHERE webhook_event_id = $1",
      [webhookPayload.id]
    );
    expect(eventQuery.rows[0].processing_status).toBe("failed");
    expect(eventQuery.rows[0].last_error_code).toBe("AMOUNT_MISMATCH");
  });

  test("5. Webhook processes refund events and records debit in ledger", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Refund Ltd", "recommended", 95);

    // Approve & Session & Payment
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2, decisionReason: "Yes", screeningResultId: resultId }
    });
    const sessionRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: { accessToken: "raw-token", expectedVersion: 3 }
    });
    const { checkoutSessionId, paymentId } = JSON.parse(sessionRes.body);

    const completedTxRef = `ch_refund_tx_${crypto.randomBytes(4).toString("hex")}`;
    const webhookPayloadCompleted = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: completedTxRef,
      amount: 500000000,
      currency: "ngn"
    };
    await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { 
        "x-webhook-signature": computeSignature(JSON.stringify(webhookPayloadCompleted)),
        "content-type": "application/json"
      },
      payload: JSON.stringify(webhookPayloadCompleted)
    });

    // Now issue refund
    const refundPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type: "charge.refunded",
      checkout_reference: checkoutSessionId,
      transaction_reference: completedTxRef,
      amount: 500000000,
      currency: "ngn"
    };
    const rawBody = JSON.stringify(refundPayload);
    const signature = computeSignature(rawBody);

    const res = await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { 
        "x-webhook-signature": signature,
        "content-type": "application/json"
      },
      payload: rawBody
    });
    expect(res.statusCode).toBe(200);

    // Verify payment is refunded
    const paymentQuery = await pool.query(
      "SELECT status FROM marketplace_payment WHERE id = $1",
      [paymentId]
    );
    expect(paymentQuery.rows[0].status).toBe("refunded");

    // Verify invoice is refunded
    const invoiceQuery = await pool.query(
      "SELECT status FROM marketplace_invoice WHERE application_id = $1",
      [appId]
    );
    expect(invoiceQuery.rows[0].status).toBe("refunded");

    // Verify ledger has debit refund entry
    const ledgerQuery = await pool.query(
      "SELECT * FROM marketplace_revenue_ledger WHERE payment_id = $1 AND entry_type = 'refund'",
      [paymentId]
    );
    expect(ledgerQuery.rows.length).toBe(1);
    expect(Number(ledgerQuery.rows[0].amount_microunits)).toBe(500000000);
  });

  test("6. Revenue ledger entries are strictly append-only and block modifications", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Ledger Protect Ltd", "recommended", 90);

    // Approve & Session & Webhook
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2, decisionReason: "Yes", screeningResultId: resultId }
    });
    const sessionRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: { accessToken: "raw-token", expectedVersion: 3 }
    });
    const { checkoutSessionId, paymentId } = JSON.parse(sessionRes.body);

    const protectTxRef = `ch_ledger_protect_tx_${crypto.randomBytes(4).toString("hex")}`;
    const webhookPayload = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: protectTxRef,
      amount: 500000000,
      currency: "ngn"
    };
    await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { "x-webhook-signature": computeSignature(JSON.stringify(webhookPayload)), "content-type": "application/json" },
      payload: JSON.stringify(webhookPayload)
    });

    const ledgerQuery = await pool.query(
      "SELECT id FROM marketplace_revenue_ledger WHERE payment_id = $1",
      [paymentId]
    );
    expect(ledgerQuery.rows.length).toBe(1);
    const ledgerId = ledgerQuery.rows[0].id;

    // Try to update the ledger entry -> should throw exception due to protect_revenue_ledger trigger
    await expect(
      pool.query("UPDATE marketplace_revenue_ledger SET amount_microunits = 900 WHERE id = $1", [ledgerId])
    ).rejects.toThrow("Ledger entries are append-only");

    // Try to delete the ledger entry -> should throw exception due to protect_revenue_ledger trigger
    await expect(
      pool.query("DELETE FROM marketplace_revenue_ledger WHERE id = $1", [ledgerId])
    ).rejects.toThrow("Ledger entries are append-only");
  });

  test("7. LicenceIssuanceService rejects generation when prerequisites are violated", async () => {
    const { tenantId, token } = await setupAuthUser(pool);
    const { appId, resultId } = await createApplicationAndScreening(tenantId, "Prereq Violator Ltd", "recommended", 95);

    const issuanceService = new LicenceIssuanceService(pool);

    // Prerequisite: Application status is not approved/payment_confirmed
    await expect(
      issuanceService.issueLicence(tenantId, appId, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID())
    ).rejects.toThrow("PREREQUISITE_FAILED: Application status 'awaiting_officer_review' is not eligible for licensing");

    // Approve the application to move to invoice_pending
    await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: 2, decisionReason: "Approve", screeningResultId: resultId }
    });

    // Create session to move to payment_pending
    const sessionRes = await app.inject({
      method: "POST",
      url: `/marketplace/applications/${appId}/checkout-session`,
      payload: { accessToken: "raw-token", expectedVersion: 3 }
    });
    const { paymentId, checkoutSessionId } = JSON.parse(sessionRes.body);

    const invoiceQuery = await pool.query(
      "SELECT id FROM marketplace_invoice WHERE application_id = $1",
      [appId]
    );
    const invoiceId = invoiceQuery.rows[0].id;

    // Complete the payment via webhook to transition application to payment_confirmed (version 4)
    const completedTxRef = `ch_test_7_${crypto.randomBytes(4).toString("hex")}`;
    const webhookPayloadCompleted = {
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      checkout_reference: checkoutSessionId,
      transaction_reference: completedTxRef,
      amount: 500000000,
      currency: "ngn"
    };
    await app.inject({
      method: "POST",
      url: "/marketplace/payments/webhooks/stripe",
      headers: { 
        "x-webhook-signature": computeSignature(JSON.stringify(webhookPayloadCompleted)),
        "content-type": "application/json"
      },
      payload: JSON.stringify(webhookPayloadCompleted)
    });

    // Prerequisite: Application version mismatch check (application version is now 4)
    await expect(
      issuanceService.issueLicence(tenantId, appId, invoiceId, paymentId, crypto.randomUUID(), 999)
    ).rejects.toThrow("PREREQUISITE_FAILED: Application version mismatch");

    // Prerequisite: Invoice is unpaid (we construct a new application in payment_confirmed status but keep the invoice unpaid)
    const badAppId = crypto.randomUUID();
    const tokenHash = AccessTokenService.hashToken("bad-token");
    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, status, business_name, registration_number, tax_identifier,
        contact_email, contact_phone, operating_address, experience_years, license_type, version, access_token_hash
      ) VALUES ($1, $2, 'payment_confirmed', 'Bad Invoice Ltd', 'REG-BAD', 'TAX-BAD', 'bad@test.gov', '080-bad', 'Lagos', 5, 'environmental-consultant', 1, $3)
    `, [badAppId, tenantId, tokenHash]);

    const badInvoiceId = crypto.randomUUID();
    const badInvoiceNumber = `MKT-BAD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    await pool.query(`
      INSERT INTO marketplace_invoice (
        id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status
      ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 year', 500000000, 'USD', 'unpaid')
    `, [badInvoiceId, tenantId, badAppId, badInvoiceNumber]);

    const badPaymentId = crypto.randomUUID();
    const badCheckoutRef = `CS-BAD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const badTxRef = `TX-BAD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    await pool.query(`
      INSERT INTO marketplace_payment (
        id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status
      ) VALUES ($1, $2, $3, 'stripe', $4, $5, 500000000, 'USD', 'succeeded')
    `, [badPaymentId, tenantId, badInvoiceId, badCheckoutRef, badTxRef]);

    // Create a mock snapshot to pass snapshot check
    const badSnapHash = crypto.randomUUID();
    await pool.query(`
      INSERT INTO subcontractor_application_snapshot (
        tenant_id, application_id, application_version, input_schema_version, canonical_payload, input_snapshot_hash
      ) VALUES ($1, $2, 1, '1', '{"mock": true}', $3)
    `, [tenantId, badAppId, badSnapHash]);

    // Create a mock AI execution record
    const badExecutionId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO ai_execution (
        id, tenant_id, agent_name, model_provider, model_name,
        prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
      ) VALUES ($1, $2, 'test-agent', 'deterministic', 'simulator', '1.0.0', 'hash', 'succeeded', 'completed', 'valid', NOW(), 'system')
    `, [badExecutionId, tenantId]);

    // Create a mock screening result to pass screening check
    await pool.query(`
      INSERT INTO subcontractor_screening_result (
        id, tenant_id, application_id, ai_execution_id, screening_policy_version,
        input_snapshot_hash, screening_status, application_version, recommendation, score, criteria, model_version
      ) VALUES ($1, $2, $3, $4, '1.0.0', $5, 'completed', 1, 'recommended', 90, '[]', 'mock')
    `, [crypto.randomUUID(), tenantId, badAppId, badExecutionId, badSnapHash]);

    await expect(
      issuanceService.issueLicence(tenantId, badAppId, badInvoiceId, badPaymentId, crypto.randomUUID(), 1)
    ).rejects.toThrow("PREREQUISITE_FAILED: Invoice status is not paid");
  });

  test("8. Licence uniqueness: Attempting to insert a duplicate active licence violates partial unique index", async () => {
    const tenant = await createTestTenant(pool);
    const appId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const invoiceId1 = crypto.randomUUID();
    const invoiceId2 = crypto.randomUUID();

    const mockTokenHash = crypto.createHash("sha256").update("token").digest("hex");

    // 1. Create dummy application
    await pool.query(`
      INSERT INTO subcontractor_application (
        id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status
      ) VALUES ($1, $2, 'Uniqueness Test Ltd', 'REG-UNQ-1', 'TAX-UNQ-1', 'unq@test.gov.ng', '0801122', 'Lagos', 4, 'environmental-consultant', $3, 'approved')
    `, [appId, tenant.id, mockTokenHash]);
    
    // 2. Create profile
    await pool.query(`
      INSERT INTO subcontractor_profile (
        id, tenant_id, application_id, business_name, status, performance_score, version
      ) VALUES ($1, $2, $3, 'Uniqueness Test Ltd', 'active', 5.00, 1)
    `, [profileId, tenant.id, appId]);

    // 3. Create two dummy paid invoices
    await pool.query(`
      INSERT INTO marketplace_invoice (
        id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status
      ) VALUES 
      ($1, $2, $3, $4, NOW(), NOW() + interval '1 year', 500000000, 'USD', 'paid'),
      ($5, $2, $3, $6, NOW(), NOW() + interval '1 year', 500000000, 'USD', 'paid')
    `, [invoiceId1, tenant.id, appId, `MKT-INV-1-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, invoiceId2, `MKT-INV-2-${crypto.randomBytes(3).toString("hex").toUpperCase()}`]);

    // 4. Insert first active licence
    await pool.query(`
      INSERT INTO subcontractor_licence (
        tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'environmental-consultant', 'active', NOW(), NOW(), NOW() + interval '1 year', 1)
    `, [tenant.id, profileId, invoiceId1, `LIC-UNQ-1-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, crypto.randomUUID()]);

    // 5. Attempt to insert second active licence for the same subcontractor
    await expect(
      pool.query(`
        INSERT INTO subcontractor_licence (
          tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at, version
        ) VALUES ($1, $2, $3, $4, $5, 'environmental-consultant', 'active', NOW(), NOW(), NOW() + interval '1 year', 1)
      `, [tenant.id, profileId, invoiceId2, `LIC-UNQ-2-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, crypto.randomUUID()])
    ).rejects.toThrow(/unique|uq_active_licence/i);
  });
});
