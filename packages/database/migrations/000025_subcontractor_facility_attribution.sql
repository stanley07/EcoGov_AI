-- Migration 000025: Subcontractor Facility Attribution and Funnel Events
ALTER TABLE subcontractor_application_event ADD COLUMN IF NOT EXISTS event_type VARCHAR(100);
ALTER TABLE subcontractor_application_event ADD COLUMN IF NOT EXISTS source_type VARCHAR(80);
ALTER TABLE subcontractor_application_event ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE subcontractor_application_event ADD COLUMN IF NOT EXISTS event_key VARCHAR(160);
ALTER TABLE subcontractor_application_event ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill legacy records to avoid NULL constraints
UPDATE subcontractor_application_event 
SET event_type = 'application.state_transition:' || new_state,
    event_key = 'application.state_transition:' || new_state || ':' || id
WHERE event_type IS NULL OR event_key IS NULL;

-- Add NOT NULL constraints
ALTER TABLE subcontractor_application_event ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE subcontractor_application_event ALTER COLUMN event_key SET NOT NULL;

-- Enforce unique keys
ALTER TABLE subcontractor_application_event ADD CONSTRAINT uq_subcontractor_application_event_key UNIQUE (tenant_id, application_id, event_key);

CREATE TABLE subcontractor_facility_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  subcontractor_id UUID NOT NULL,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  licence_id UUID NOT NULL REFERENCES subcontractor_licence(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL REFERENCES subcontractor_assignment(id) ON DELETE RESTRICT,
  lga_id UUID REFERENCES local_government_area(id) ON DELETE RESTRICT,
  cluster_id UUID REFERENCES cluster(id) ON DELETE RESTRICT,
  registration_status VARCHAR(50) NOT NULL DEFAULT 'completed' CHECK (registration_status IN ('completed', 'rejected', 'duplicate')),
  registration_correlation_id UUID NOT NULL,
  idempotency_key_hash VARCHAR(64) NOT NULL,
  licence_number_snapshot VARCHAR(100) NOT NULL,
  licence_valid_from_snapshot TIMESTAMPTZ NOT NULL,
  licence_expires_at_snapshot TIMESTAMPTZ NOT NULL,
  assignment_scope_type VARCHAR(50) NOT NULL CHECK (assignment_scope_type IN ('lga', 'cluster')),
  assignment_scope_id UUID NOT NULL,
  assignment_started_at_snapshot TIMESTAMPTZ NOT NULL,
  subcontractor_name_snapshot VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_attr_sub FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_sub_fac_attr UNIQUE (tenant_id, subcontractor_id, facility_id),
  CONSTRAINT check_assignment_scope CHECK (
    (assignment_scope_type = 'lga' AND lga_id IS NOT NULL AND cluster_id IS NULL AND assignment_scope_id = lga_id) OR
    (assignment_scope_type = 'cluster' AND cluster_id IS NOT NULL AND lga_id IS NULL AND assignment_scope_id = cluster_id)
  )
);

ALTER TABLE subcontractor_facility_attribution ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);

-- Index for unique completed facility registrations (only one successful registration per facility per tenant)
CREATE UNIQUE INDEX uq_completed_facility_attribution
ON subcontractor_facility_attribution (tenant_id, facility_id)
WHERE registration_status = 'completed';

-- Index for unique correlation IDs
CREATE UNIQUE INDEX uq_facility_attribution_correlation
ON subcontractor_facility_attribution (tenant_id, registration_correlation_id);

-- Index for unique idempotency key per subcontractor
CREATE UNIQUE INDEX uq_facility_attribution_idempotency
ON subcontractor_facility_attribution (tenant_id, subcontractor_id, idempotency_key_hash);

-- Prevent update or delete triggers (executes protect_revenue_ledger which throws on modification)
CREATE TRIGGER trg_protect_facility_attribution
BEFORE UPDATE OR DELETE
ON subcontractor_facility_attribution
FOR EACH ROW
EXECUTE FUNCTION protect_revenue_ledger();

CREATE TRIGGER trg_protect_subcontractor_application_event
BEFORE UPDATE OR DELETE
ON subcontractor_application_event
FOR EACH ROW
EXECUTE FUNCTION protect_revenue_ledger();

-- Analytics search indexes
CREATE INDEX idx_sub_fac_attr_created_at ON subcontractor_facility_attribution(tenant_id, created_at);
CREATE INDEX idx_sub_fac_attr_sub_created_at ON subcontractor_facility_attribution(tenant_id, subcontractor_id, created_at);
CREATE INDEX idx_sub_fac_attr_lga ON subcontractor_facility_attribution(tenant_id, lga_id, created_at);
CREATE INDEX idx_sub_fac_attr_cluster ON subcontractor_facility_attribution(tenant_id, cluster_id, created_at);

-- Historical events backfill with schema-required column defaults
INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, id, 'application.created', 'application.created:' || id, created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_application
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, id, 'application.submitted', 'application.submitted:' || id, updated_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_application
WHERE status != 'draft' AND status != 'withdrawn'
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, application_id, 'screening.started', 'screening.started:' || id, screened_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_screening_result
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, application_id, 'screening.completed', 'screening.completed:' || id, screened_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_screening_result
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, id, 'officer.approved', 'officer.approved:' || id, updated_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_application
WHERE status = 'approved' OR status = 'payment_confirmed' OR status = 'licence_issued'
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, application_id, 'invoice.created', 'invoice.created:' || id, created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM marketplace_invoice
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, application_id, 'checkout.created', 'checkout.created:' || id, created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM marketplace_invoice
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT tenant_id, application_id, 'payment.confirmed', 'payment.confirmed:' || id, created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM marketplace_invoice
WHERE status = 'paid'
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT l.tenant_id, p.application_id, 'licence.issued', 'licence.issued:' || l.id, l.created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_licence l
JOIN subcontractor_profile p ON p.id = l.subcontractor_id
ON CONFLICT DO NOTHING;

INSERT INTO subcontractor_application_event (tenant_id, application_id, event_type, event_key, created_at, actor_type, new_state, correlation_id, metadata)
SELECT a.tenant_id, p.application_id, 'assignment.activated', 'assignment.activated:' || a.id, a.created_at, 'system', 'backfilled', '00000000-0000-0000-0000-000000000000', '{"backfilled": true}'::jsonb
FROM subcontractor_assignment a
JOIN subcontractor_profile p ON p.id = a.subcontractor_id
ON CONFLICT DO NOTHING;
