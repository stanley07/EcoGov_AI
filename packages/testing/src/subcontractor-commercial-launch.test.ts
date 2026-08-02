import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { AccessTokenService } from "@govos/core";
import { createTestSession, createTestTenant, createTestUser, setupTestEnvironment } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("subcontractor commercial-launch bank transfer", () => {
  let pool: Pool;
  let app: any;
  beforeAll(async () => { pool = new Pool({ connectionString }); app = (await setupTestEnvironment(pool)).app; });
  afterAll(async () => { await pool.end(); });

  async function actor(authorised = false) {
    const tenant = await createTestTenant(pool);
    const userId = await createTestUser(pool, tenant.id);
    const token = await createTestSession(pool, tenant.id, userId);
    if (authorised) {
      const roleId = crypto.randomUUID();
      await pool.query("INSERT INTO role (id,tenant_id,name,is_system) VALUES ($1,$2,$3,false)", [roleId, tenant.id, `Finance Officer ${roleId}`]);
      const permission = await pool.query(`INSERT INTO permission (tenant_id,name,description) VALUES ($1,'marketplace.payment.verify','test')
        ON CONFLICT (tenant_id,name) DO UPDATE SET description=EXCLUDED.description RETURNING id`, [tenant.id]);
      await pool.query("INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2)", [roleId, permission.rows[0].id]);
      await pool.query("INSERT INTO membership (tenant_id,user_id,role_id) VALUES ($1,$2,$3)", [tenant.id, userId, roleId]);
    }
    return { tenantId: tenant.id, userId, token };
  }

  async function payable(tenantId: string, accessToken = "applicant-token") {
    const applicationId = crypto.randomUUID(); const invoiceId = crypto.randomUUID();
    await pool.query(`INSERT INTO subcontractor_application
      (id,tenant_id,status,business_name,registration_number,tax_identifier,contact_email,contact_phone,operating_address,experience_years,license_type,version,access_token_hash)
      VALUES ($1,$2,'invoice_pending','Pilot Applicant',$3,$4,'pilot@test.ng','080','Awka',3,'environmental-consultant',3,$5)`,
      [applicationId, tenantId, `REG-${applicationId}`, `TAX-${applicationId}`, AccessTokenService.hashToken(accessToken)]);
    await pool.query(`INSERT INTO marketplace_invoice
      (id,tenant_id,application_id,invoice_number,billing_period_start,billing_period_end,amount_due_microunits,currency,status,payment_reference)
      VALUES ($1,$2,$3,$4,NOW(),NOW()+INTERVAL '1 year',500000000,'NGN','unpaid',$4)`,
      [invoiceId, tenantId, applicationId, `INV-${applicationId}`]);
    return { applicationId, invoiceId, accessToken };
  }

  const receipt = { filename: "receipt.pdf", mimeType: "application/pdf", sizeBytes: 128, contentHash: "a".repeat(64) };
  async function submit(item: Awaited<ReturnType<typeof payable>>, reference: string, amount = 500000000, currency = "NGN", key = crypto.randomUUID()) {
    return app.inject({ method: "POST", url: `/marketplace/applications/${item.applicationId}/payment-claims`,
      headers: { "idempotency-key": key }, payload: { accessToken: item.accessToken, transactionReference: reference,
        paymentDate: "2026-08-02", payerName: "Pilot Payer", amountMicrounits: amount, currency, receipt } });
  }
  async function decision(token: string, claimId: string, choice: "confirm" | "reject", reason?: string) {
    return app.inject({ method: "POST", url: `/officer/marketplace/payment-claims/${claimId}/decision`,
      headers: { authorization: `Bearer ${token}` }, payload: { decision: choice, reason } });
  }

  test("invoice amount cannot be changed by applicant", async () => {
    const user = await actor(); const item = await payable(user.tenantId);
    const response = await submit(item, `TX-${crypto.randomUUID()}`, 1);
    expect(response.statusCode).toBe(400); expect(response.json().error).toBe("Amount mismatch");
    const invoice = await pool.query("SELECT amount_due_microunits FROM marketplace_invoice WHERE id=$1", [item.invoiceId]);
    expect(Number(invoice.rows[0].amount_due_microunits)).toBe(500000000);
  });

  test("duplicate reference is rejected and idempotent replay is safe", async () => {
    const user = await actor(); const first = await payable(user.tenantId); const second = await payable(user.tenantId);
    const ref = `TX-${crypto.randomUUID()}`; const key = crypto.randomUUID();
    expect((await submit(first, ref, 500000000, "NGN", key)).statusCode).toBe(201);
    const replay = await submit(first, ref, 500000000, "NGN", key);
    expect(replay.statusCode).toBe(200); expect(replay.json().deduplicated).toBe(true);
    expect((await submit(second, ref)).statusCode).toBe(409);
  });

  test("wrong amount is rejected", async () => {
    const user = await actor(); expect((await submit(await payable(user.tenantId), `TX-${crypto.randomUUID()}`, 499000000)).statusCode).toBe(400);
  });

  test("wrong currency is rejected", async () => {
    const user = await actor(); expect((await submit(await payable(user.tenantId), `TX-${crypto.randomUUID()}`, 500000000, "USD")).statusCode).toBe(400);
  });

  test("unauthorized user cannot confirm payment", async () => {
    const user = await actor(); const item = await payable(user.tenantId); const claim = (await submit(item, `TX-${crypto.randomUUID()}`)).json();
    expect((await decision(user.token, claim.claimId, "confirm")).statusCode).toBe(403);
  });

  test("cross-tenant confirmation is rejected", async () => {
    const owner = await actor(); const other = await actor(true); const item = await payable(owner.tenantId);
    const claim = (await submit(item, `TX-${crypto.randomUUID()}`)).json();
    expect((await decision(other.token, claim.claimId, "confirm")).statusCode).toBe(404);
  });

  test("confirmed payment publishes exactly one payment-confirmed event and licence issuance remains asynchronous", async () => {
    const officer = await actor(true); const item = await payable(officer.tenantId); const claim = (await submit(item, `TX-${crypto.randomUUID()}`)).json();
    const confirmed = await decision(officer.token, claim.claimId, "confirm");
    expect(confirmed.statusCode).toBe(200); expect(confirmed.json().licenceIssuance).toBe("asynchronous");
    expect((await decision(officer.token, claim.claimId, "confirm")).statusCode).toBe(409);
    const events = await pool.query("SELECT COUNT(*) FROM outbox_event WHERE tenant_id=$1 AND event_type='subcontractor_application.payment_confirmed'", [officer.tenantId]);
    expect(Number(events.rows[0].count)).toBe(1);
    const licences = await pool.query("SELECT COUNT(*) FROM subcontractor_licence WHERE tenant_id=$1 AND invoice_id=$2", [officer.tenantId, item.invoiceId]);
    expect(Number(licences.rows[0].count)).toBe(0);
  });

  test("rejected claim does not credit the ledger and records mandatory audit reason", async () => {
    const officer = await actor(true); const item = await payable(officer.tenantId); const claim = (await submit(item, `TX-${crypto.randomUUID()}`)).json();
    expect((await decision(officer.token, claim.claimId, "reject")).statusCode).toBe(400);
    expect((await decision(officer.token, claim.claimId, "reject", "Receipt is illegible")).statusCode).toBe(200);
    const ledger = await pool.query("SELECT COUNT(*) FROM marketplace_revenue_ledger WHERE tenant_id=$1 AND invoice_id=$2", [officer.tenantId, item.invoiceId]);
    expect(Number(ledger.rows[0].count)).toBe(0);
    const audit = await pool.query("SELECT reason FROM subcontractor_application_event WHERE tenant_id=$1 AND event_key=$2", [officer.tenantId, `payment.claim.rejected:${claim.claimId}`]);
    expect(audit.rows[0].reason).toBe("Receipt is illegible");
  });
});
