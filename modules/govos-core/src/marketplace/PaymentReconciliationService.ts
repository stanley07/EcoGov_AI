import { Pool } from "pg";
import * as crypto from "node:crypto";
import { 
  validatePaymentTransition, 
  validateApplicationTransition 
} from "./marketplace-policies.js";

export interface WebhookEventPayload {
  id: string;
  type: string;
  checkout_reference?: string;
  transaction_reference?: string;
  amount?: number;
  currency?: string;
  provider_created_at?: string | Date;
  data?: {
    object?: {
      id?: string;
      payment_intent?: string;
      amount_total?: number;
      currency?: string;
      created?: number; // Stripe epoch timestamp in seconds
    }
  };
}

export class MarketplacePaymentReconciliationService {
  constructor(private pool: Pool) {}

  public async processWebhook(
    provider: string,
    rawBody: string,
    signature: string,
    secret: string,
    parsedPayload: WebhookEventPayload
  ): Promise<{ success: boolean; deduplicated?: boolean }> {
    const startOverall = Date.now();

    // 1. Verify Signature
    const startSig = Date.now();
    const sigValid = this.verifyWebhookSignature(rawBody, signature, secret);
    const sigDuration = Date.now() - startSig;

    if (!sigValid) {
      throw new Error("UNAUTHORIZED_SIGNATURE");
    }

    const webhookEventId = parsedPayload.id || `evt_${crypto.randomUUID()}`;
    const eventType = parsedPayload.type || "unknown";
    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    // 2. Webhook deduplication check
    const dupCheck = await this.pool.query(
      "SELECT id, processing_status FROM marketplace_payment_event WHERE webhook_event_id = $1 OR payload_hash = $2",
      [webhookEventId, payloadHash]
    );
    if (dupCheck.rows.length > 0) {
      return { success: true, deduplicated: true };
    }

    // 3. Persist payment event in received status
    let providerCreatedAt = new Date();
    const stripeCreatedSec = parsedPayload.data?.object?.created;
    if (stripeCreatedSec) {
      providerCreatedAt = new Date(stripeCreatedSec * 1000);
    } else if (parsedPayload.provider_created_at) {
      providerCreatedAt = new Date(parsedPayload.provider_created_at);
    }

    await this.pool.query(
      `INSERT INTO marketplace_payment_event (
        webhook_event_id, provider, payload_hash, event_type, provider_created_at, signature_verified_at, processing_status, sanitized_payload
      ) VALUES ($1, $2, $3, $4, $5, NOW(), 'received', $6)`,
      [webhookEventId, provider, payloadHash, eventType, providerCreatedAt, JSON.stringify(parsedPayload)]
    );

    const checkoutSessionId = parsedPayload.data?.object?.id || parsedPayload.checkout_reference;

    // Handle checkout.session.completed
    if (eventType === "checkout.session.completed") {
      if (!checkoutSessionId) {
        throw new Error("Missing checkout session reference");
      }
      return this.handleCheckoutCompleted(webhookEventId, provider, checkoutSessionId, parsedPayload, startOverall, sigDuration);
    }

    // Handle refunds
    if (eventType === "charge.refunded" || eventType === "checkout.session.refunded") {
      const txRef = parsedPayload.data?.object?.payment_intent || parsedPayload.transaction_reference;
      if (!txRef) {
        throw new Error("Missing transaction reference");
      }
      return this.handleRefund(webhookEventId, provider, checkoutSessionId || "", txRef, parsedPayload, startOverall, sigDuration);
    }

    // Unsupported event types
    await this.pool.query(
      "UPDATE marketplace_payment_event SET processing_status = 'ignored', last_error_code = 'ignored' WHERE webhook_event_id = $1",
      [webhookEventId]
    );
    return { success: true };
  }

