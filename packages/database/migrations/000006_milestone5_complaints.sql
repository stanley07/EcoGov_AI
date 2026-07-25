-- Milestone 5 Complaints Schema Migration
-- Version: 000006
-- Name: milestone5_complaints

CREATE TABLE complaint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  reference_number VARCHAR(100) NOT NULL,
  client_submission_id VARCHAR(255) NOT NULL, -- Idempotency key
  citizen_name VARCHAR(100),
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL, -- Authoritative original description
  normalized_description TEXT, -- Safe normalized description
  location TEXT NOT NULL,
  category VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'triage_pending',
  is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_rule_codes JSONB NOT NULL DEFAULT '[]',
  retention_class VARCHAR(50) NOT NULL DEFAULT 'general',
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_deletion_at TIMESTAMPTZ,
  anonymized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reference_number),
  UNIQUE (tenant_id, client_submission_id),
  CHECK (status IN ('submitted', 'triage_pending', 'officer_review', 'assigned', 'rejected', 'merged', 'withdrawn', 'closed')),
  CHECK (LENGTH(description) <= 8000)
);

CREATE TABLE complaint_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  complaint_id UUID NOT NULL,
  ciphertext TEXT NOT NULL,
  key_version VARCHAR(50) NOT NULL,
  nonce VARCHAR(100) NOT NULL,
  classification VARCHAR(50) NOT NULL DEFAULT 'confidential',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, complaint_id) REFERENCES complaint (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, complaint_id)
);

CREATE TABLE complaint_triage_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  complaint_id UUID NOT NULL,
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instance(id) ON DELETE RESTRICT,
  workflow_step_execution_id UUID NOT NULL REFERENCES workflow_step_execution(id) ON DELETE RESTRICT,
  ai_execution_id UUID REFERENCES ai_execution(id) ON DELETE RESTRICT,
  classified_category VARCHAR(100) NOT NULL,
  recommended_priority VARCHAR(50) NOT NULL,
  summary TEXT NOT NULL,
  extracted_location JSONB NOT NULL DEFAULT '{}',
  alleged_incident_type VARCHAR(300) NOT NULL,
  potential_hazards JSONB NOT NULL DEFAULT '[]',
  recommended_department VARCHAR(100) NOT NULL,
  duplicate_assessment JSONB NOT NULL DEFAULT '{}',
  confidence_score NUMERIC(4,3) NOT NULL,
  requires_immediate_human_attention BOOLEAN NOT NULL DEFAULT FALSE,
  attention_reasons JSONB NOT NULL DEFAULT '[]',
  recommended_next_action VARCHAR(100) NOT NULL,
  triage_status VARCHAR(50) NOT NULL DEFAULT 'unreviewed',
  officer_user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  officer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, complaint_id) REFERENCES complaint (tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, complaint_id, ai_execution_id),
  CHECK (confidence_score BETWEEN 0 AND 1),
  CHECK (triage_status IN ('unreviewed', 'accepted', 'accepted_with_changes', 'rejected', 'superseded', 'unavailable'))
);

CREATE TABLE complaint_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  complaint_id UUID NOT NULL,
  assigned_department VARCHAR(100) NOT NULL,
  assigned_officer_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  assigning_officer_id UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  assignment_reason TEXT,
  triage_review_id UUID REFERENCES complaint_triage_review(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, complaint_id) REFERENCES complaint (tenant_id, id) ON DELETE RESTRICT,
  CHECK (status IN ('active', 'reassigned', 'completed'))
);

CREATE INDEX idx_complaint_tenant_status ON complaint (tenant_id, status);
CREATE INDEX idx_complaint_similarity ON complaint (tenant_id, category, location);
CREATE INDEX idx_complaint_triage_review_ref ON complaint_triage_review (tenant_id, complaint_id);
