import crypto from "node:crypto";
import { Pool } from "pg";

export type PaymentEnvironment = "test" | "live";

export interface PaymentInitialization {
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
}

export interface VerifiedPayment {
  reference: string;
  transactionId: string;
  status: "paid" | "pending" | "failed" | "cancelled";
  amountMinor: number;
  currency: string;
  channel?: string;
  paidAt?: Date;
}

export interface PaymentProvider {
  readonly name: string;
  readonly environment: PaymentEnvironment;
  initialize(input: { email: string; amountMinor: number; currency: string; reference: string; callbackUrl: string; metadata: Record<string, string> }): Promise<PaymentInitialization>;
  verify(reference: string): Promise<VerifiedPayment>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

export class PaystackPaymentProvider implements PaymentProvider {
  readonly name = "paystack";
  constructor(
    private readonly secretKey: string,
    readonly environment: PaymentEnvironment,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    const expected = environment === "live" ? "sk_live_" : "sk_test_";
    if (!secretKey.startsWith(expected)) throw new Error(`Paystack ${environment} mode requires an ${expected} key`);
  }

  async initialize(input: Parameters<PaymentProvider["initialize"]>[0]): Promise<PaymentInitialization> {
    const response = await this.request("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({ email: input.email, amount: input.amountMinor, currency: input.currency, reference: input.reference,
        callback_url: input.callbackUrl, metadata: input.metadata }),
    });
    return { reference: String(response.reference), authorizationUrl: String(response.authorization_url), accessCode: String(response.access_code || "") };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const data = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
    return { reference: String(data.reference), transactionId: String(data.id), status: data.status === "success" ? "paid" : data.status === "abandoned" ? "cancelled" : data.status === "failed" ? "failed" : "pending",
      amountMinor: Number(data.amount), currency: String(data.currency).toUpperCase(), channel: data.channel ? String(data.channel) : undefined,
      paidAt: data.paid_at ? new Date(String(data.paid_at)) : undefined };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    const expected = crypto.createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchFn(`https://api.paystack.co${path}`, { ...init, signal: controller.signal,
        headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" } });
      const body = await response.json() as any;
      if (!response.ok || body.status !== true) throw new Error(`PAYSTACK_REQUEST_FAILED:${response.status}`);
      return body.data;
    } finally { clearTimeout(timer); }
  }
}

const minorToMicrounits = (amount: number) => amount * 10_000;

export class PaystackRegistrationPaymentService {
  constructor(private readonly pool: Pool, private readonly provider: PaymentProvider, private readonly callbackUrl: string) {}

