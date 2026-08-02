-- Commercial launch: applicant bank-transfer claims verified through reconciliation.
ALTER TABLE marketplace_invoice
  ADD COLUMN bank_name VARCHAR(160) NOT NULL DEFAULT 'EcoGov Pilot Bank',
  ADD COLUMN account_name VARCHAR(200) NOT NULL DEFAULT 'GovOS Environmental Revenue',
  ADD COLUMN account_number VARCHAR(20) NOT NULL DEFAULT '0000000000',
  ADD COLUMN payment_reference VARCHAR(160);

UPDATE marketplace_invoice
SET payment_reference = invoice_number
WHERE payment_reference IS NULL;

CREATE TABLE marketplace_payment_claim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  transaction_reference VARCHAR(255) NOT NULL,
  payment_date DATE NOT NULL,
  payer_name VARCHAR(255) NOT NULL,
  claimed_amount_microunits BIGINT NOT NULL CHECK (claimed_amount_microunits > 0),
  claimed_currency CHAR(3) NOT NULL CHECK (claimed_currency ~ '^[A-Z]{3}$'),
  receipt_document_id UUID NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'awaiting_verification'
    CHECK (status IN ('awaiting_verification', 'confirmed', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payment_claim_app FOREIGN KEY (tenant_id, application_id)
    REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_claim_invoice FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES marketplace_invoice(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_claim_receipt FOREIGN KEY (tenant_id, receipt_document_id)
    REFERENCES subcontractor_application_document(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_payment_claim_reference UNIQUE (transaction_reference),
  CONSTRAINT uq_payment_claim_idempotency UNIQUE (tenant_id, application_id, idempotency_key),
  CONSTRAINT uq_payment_claim_tenant UNIQUE (tenant_id, id)
);

CREATE INDEX idx_payment_claim_pending
  ON marketplace_payment_claim (tenant_id, status, created_at);

-- Tenant-scoped permission used by both officer and finance roles.
INSERT INTO permission (tenant_id, name, description)
SELECT id, 'marketplace.payment.verify', 'Verify or reject marketplace bank-transfer payment claims'
FROM tenant
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.tenant_id = r.tenant_id AND p.name = 'marketplace.payment.verify'
WHERE lower(r.name) IN ('finance officer', 'officer', 'director', 'super admin')
ON CONFLICT DO NOTHING;