  private verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature) return false;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    const expected = hmac.digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  private async handleCheckoutCompleted(
    webhookEventId: string,
    _provider: string,
    checkoutSessionId: string,
    payload: WebhookEventPayload,
    startOverall: number,
    sigDuration: number
  ): Promise<{ success: boolean }> {
    const startReconcile = Date.now();

    const paymentQuery = await this.pool.query(
      "SELECT * FROM marketplace_payment WHERE provider_checkout_reference = $1",
      [checkoutSessionId]
    );
    if (paymentQuery.rows.length === 0) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'unknown_reference' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error(`Payment not found for checkout reference ${checkoutSessionId}`);
    }
    const payment = paymentQuery.rows[0];

    const invoiceQuery = await this.pool.query(
      "SELECT * FROM marketplace_invoice WHERE id = $1",
      [payment.invoice_id]
    );
    const invoice = invoiceQuery.rows[0];

    const eventAmount = payload.data?.object?.amount_total || payload.amount;
    const eventCurrency = (payload.data?.object?.currency || payload.currency || "").toUpperCase();

    // Validate amount and currency
    if (Number(eventAmount) !== Number(invoice.amount_due_microunits)) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'AMOUNT_MISMATCH' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error("Amount mismatch");
    }
    if (eventCurrency !== invoice.currency) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'CURRENCY_MISMATCH' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error("Currency mismatch");
    }

    // Validate payment status transitions monotonically
    if (!validatePaymentTransition(payment.status, "succeeded")) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'INVALID_TRANSITION' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error(`Invalid payment transition from ${payment.status} to succeeded`);
    }

    const appQuery = await this.pool.query(
      "SELECT * FROM subcontractor_application WHERE id = $1",
      [invoice.application_id]
    );
    const app = appQuery.rows[0];

    // Validate application status transitions monotonically
    if (!validateApplicationTransition(app.status, "payment_confirmed")) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'INVALID_TRANSITION' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error(`Invalid application transition from ${app.status} to payment_confirmed`);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const txRef = payload.data?.object?.payment_intent || payload.transaction_reference || `tx_${crypto.randomUUID()}`;
      await client.query(
        `UPDATE marketplace_payment 
         SET status = 'succeeded', provider_transaction_reference = $1, updated_at = NOW()
         WHERE id = $2`,
        [txRef, payment.id]
      );

      await client.query(
        `UPDATE marketplace_invoice 
         SET status = 'paid', version = version + 1
         WHERE id = $1`,
        [invoice.id]
      );

      await client.query(
        `UPDATE subcontractor_application 
         SET status = 'payment_confirmed', version = version + 1, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [payment.tenant_id, invoice.application_id]
      );

      const ledgerId = crypto.randomUUID();
      const entryRef = `LEDGER-${payment.id}`;
      await client.query(
        `INSERT INTO marketplace_revenue_ledger (
          id, tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'credit', NOW())`,
        [ledgerId, payment.tenant_id, invoice.id, payment.id, entryRef, payment.amount_paid_microunits, payment.currency]
      );

      // Queue Outbox Event for Asynchronous Licence Issuance!
      const deKey = `marketplace-licence-issue:${payment.tenant_id}:${invoice.application_id}:${app.version + 1}`;
      const outboxPayload = {
        tenantId: payment.tenant_id,
        applicationId: invoice.application_id,
        invoiceId: invoice.id,
        paymentId: payment.id,
        applicationVersion: app.version + 1
      };
      await client.query(
        `INSERT INTO outbox_event (
          tenant_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status
        ) VALUES ($1, 'subcontractor_application', $2, 'subcontractor_application.payment_confirmed', $3, $4, 'pending')`,
        [payment.tenant_id, invoice.application_id, JSON.stringify(outboxPayload), deKey]
      );

      const reconciliationDuration = Date.now() - startReconcile;
      const overallDuration = Date.now() - startOverall;

      await client.query(
        `UPDATE marketplace_payment_event 
         SET processing_status = 'processed', last_error_code = 'accepted', processed_at = NOW(),
             processing_latency_ms = $2, signature_validation_duration_ms = $3, reconciliation_duration_ms = $4
         WHERE webhook_event_id = $1`,
        [webhookEventId, overallDuration, sigDuration, reconciliationDuration]
      );

      await client.query("COMMIT");
      return { success: true };
    } catch (err: any) {
      await client.query("ROLLBACK");
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'processing_error', last_error_message_redacted = $1 WHERE webhook_event_id = $2",
        [err.message, webhookEventId]
      );
      throw err;
    } finally {
      client.release();
    }
  }

  private async handleRefund(
    webhookEventId: string,
    _provider: string,
    checkoutSessionId: string,
    txRef: string,
    _payload: WebhookEventPayload,
    startOverall: number,
    sigDuration: number
  ): Promise<{ success: boolean }> {
    const startReconcile = Date.now();

    const paymentQuery = await this.pool.query(
      "SELECT * FROM marketplace_payment WHERE provider_transaction_reference = $1 OR provider_checkout_reference = $2",
      [txRef, checkoutSessionId]
    );
    if (paymentQuery.rows.length === 0) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'unknown_reference' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error("Payment not found for refund");
    }
    const payment = paymentQuery.rows[0];

    // Validate monotonic transition to refunded
    if (!validatePaymentTransition(payment.status, "refunded")) {
      await this.pool.query(
        "UPDATE marketplace_payment_event SET processing_status = 'failed', last_error_code = 'INVALID_TRANSITION' WHERE webhook_event_id = $1",
        [webhookEventId]
      );
      throw new Error(`Invalid payment transition from ${payment.status} to refunded`);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        "UPDATE marketplace_payment SET status = 'refunded', updated_at = NOW() WHERE id = $1",
        [payment.id]
      );

      await client.query(
        "UPDATE marketplace_invoice SET status = 'refunded', version = version + 1 WHERE id = $1",
        [payment.invoice_id]
      );

      const ledgerId = crypto.randomUUID();
      const entryRef = `REFUND-${payment.id}-${crypto.randomUUID().slice(0,4)}`;
      await client.query(
        `INSERT INTO marketplace_revenue_ledger (
          id, tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'refund', NOW())`,
        [ledgerId, payment.tenant_id, payment.invoice_id, payment.id, entryRef, payment.amount_paid_microunits, payment.currency]
      );

      const reconciliationDuration = Date.now() - startReconcile;
      const overallDuration = Date.now() - startOverall;

      await client.query(
        `UPDATE marketplace_payment_event 
         SET processing_status = 'processed', last_error_code = 'accepted', processed_at = NOW(),
             processing_latency_ms = $2, signature_validation_duration_ms = $3, reconciliation_duration_ms = $4
         WHERE webhook_event_id = $1`,
        [webhookEventId, overallDuration, sigDuration, reconciliationDuration]
      );

      await client.query("COMMIT");
      return { success: true };
    } catch (err: any) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