  async initialize(input: { applicationId: string; accessTokenHash: string; expectedVersion: number; idempotencyKey: string }) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    const appResult = await this.pool.query(`SELECT * FROM subcontractor_application WHERE id=$1`, [input.applicationId]);
    if (!appResult.rows.length || !crypto.timingSafeEqual(Buffer.from(appResult.rows[0].access_token_hash), Buffer.from(input.accessTokenHash))) throw new Error("UNAUTHORIZED");
    const application = appResult.rows[0];
    if (Number(application.version) !== Number(input.expectedVersion)) throw new Error("VERSION_CONFLICT");
    if (!["invoice_pending", "payment_pending"].includes(application.status)) throw new Error("APPLICATION_NOT_PAYABLE");
    const invoiceResult = await this.pool.query(`SELECT * FROM marketplace_invoice WHERE tenant_id=$1 AND application_id=$2 AND status IN ('unpaid','pending') ORDER BY created_at DESC LIMIT 1`, [application.tenant_id, application.id]);
    if (!invoiceResult.rows.length) throw new Error("INVOICE_NOT_PAYABLE");
    const invoice = invoiceResult.rows[0];
    const amountMinor = Number(invoice.amount_due_microunits) / 10_000;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("INVOICE_AMOUNT_NOT_PROVIDER_COMPATIBLE");
    const requestHash = crypto.createHash("sha256").update(`${invoice.id}:${invoice.amount_due_microunits}:${invoice.currency}:${application.contact_email}`).digest("hex");
    const duplicate = await this.pool.query(`SELECT * FROM marketplace_payment WHERE tenant_id=$1 AND invoice_id=$2 AND idempotency_key=$3`, [application.tenant_id, invoice.id, input.idempotencyKey]);
    if (duplicate.rows.length) {
      if (duplicate.rows[0].request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      return this.mapInitialization(duplicate.rows[0], true);
    }
    const paymentId = crypto.randomUUID(); const reference = `GOVOS-${paymentId}`;
    const claimed = await this.pool.query(`INSERT INTO marketplace_payment (id,tenant_id,invoice_id,provider,provider_checkout_reference,amount_paid_microunits,currency,status,idempotency_key,request_hash,provider_environment)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`, [paymentId, application.tenant_id, invoice.id, this.provider.name, reference, invoice.amount_due_microunits, invoice.currency, input.idempotencyKey, requestHash, this.provider.environment]);
    if (!claimed.rows.length) {
      const winner = await this.pool.query(`SELECT * FROM marketplace_payment WHERE tenant_id=$1 AND invoice_id=$2 AND idempotency_key=$3`, [application.tenant_id, invoice.id, input.idempotencyKey]);
      if (!winner.rows.length || winner.rows[0].request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      return this.mapInitialization(winner.rows[0], true);
    }
    try {
      const initialized = await this.provider.initialize({ email: application.contact_email, amountMinor,
        currency: invoice.currency, reference, callbackUrl: this.callbackUrl, metadata: { paymentId, invoiceId: invoice.id, applicationId: application.id, tenantId: application.tenant_id } });
      await this.pool.query(`UPDATE marketplace_payment SET status='processing',checkout_authorization_url=$1,initialized_at=NOW(),updated_at=NOW() WHERE tenant_id=$2 AND id=$3`, [initialized.authorizationUrl, application.tenant_id, paymentId]);
      await this.pool.query(`UPDATE subcontractor_application SET status='payment_pending',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='invoice_pending'`, [application.tenant_id, application.id]);
      return { paymentId, reference, authorizationUrl: initialized.authorizationUrl, status: "processing", deduplicated: false };
    } catch (error) {
      await this.pool.query(`UPDATE marketplace_payment SET status='failed',failed_at=NOW(),failure_code='PROVIDER_INITIALIZATION_FAILED',updated_at=NOW() WHERE id=$1`, [paymentId]);
      throw error;
    }
  }

  async processWebhook(rawBody: Buffer, signature: string): Promise<{ success: true; deduplicated?: boolean }> {
    if (!this.provider.verifyWebhookSignature(rawBody, signature)) throw new Error("UNAUTHORIZED_SIGNATURE");
    const payload = JSON.parse(rawBody.toString("utf8")); const reference = String(payload?.data?.reference || "");
    const eventId = `paystack:${String(payload?.data?.id || reference)}:${String(payload?.event || "unknown")}`;
    const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const inserted = await this.pool.query(`INSERT INTO marketplace_payment_event(webhook_event_id,provider,payload_hash,event_type,provider_created_at,signature_verified_at,processing_status,sanitized_payload)
      VALUES($1,'paystack',$2,$3,NOW(),NOW(),'processing',$4) ON CONFLICT DO NOTHING RETURNING id`, [eventId, hash, String(payload?.event || "unknown"), JSON.stringify({ event: payload?.event, reference, transactionId: payload?.data?.id })]);
    if (!inserted.rows.length) {
      const reclaimed = await this.pool.query(`UPDATE marketplace_payment_event
        SET processing_status='processing', processing_attempts=processing_attempts+1, last_error_code=NULL, last_error_message_redacted=NULL
        WHERE webhook_event_id=$1 AND provider='paystack' AND payload_hash=$2
          AND processing_status IN ('received','failed') AND processing_attempts < 5
        RETURNING id`, [eventId, hash]);
      if (!reclaimed.rows.length) {
        const existing = await this.pool.query(`SELECT processing_status FROM marketplace_payment_event WHERE webhook_event_id=$1 AND provider='paystack'`, [eventId]);
        if (existing.rows[0]?.processing_status === "processed" || existing.rows[0]?.processing_status === "ignored") return { success: true, deduplicated: true };
        throw new Error("WEBHOOK_RETRY_PENDING");
      }
    }
    if (payload?.event !== "charge.success") { await this.pool.query(`UPDATE marketplace_payment_event SET processing_status='ignored',processed_at=NOW() WHERE webhook_event_id=$1`, [eventId]); return { success: true }; }
    try {
      const verified = await this.provider.verify(reference);
      await this.settle(eventId, verified);
      return { success: true };
    } catch (error: any) {
      await this.pool.query(`UPDATE marketplace_payment_event SET processing_status='failed',last_error_code=$1 WHERE webhook_event_id=$2 AND processing_status<>'processed'`, [String(error.message).slice(0,100),eventId]);
      throw error;
    }
  }

  private async settle(eventId: string, verified: VerifiedPayment) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN");
      const paymentResult = await client.query(`SELECT * FROM marketplace_payment WHERE provider='paystack' AND provider_checkout_reference=$1 FOR UPDATE`, [verified.reference]);
      if (!paymentResult.rows.length) throw new Error("UNKNOWN_REFERENCE"); const payment = paymentResult.rows[0];
      if (payment.status === "paid") { await client.query(`UPDATE marketplace_payment_event SET tenant_id=$1,processing_status='processed',processed_at=NOW() WHERE webhook_event_id=$2`, [payment.tenant_id,eventId]); await client.query("COMMIT"); return; }
      const invoiceResult = await client.query(`SELECT * FROM marketplace_invoice WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [payment.tenant_id,payment.invoice_id]); const invoice=invoiceResult.rows[0];
      if (verified.status !== "paid") throw new Error("PAYMENT_NOT_SUCCESSFUL");
      if (minorToMicrounits(verified.amountMinor) !== Number(invoice.amount_due_microunits)) throw new Error("AMOUNT_MISMATCH");
      if (verified.currency !== invoice.currency) throw new Error("CURRENCY_MISMATCH");
      const appResult=await client.query(`SELECT * FROM subcontractor_application WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[payment.tenant_id,invoice.application_id]); const application=appResult.rows[0];
      if (!["invoice_pending","payment_pending","payment_confirmed"].includes(application.status)) throw new Error("APPLICATION_NOT_ELIGIBLE");
      await client.query(`UPDATE marketplace_payment SET status='paid',provider_transaction_reference=$1,payment_channel=$2,verified_at=NOW(),paid_at=COALESCE($3,NOW()),updated_at=NOW() WHERE id=$4`,[verified.transactionId,verified.channel,verified.paidAt,payment.id]);
      await client.query(`UPDATE marketplace_invoice SET status='paid',paid_at=NOW(),version=version+1 WHERE tenant_id=$1 AND id=$2 AND status<>'paid'`,[payment.tenant_id,invoice.id]);
      const nextVersion=Number(application.version)+(application.status === "payment_confirmed" ? 0 : 1);
      await client.query(`UPDATE subcontractor_application SET status='payment_confirmed',version=$1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3`,[nextVersion,payment.tenant_id,application.id]);
      await client.query(`INSERT INTO marketplace_revenue_ledger(tenant_id,invoice_id,payment_id,entry_reference,amount_microunits,currency,entry_type,occurred_at) VALUES($1,$2,$3,$4,$5,$6,'credit',NOW()) ON CONFLICT DO NOTHING`,[payment.tenant_id,invoice.id,payment.id,`LEDGER-${payment.id}`,invoice.amount_due_microunits,invoice.currency]);
      await client.query(`INSERT INTO subcontractor_application_event(tenant_id,application_id,actor_type,actor_id,previous_state,new_state,reason,correlation_id,event_type,event_key) VALUES($1,$2,'payment_provider',NULL,$3,'payment_confirmed','Paystack payment verified',$4,'payment.confirmed',$5) ON CONFLICT(tenant_id,application_id,event_key) DO NOTHING`,[payment.tenant_id,application.id,application.status,eventId,`payment.confirmed:${payment.id}`]);
      await client.query(`INSERT INTO outbox_event(tenant_id,aggregate_type,aggregate_id,event_type,payload,deduplication_key,status) VALUES($1,'subcontractor_application',$2,'subcontractor_application.payment_confirmed',$3,$4,'pending') ON CONFLICT(deduplication_key) DO NOTHING`,[payment.tenant_id,application.id,JSON.stringify({tenantId:payment.tenant_id,applicationId:application.id,invoiceId:invoice.id,paymentId:payment.id,applicationVersion:nextVersion}),`marketplace-licence-issue:${payment.tenant_id}:${application.id}:${nextVersion}`]);
      await client.query(`UPDATE marketplace_payment_event SET tenant_id=$1,processing_status='processed',processed_at=NOW() WHERE webhook_event_id=$2`,[payment.tenant_id,eventId]);
      await client.query("COMMIT");
    } catch(error:any) { await client.query("ROLLBACK"); await this.pool.query(`UPDATE marketplace_payment_event SET processing_status='failed',last_error_code=$1 WHERE webhook_event_id=$2`,[String(error.message).slice(0,100),eventId]); throw error; } finally { client.release(); }
  }

  private mapInitialization(row: any, deduplicated: boolean) { return { paymentId: row.id, reference: row.provider_checkout_reference, authorizationUrl: row.checkout_authorization_url, status: row.status, deduplicated }; }
}
