-- Evolve subcontractor profile to track scorecard metadata
ALTER TABLE subcontractor_profile
  ADD COLUMN performance_score_policy_version VARCHAR(50),
  ADD COLUMN performance_score_calculated_at TIMESTAMPTZ,
  ADD COLUMN performance_score_audit_count INTEGER;

-- Evolve subcontractor enforcement action for warning deduplication
ALTER TABLE subcontractor_enforcement_action
  ADD COLUMN trigger_type VARCHAR(50),
  ADD COLUMN trigger_reference VARCHAR(255),
  ADD COLUMN policy_version VARCHAR(50);

-- Enforce warning deduplication at db level
CREATE UNIQUE INDEX uq_active_score_warning
  ON subcontractor_enforcement_action (tenant_id, subcontractor_id, trigger_reference)
  WHERE (status IN ('proposed', 'active', 'stayed') AND trigger_reference IS NOT NULL);

-- Enforce one open appeal per enforcement action at db level
CREATE UNIQUE INDEX uq_open_enforcement_appeal
  ON subcontractor_appeal (tenant_id, enforcement_action_id)
  WHERE (status = 'pending');

-- Score calculation history tracking
CREATE TABLE subcontractor_performance_score_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  subcontractor_id UUID NOT NULL,
  previous_score NUMERIC(3,2),
  new_score NUMERIC(3,2) NOT NULL,
  eligible_audit_count INTEGER NOT NULL,
  scoring_policy_version VARCHAR(50) NOT NULL,
  trigger_audit_id UUID,
  correlation_id UUID NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_score_event_profile FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES subcontractor_profile(tenant_id, id) ON DELETE RESTRICT
);
