-- PAY-1: provider-neutral subcontractor registration payment metadata.
ALTER TABLE marketplace_invoice
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT 'Subcontractor Registration Fee',
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE marketplace_payment
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS checkout_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_environment VARCHAR(10),
  ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(50),
  ADD COLUMN IF NOT EXISTS initialized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code VARCHAR(100);

ALTER TABLE marketplace_payment DROP CONSTRAINT IF EXISTS marketplace_payment_status_check;
ALTER TABLE marketplace_payment ADD CONSTRAINT marketplace_payment_status_check CHECK (
  status IN ('created', 'pending', 'processing', 'paid', 'succeeded', 'failed', 'cancelled',
             'refunded', 'partially_refunded', 'reversed')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_payment_environment_check') THEN
    ALTER TABLE marketplace_payment ADD CONSTRAINT marketplace_payment_environment_check
      CHECK (provider_environment IS NULL OR provider_environment IN ('test', 'live'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_payment_idempotency
  ON marketplace_payment (tenant_id, invoice_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_payment_ledger_credit
  ON marketplace_revenue_ledger (tenant_id, payment_id)
  WHERE entry_type = 'credit';

CREATE INDEX IF NOT EXISTS idx_marketplace_payment_invoice_history
  ON marketplace_payment (tenant_id, invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_payment_provider_status
  ON marketplace_payment (provider, status, created_at);

COMMENT ON COLUMN marketplace_payment.checkout_authorization_url IS
  'Provider-hosted checkout URL; never a credential and never proof of settlement.';
COMMENT ON COLUMN marketplace_payment.request_hash IS
  'SHA-256 of server-authoritative initialization inputs for idempotency conflict detection.';
