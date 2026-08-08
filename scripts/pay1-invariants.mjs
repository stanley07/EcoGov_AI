import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const connection = await pool.query("SELECT current_database() db, inet_server_addr()::text host, inet_server_port() port");
  const migration = await pool.query("SELECT MAX(version) migration FROM schema_migrations");
  const duplicateCredits = await pool.query("SELECT COUNT(1) duplicate_credit_groups FROM (SELECT tenant_id, payment_id FROM marketplace_revenue_ledger WHERE entry_type='credit' GROUP BY tenant_id, payment_id HAVING COUNT(1)>1) d");
  const paidMismatch = await pool.query("SELECT COUNT(1) paid_mismatches FROM marketplace_payment p JOIN marketplace_invoice i ON i.tenant_id=p.tenant_id AND i.id=p.invoice_id WHERE p.status='paid' AND (p.amount_paid_microunits<>i.amount_due_microunits OR p.currency<>i.currency)");
  const paidAmountMismatch = await pool.query("SELECT COUNT(1) paid_amount_mismatches FROM marketplace_payment p JOIN marketplace_invoice i ON i.tenant_id=p.tenant_id AND i.id=p.invoice_id WHERE p.status='paid' AND p.amount_paid_microunits<>i.amount_due_microunits");
  const paidCurrencyMismatch = await pool.query("SELECT COUNT(1) paid_currency_mismatches FROM marketplace_payment p JOIN marketplace_invoice i ON i.tenant_id=p.tenant_id AND i.id=p.invoice_id WHERE p.status='paid' AND p.currency<>i.currency");
  const unverifiedPaid = await pool.query("SELECT COUNT(1) paid_without_verified_payment FROM marketplace_payment WHERE provider='paystack' AND status='paid' AND verified_at IS NULL");
  const duplicateSettlement = await pool.query("SELECT COUNT(1) duplicate_provider_reference_settlements FROM (SELECT provider,provider_checkout_reference FROM marketplace_payment WHERE status IN ('paid','succeeded') GROUP BY provider,provider_checkout_reference HAVING COUNT(1)>1) d");
  const crossTenant = await pool.query("SELECT COUNT(1) cross_tenant_relationship_violations FROM marketplace_payment p JOIN marketplace_invoice i ON i.id=p.invoice_id WHERE p.tenant_id<>i.tenant_id");
  const invalidActivation = await pool.query("SELECT COUNT(1) activated_without_verified_paystack_payment FROM subcontractor_application a WHERE a.status='licence_issued' AND EXISTS (SELECT 1 FROM marketplace_invoice i JOIN marketplace_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id WHERE i.tenant_id=a.tenant_id AND i.application_id=a.id AND p.provider='paystack') AND NOT EXISTS (SELECT 1 FROM marketplace_invoice i JOIN marketplace_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id WHERE i.tenant_id=a.tenant_id AND i.application_id=a.id AND p.provider='paystack' AND p.status='paid' AND p.verified_at IS NOT NULL)");
  const result = Object.assign({}, connection.rows[0], migration.rows[0], duplicateCredits.rows[0], paidMismatch.rows[0], paidAmountMismatch.rows[0], paidCurrencyMismatch.rows[0], unverifiedPaid.rows[0], duplicateSettlement.rows[0], crossTenant.rows[0], invalidActivation.rows[0]);
  const countKeys = ["duplicate_credit_groups","paid_mismatches","paid_amount_mismatches","paid_currency_mismatches","paid_without_verified_payment","duplicate_provider_reference_settlements","cross_tenant_relationship_violations","activated_without_verified_paystack_payment"];
  if (result.db !== "govos_db" || Number(result.port) !== 5433 || Number(result.migration) !== 35 || countKeys.some(key => Number(result[key]) !== 0)) throw new Error(`PAY-1 invariant failure: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
