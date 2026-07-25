-- Milestone PA-2: Platform Outbox, Tool Auditing & Reservations
-- Version: 000019
-- Name: agent_outbox_and_tool_audit

-- Preflight checks
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'outbox_event') THEN
    RAISE EXCEPTION 'Preflight verification failed: outbox_event table already exists.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_usage_reservation') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_usage_reservation table already exists.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_tool_invocation') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_tool_invocation table does not exist.';
  END IF;
END $$;

-- 1. Create Transaction Outbox Table
CREATE TABLE outbox_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  lock_owner VARCHAR(255),
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  last_error_code VARCHAR(50),
  deduplication_key VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT chk_outbox_event_dispatched_after_created CHECK (
    dispatched_at IS NULL OR dispatched_at >= created_at
  )
);

-- 2. Evolve Existing Tool Invocation Table
-- A. Drop old constraints and make columns nullable
ALTER TABLE ai_tool_invocation DROP CONSTRAINT IF EXISTS ai_tool_invocation_tenant_id_idempotency_key_key;
ALTER TABLE ai_tool_invocation ALTER COLUMN idempotency_key DROP NOT NULL;
ALTER TABLE ai_tool_invocation ALTER COLUMN result_hash DROP NOT NULL;

-- B. Add new evolution columns
ALTER TABLE ai_tool_invocation ADD COLUMN ai_execution_attempt_id UUID REFERENCES ai_execution_attempt(id) ON DELETE CASCADE;
ALTER TABLE ai_tool_invocation ADD COLUMN tool_version_id UUID REFERENCES tool_version(id) ON DELETE RESTRICT;
ALTER TABLE ai_tool_invocation ADD COLUMN provider_tool_call_id VARCHAR(255);
ALTER TABLE ai_tool_invocation ADD COLUMN sequence_number INTEGER;
ALTER TABLE ai_tool_invocation ADD COLUMN authorization_status VARCHAR(50) DEFAULT 'authorized';
ALTER TABLE ai_tool_invocation ADD COLUMN authorization_reason_code VARCHAR(50);
ALTER TABLE ai_tool_invocation ADD COLUMN arguments_redacted JSONB;
ALTER TABLE ai_tool_invocation ADD COLUMN requested_at TIMESTAMPTZ;
ALTER TABLE ai_tool_invocation ADD COLUMN authorized_at TIMESTAMPTZ;
ALTER TABLE ai_tool_invocation ADD COLUMN started_at TIMESTAMPTZ;
ALTER TABLE ai_tool_invocation ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE ai_tool_invocation ADD COLUMN retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0);
ALTER TABLE ai_tool_invocation ADD COLUMN result_redacted JSONB;
ALTER TABLE ai_tool_invocation ADD COLUMN failure_code VARCHAR(50);

-- C. Rename columns and adapt types
ALTER TABLE ai_tool_invocation RENAME COLUMN execution_status TO status;

-- D. Backfill existing records
WITH sequenced AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY ai_execution_id
      ORDER BY created_at, id
    ) AS calculated_sequence
  FROM ai_tool_invocation
  WHERE sequence_number IS NULL
)
UPDATE ai_tool_invocation t
SET sequence_number = sequenced.calculated_sequence
FROM sequenced
WHERE t.id = sequenced.id;

UPDATE ai_tool_invocation SET requested_at = created_at WHERE requested_at IS NULL;
UPDATE ai_tool_invocation SET authorization_status = 'authorized' WHERE authorization_status IS NULL;

-- E. Apply NOT NULL constraints after backfill
ALTER TABLE ai_tool_invocation ALTER COLUMN sequence_number SET NOT NULL;
ALTER TABLE ai_tool_invocation ALTER COLUMN authorization_status SET NOT NULL;
ALTER TABLE ai_tool_invocation ALTER COLUMN requested_at SET NOT NULL;

-- F. Apply check constraints & unique indexes
ALTER TABLE ai_tool_invocation ADD CONSTRAINT chk_tool_invocation_auth_status CHECK (authorization_status IN ('authorized', 'denied'));

ALTER TABLE ai_tool_invocation ADD CONSTRAINT chk_tool_invocation_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'denied'));

ALTER TABLE ai_tool_invocation ADD CONSTRAINT chk_tool_invocation_timestamps CHECK (
  (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
  AND
  (authorization_status <> 'denied' OR started_at IS NULL)
);

ALTER TABLE ai_tool_invocation ADD CONSTRAINT chk_tool_invocation_denied_rules CHECK (
  authorization_status <> 'denied'
  OR (
    status = 'denied'
    AND authorization_reason_code IS NOT NULL
    AND authorized_at IS NULL
    AND started_at IS NULL
  )
);

ALTER TABLE ai_tool_invocation ADD CONSTRAINT chk_tool_invocation_authorized_rules CHECK (
  authorization_status <> 'authorized'
  OR authorization_reason_code IS NULL
);

ALTER TABLE ai_tool_invocation ADD CONSTRAINT uq_tool_invocation_seq UNIQUE (ai_execution_id, sequence_number);

CREATE UNIQUE INDEX uq_tool_invocation_provider_call
ON ai_tool_invocation (
  ai_execution_attempt_id,
  provider_tool_call_id
)
WHERE provider_tool_call_id IS NOT NULL;

-- 3. Create Usage & Quota Ledger Reservations
CREATE TABLE ai_usage_reservation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL REFERENCES ai_execution(id) ON DELETE CASCADE,
  policy_version VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'reserved',
  reserved_input_tokens INTEGER NOT NULL CHECK (reserved_input_tokens >= 0),
  reserved_output_tokens INTEGER NOT NULL CHECK (reserved_output_tokens >= 0),
  reserved_cost_microunits BIGINT NOT NULL CHECK (reserved_cost_microunits >= 0),
  actual_cost_microunits BIGINT CHECK (actual_cost_microunits >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  reconciled_at TIMESTAMPTZ,
  CHECK (status IN ('reserved', 'released', 'charged', 'expired')),
  CONSTRAINT chk_usage_reservation_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_usage_reservation_reconciled CHECK (
    reconciled_at IS NULL OR reconciled_at >= created_at
  ),
  CONSTRAINT chk_usage_reservation_status_timestamps CHECK (
    (status = 'reserved' AND reconciled_at IS NULL)
    OR
    (status <> 'reserved' AND reconciled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_active_usage_reservation
ON ai_usage_reservation (ai_execution_id)
WHERE status = 'reserved';
