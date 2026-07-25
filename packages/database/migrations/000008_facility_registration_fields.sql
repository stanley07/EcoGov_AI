-- Migration 000008: Facility Registration Fields
CREATE TABLE IF NOT EXISTS facility_registration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  reference_number VARCHAR(100) NOT NULL,
  client_submission_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'submitted',
  submitted_by UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  description TEXT,
  town VARCHAR(100),
  lga VARCHAR(100),
  contact_person VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(100),
  permit_number VARCHAR(100),
  registration_notes TEXT,
  preliminary_risk_rating VARCHAR(50),
  official_risk_rating VARCHAR(50),
  record_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, reference_number),
  UNIQUE (tenant_id, client_submission_id),
  CHECK (status IN (
    'submitted',
    'ai_review_pending',
    'officer_review',
    'approved',
    'rejected',
    'more_information_required',
    'withdrawn'
  )),
  CHECK (preliminary_risk_rating IS NULL OR preliminary_risk_rating IN ('low', 'medium', 'high')),
  CHECK (official_risk_rating IS NULL OR official_risk_rating IN ('low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_facility_registration_status ON facility_registration(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_facility_registration_created_at ON facility_registration(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_facility_tenant_registration_status ON facility(tenant_id, registration_status);
CREATE INDEX IF NOT EXISTS idx_facility_tenant_created_at ON facility(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_facility_tenant_category_custom ON facility(tenant_id, category);
