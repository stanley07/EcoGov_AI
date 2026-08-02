import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { MarketplaceAnalyticsService } from "@govos/core";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Subcontractor Marketplace Analytics Integration Tests", () => {
  let pool: Pool;
  let service: MarketplaceAnalyticsService;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    service = new MarketplaceAnalyticsService(pool);
    tenantId = crypto.randomUUID();

    // Create mock tenant
    await pool.query(
      "INSERT INTO tenant (id, name, slug, type, status) VALUES ($1, 'Analytics Test Tenant', $2, 'ministry', 'active')",
      [tenantId, `tenant-${crypto.randomUUID().substring(0, 8)}`]
    );
  });

  afterAll(async () => {
    // Disable triggers to allow deletion of protected records
    await pool.query("ALTER TABLE subcontractor_application_event DISABLE TRIGGER trg_protect_subcontractor_application_event");
    await pool.query("ALTER TABLE marketplace_revenue_ledger DISABLE TRIGGER trg_protect_revenue_ledger");

    try {
      // Cleanup tenant data
      await pool.query("DELETE FROM marketplace_revenue_ledger WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM marketplace_payment WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM marketplace_invoice WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application_event WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM subcontractor_application WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM tenant WHERE id = $1", [tenantId]);
    } finally {
      // Re-enable triggers
      await pool.query("ALTER TABLE subcontractor_application_event ENABLE TRIGGER trg_protect_subcontractor_application_event");
      await pool.query("ALTER TABLE marketplace_revenue_ledger ENABLE TRIGGER trg_protect_revenue_ledger");
    }

    await pool.end();
  });

  test("1. Verifies half-open date ranges for application events", async () => {
    const appId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO subcontractor_application (id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status)
       VALUES ($1, $2, 'Half Open Sub', 'REG-HALF', 'TAX-HALF', 'half@sub.ng', '0801122', 'Address', 5, 'environmental-consultant', 'hash', 'draft')`,
      [appId, tenantId]
    );

    const fromDate = new Date("2026-01-01T00:00:00Z");
    const toDate = new Date("2026-02-01T00:00:00Z");

    const logEvent = async (type: string, time: Date) => {
      await pool.query(
        `INSERT INTO subcontractor_application_event (
           tenant_id, application_id, event_type, event_key, actor_type, new_state, correlation_id, created_at
         ) VALUES ($1, $2, $3, $4, 'system', 'backfilled', $5, $6)`,
        [tenantId, appId, type, `key-${crypto.randomUUID()}`, crypto.randomUUID(), time]
      );
    };

    // Event 1: exactly at fromDate (inclusive)
    await logEvent("application.created", fromDate);

    // Event 2: middle of range
    await logEvent("application.submitted", new Date("2026-01-15T00:00:00Z"));

    // Event 3: exactly at toDate (exclusive)
    await logEvent("screening.started", toDate);

    // Query analytics for this range
    const res = await service.getFunnel(tenantId, {
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    }, {});

    expect(res.data.stages).toBeDefined();

    const draftStage = res.data.stages.find((s: any) => s.stage === "application.created");
    const submittedStage = res.data.stages.find((s: any) => s.stage === "application.submitted");
    const screeningStartedStage = res.data.stages.find((s: any) => s.stage === "screening.started");

    expect(draftStage).toBeDefined();
    expect(draftStage.count).toBe(1); // represented by application.created

    expect(submittedStage).toBeDefined();
    expect(submittedStage.count).toBe(1); // represented by application.submitted

    expect(screeningStartedStage).toBeDefined();
    expect(screeningStartedStage.count || 0).toBe(0); // screening.started is exclusive
  });

  test("2. Verifies currency isolation in revenue ledger", async () => {
    // Seed subcontractor application to reference
    const appId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO subcontractor_application (id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status)
       VALUES ($1, $2, 'Revenue Sub', 'REG-REV', 'TAX-REV', 'revenue@sub.ng', '0801122', 'Address', 5, 'environmental-consultant', 'hash', 'approved')`,
      [appId, tenantId]
    );

    // Seed invoices
    const invoice1Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO marketplace_invoice (id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status)
       VALUES ($1, $2, $3, 'INV-NGN', NOW(), NOW() + INTERVAL '1 year', 1000000000, 'NGN', 'paid')`,
      [invoice1Id, tenantId, appId]
    );

    const payment1Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO marketplace_payment (id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status)
       VALUES ($1, $2, $3, 'stripe', 'cs-ngn', 'tx-ngn', 1000000000, 'NGN', 'succeeded')`,
      [payment1Id, tenantId, invoice1Id]
    );

    await pool.query(
      `INSERT INTO marketplace_revenue_ledger (tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at)
       VALUES ($1, $2, $3, 'ref-ngn', 1000000000, 'NGN', 'credit', NOW())`,
      [tenantId, invoice1Id, payment1Id]
    );

    const invoice2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO marketplace_invoice (id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status)
       VALUES ($1, $2, $3, 'INV-USD', NOW(), NOW() + INTERVAL '1 year', 5000000, 'USD', 'paid')`,
      [invoice2Id, tenantId, appId]
    );

    const payment2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO marketplace_payment (id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status)
       VALUES ($1, $2, $3, 'stripe', 'cs-usd', 'tx-usd', 5000000, 'USD', 'succeeded')`,
      [payment2Id, tenantId, invoice2Id]
    );

    await pool.query(
      `INSERT INTO marketplace_revenue_ledger (tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at)
       VALUES ($1, $2, $3, 'ref-usd', 5000000, 'USD', 'credit', NOW())`,
      [tenantId, invoice2Id, payment2Id]
    );

    // Query revenue analytics
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const toDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await service.getRevenue(tenantId, { from: fromDate, to: toDate }, {});

    expect(res.data.currencies).toBeDefined();
    
    const ngnRow = res.data.currencies.find((r: any) => r.currency === "NGN");
    const usdRow = res.data.currencies.find((r: any) => r.currency === "USD");

    expect(ngnRow).toBeDefined();
    expect(Number(ngnRow.grossRevenue)).toBe(1000); // 1,000,000,000 micros = 1,000 NGN

    expect(usdRow).toBeDefined();
    expect(Number(usdRow.grossRevenue)).toBe(5); // 5,000,000 micros = 5 USD
  });
});
