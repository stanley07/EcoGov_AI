-- Milestone 4 AI Registration Review Domain Migration
-- Version: 000005
-- Name: milestone4_registration_review

CREATE TABLE registration_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE RESTRICT,
  workflow_instance_id UUID REFERENCES workflow_instance(id) ON DELETE RESTRICT,
  workflow_step_execution_id UUID REFERENCES workflow_step_execution(id) ON DELETE RESTRICT,
  ai_execution_id UUID REFERENCES ai_execution(id) ON DELETE RESTRICT,
  agent_name VARCHAR(100) NOT NULL,
  agent_version VARCHAR(50) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  recommended_category VARCHAR(100) NOT NULL,
  category_matches_submission BOOLEAN NOT NULL,
  detected_inconsistencies JSONB NOT NULL DEFAULT '[]',
  missing_documents JSONB NOT NULL DEFAULT '[]',
  preliminary_risk_rating VARCHAR(50) NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL,
  rationale TEXT NOT NULL,
  permit_status VARCHAR(50) NOT NULL,
  permit_reference VARCHAR(255),
  requires_officer_attention BOOLEAN NOT NULL DEFAULT FALSE,
  attention_reasons JSONB NOT NULL DEFAULT '[]',
  review_status VARCHAR(50) NOT NULL DEFAULT 'unreviewed',
  officer_user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  officer_notes TEXT,
  override_reasons TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (review_status IN ('unreviewed', 'accepted', 'accepted_with_changes', 'rejected', 'superseded'))
);

CREATE INDEX idx_registration_review_facility ON registration_review(tenant_id, facility_id);
CREATE INDEX idx_registration_review_workflow ON registration_review(tenant_id, workflow_instance_id);
