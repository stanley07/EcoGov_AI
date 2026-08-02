-- Enable btree_gist extension for territory overlap check exclusions
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Reference Geography Tables (with Composite Unique Tenant Keys)
CREATE TABLE IF NOT EXISTS local_government_area (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  state_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lga_tenant UNIQUE (tenant_id, id),
  CONSTRAINT uq_lga_names UNIQUE (tenant_id, state_name, name)
);

CREATE TABLE IF NOT EXISTS cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  region_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cluster_tenant UNIQUE (tenant_id, id),
  CONSTRAINT uq_cluster_name UNIQUE (tenant_id, name)
);

-- 2. Subcontractor Onboarding Applications
CREATE TABLE subcontractor_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  business_name VARCHAR(255) NOT NULL,
  registration_number VARCHAR(100) NOT NULL,
  tax_identifier VARCHAR(100) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(50) NOT NULL,
  operating_address TEXT NOT NULL,
  experience_years INTEGER NOT NULL CHECK (experience_years >= 0),
  license_type VARCHAR(100) NOT NULL,
  access_token_hash VARCHAR(64) NOT NULL, -- SHA-256 cryptographic hash digest
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_subcontractor_app_reg UNIQUE (tenant_id, registration_number),
  CONSTRAINT uq_subcontractor_app_tax UNIQUE (tenant_id, tax_identifier),
  CONSTRAINT uq_subcontractor_app_tenant UNIQUE (tenant_id, id),
  CONSTRAINT chk_subcontractor_application_status CHECK (
    status IN (
      'draft', 'submitted', 'screening_queued', 'screening_in_progress',
      'awaiting_officer_review', 'more_information_required', 'approved',
      'rejected', 'invoice_pending', 'payment_pending', 'payment_confirmed',
      'licence_issued', 'withdrawn', 'expired'
    )
  )
);

CREATE TABLE subcontractor_application_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  scan_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'passed', 'failed')),
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  CONSTRAINT fk_document_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_document_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE subcontractor_application_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  actor_type VARCHAR(30) NOT NULL CHECK (actor_type IN ('user', 'system', 'ai', 'payment_provider')),
  actor_id UUID,
  previous_state VARCHAR(50), -- Nullable for initial creation
  new_state VARCHAR(50) NOT NULL,
  reason TEXT,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_event_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_app_event_actor CHECK (
    (actor_type = 'user' AND actor_id IS NOT NULL) OR actor_type IN ('system', 'ai', 'payment_provider')
  )
);

-- 3. Structured Screening Results
CREATE TABLE subcontractor_screening_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  ai_execution_id UUID NOT NULL REFERENCES ai_execution(id) ON DELETE RESTRICT,
  screening_policy_version VARCHAR(50) NOT NULL,
  output_contract_version_id UUID,
  input_snapshot_hash VARCHAR(64) NOT NULL,
  screening_status VARCHAR(50) NOT NULL CHECK (screening_status IN ('completed', 'failed')),
  application_version INTEGER NOT NULL,
  recommendation VARCHAR(50) CHECK (recommendation IN ('recommended', 'needs_review', 'high_risk')),
  score NUMERIC(5, 2) CHECK (score >= 0 AND score <= 100),
  criteria JSONB,
  risk_flags TEXT[],
  model_version VARCHAR(100),
  screened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_screening_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_screening_outcome CHECK (
    (screening_status = 'completed' AND recommendation IS NOT NULL AND score IS NOT NULL AND criteria IS NOT NULL AND model_version IS NOT NULL)
    OR (screening_status = 'failed')
  ),
  CONSTRAINT uq_screening_tenant UNIQUE (tenant_id, id)
);

-- 4. Enduring Profiles & Time-bound Licences
CREATE TABLE subcontractor_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID UNIQUE,
  business_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'under_review', 'restricted', 'suspended', 'revoked', 'archived')
  ),
  performance_score NUMERIC(3, 2) NOT NULL DEFAULT 5.00 CHECK (performance_score >= 0 AND performance_score <= 5),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_profile_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_profile_tenant UNIQUE (tenant_id, id)
);

-- 5. Commercial Invoices
CREATE TABLE marketplace_invoice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  invoice_number VARCHAR(100) UNIQUE NOT NULL,
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL CONSTRAINT chk_billing_dates CHECK (billing_period_end > billing_period_start),
  amount_due_microunits BIGINT NOT NULL CHECK (amount_due_microunits > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(50) NOT NULL DEFAULT 'unpaid' CHECK (
    status IN ('unpaid', 'pending', 'paid', 'void', 'expired', 'refunded', 'partially_refunded')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_invoice_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_invoice_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE subcontractor_licence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  subcontractor_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  licence_number VARCHAR(100) UNIQUE NOT NULL,
  verification_code VARCHAR(100) UNIQUE NOT NULL,
  licence_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'expired', 'suspended', 'revoked', 'cancelled')
  ),
  issued_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CONSTRAINT chk_licence_dates CHECK (expires_at > valid_from),
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_licence_profile FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_licence_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES marketplace_invoice(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_licence_tenant UNIQUE (tenant_id, id)
);

