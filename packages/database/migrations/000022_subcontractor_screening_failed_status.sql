-- Migration 000022: Subcontractor Screening Revisions and Telemetry Metrics

-- 1. Evolve application status check constraint to include 'screening_failed'
ALTER TABLE subcontractor_application DROP CONSTRAINT IF EXISTS chk_subcontractor_application_status;
ALTER TABLE subcontractor_application ADD CONSTRAINT chk_subcontractor_application_status CHECK (
  status IN (
    'draft', 'submitted', 'screening_queued', 'screening_in_progress',
    'screening_failed', 'awaiting_officer_review', 'more_information_required',
    'approved', 'rejected', 'invoice_pending', 'payment_pending',
    'payment_confirmed', 'licence_issued', 'withdrawn', 'expired'
  )
);

-- 2. Add provider model and version identity fields to subcontractor_screening_result
ALTER TABLE subcontractor_screening_result ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100);
ALTER TABLE subcontractor_screening_result ADD COLUMN IF NOT EXISTS provider_model VARCHAR(100);
ALTER TABLE subcontractor_screening_result ADD COLUMN IF NOT EXISTS provider_model_version VARCHAR(100);
ALTER TABLE subcontractor_screening_result ADD COLUMN IF NOT EXISTS agent_version_id UUID REFERENCES agent_version(id) ON DELETE RESTRICT;
ALTER TABLE subcontractor_screening_result ADD COLUMN IF NOT EXISTS prompt_version_id UUID REFERENCES prompt_version(id) ON DELETE RESTRICT;

-- 3. Add partial unique index to subcontractor_licence ensuring at most one active licence exists per subcontractor profile
DROP INDEX IF EXISTS uq_active_licence;
CREATE UNIQUE INDEX uq_active_licence ON subcontractor_licence (tenant_id, subcontractor_id) WHERE (status = 'active');

-- 4. Add telemetry latency duration columns to marketplace_payment_event
ALTER TABLE marketplace_payment_event ADD COLUMN IF NOT EXISTS processing_latency_ms INTEGER;
ALTER TABLE marketplace_payment_event ADD COLUMN IF NOT EXISTS signature_validation_duration_ms INTEGER;
ALTER TABLE marketplace_payment_event ADD COLUMN IF NOT EXISTS reconciliation_duration_ms INTEGER;

-- 5. Add worker issue latency column to subcontractor_licence
ALTER TABLE subcontractor_licence ADD COLUMN IF NOT EXISTS worker_issue_duration_ms INTEGER;