-- 6. Geographic Region Assignments (Overlap Exclusions)
CREATE TABLE subcontractor_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  subcontractor_id UUID NOT NULL,
  assignment_type VARCHAR(50) NOT NULL CHECK (assignment_type IN ('lga', 'cluster')),
  lga_id UUID,
  cluster_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  assigned_by UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_assignment_dates CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT chk_assignment_target CHECK (
    (assignment_type = 'lga' AND lga_id IS NOT NULL AND cluster_id IS NULL) OR
    (assignment_type = 'cluster' AND cluster_id IS NOT NULL AND lga_id IS NULL)
  ),
  CONSTRAINT fk_assignment_profile FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignment_lga FOREIGN KEY (tenant_id, lga_id) REFERENCES local_government_area(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignment_cluster FOREIGN KEY (tenant_id, cluster_id) REFERENCES cluster(tenant_id, id) ON DELETE RESTRICT
);

-- Range overlapping exclusion constraints
ALTER TABLE subcontractor_assignment ADD CONSTRAINT exclude_overlapping_lga_assignments
EXCLUDE USING gist (
  tenant_id WITH =,
  lga_id WITH =,
  tstzrange(starts_at, COALESCE(ends_at, 'infinity')) WITH &&
) WHERE (status = 'active' AND lga_id IS NOT NULL);

ALTER TABLE subcontractor_assignment ADD CONSTRAINT exclude_overlapping_cluster_assignments
EXCLUDE USING gist (
  tenant_id WITH =,
  cluster_id WITH =,
  tstzrange(starts_at, COALESCE(ends_at, 'infinity')) WITH &&
) WHERE (status = 'active' AND cluster_id IS NOT NULL);

-- 7. Quality Audits, Findings & Enforcement Actions
CREATE TABLE subcontractor_quality_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  subcontractor_id UUID NOT NULL,
  auditor_type VARCHAR(30) NOT NULL CHECK (auditor_type IN ('officer', 'ai', 'system')),
  auditor_id UUID,
  ai_execution_id UUID REFERENCES ai_execution(id),
  audit_type VARCHAR(100) NOT NULL,
  associated_resource_type VARCHAR(100),
  associated_resource_id UUID,
  score NUMERIC(5, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  status VARCHAR(50) NOT NULL DEFAULT 'completed' CHECK (
    status IN ('draft', 'completed', 'disputed', 'confirmed', 'overturned')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_profile FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_audit_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE subcontractor_quality_finding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  audit_id UUID NOT NULL,
  finding_code VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  evidence_references JSONB NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_finding_audit FOREIGN KEY (tenant_id, audit_id) REFERENCES subcontractor_quality_audit(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE subcontractor_enforcement_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  subcontractor_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('warning', 'restriction', 'suspension', 'revocation')),
  reason TEXT NOT NULL,
  initiated_by UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (
    status IN ('proposed', 'active', 'stayed', 'overturned', 'resolved', 'expired')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_enforcement_profile FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_enforcement_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE subcontractor_appeal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  enforcement_action_id UUID NOT NULL,
  subcontractor_justification TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  officer_decision TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_appeal_enforcement FOREIGN KEY (tenant_id, enforcement_action_id) REFERENCES subcontractor_enforcement_action(tenant_id, id) ON DELETE RESTRICT
);

-- 8. Commercial Billing and Payment Webhooks
CREATE TABLE marketplace_payment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL,
  provider VARCHAR(100) NOT NULL,
  provider_checkout_reference VARCHAR(255) UNIQUE NOT NULL,
  provider_transaction_reference VARCHAR(255),
  amount_paid_microunits BIGINT NOT NULL CHECK (amount_paid_microunits >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(50) NOT NULL CHECK (
    status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'reversed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payment_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES marketplace_invoice(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_payment_ref UNIQUE (provider, provider_transaction_reference),
  CONSTRAINT uq_payment_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE marketplace_payment_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE RESTRICT,
  webhook_event_id VARCHAR(255) UNIQUE NOT NULL,
  provider VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(64) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  provider_created_at TIMESTAMPTZ,
  signature_verified_at TIMESTAMPTZ NOT NULL,
  processing_status VARCHAR(50) NOT NULL CHECK (
    processing_status IN ('received', 'verified', 'processing', 'processed', 'failed', 'ignored')
  ),
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  last_error_message_redacted TEXT,
  sanitized_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  entry_reference VARCHAR(255) UNIQUE NOT NULL,
  amount_microunits BIGINT NOT NULL CHECK (amount_microunits > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  entry_type VARCHAR(50) NOT NULL CHECK (
    entry_type IN ('credit', 'debit', 'refund', 'chargeback', 'adjustment')
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ledger_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES marketplace_invoice(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ledger_payment FOREIGN KEY (tenant_id, payment_id) REFERENCES marketplace_payment(tenant_id, id) ON DELETE RESTRICT
);

-- Append-only constraints on revenue ledger (Triggers prevent edits)
CREATE OR REPLACE FUNCTION protect_revenue_ledger()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are append-only. Modification or removal of records is strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_revenue_ledger
BEFORE UPDATE OR DELETE ON marketplace_revenue_ledger
FOR EACH ROW EXECUTE FUNCTION protect_revenue_ledger();
