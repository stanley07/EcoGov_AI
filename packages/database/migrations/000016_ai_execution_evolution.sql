-- Milestone PA-2: Platform Execution Schema Evolution
-- Version: 000016
-- Name: ai_execution_evolution

-- Preflight checks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_execution') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_execution table does not exist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'application') THEN
    RAISE EXCEPTION 'Preflight verification failed: application table does not exist.';
  END IF;
END $$;

-- 1. Add evolution columns as nullable first
ALTER TABLE ai_execution ADD COLUMN application_id UUID REFERENCES application(id);
ALTER TABLE ai_execution ADD COLUMN agent_definition_id UUID REFERENCES agent_definition(id);
ALTER TABLE ai_execution ADD COLUMN agent_version_id UUID REFERENCES agent_version(id);
ALTER TABLE ai_execution ADD COLUMN actor_type VARCHAR(50);
ALTER TABLE ai_execution ADD COLUMN actor_user_id UUID REFERENCES user_account(id);
ALTER TABLE ai_execution ADD COLUMN actor_service_id VARCHAR(100);
ALTER TABLE ai_execution ADD COLUMN idempotency_key VARCHAR(255);
ALTER TABLE ai_execution ADD COLUMN request_hash VARCHAR(64);
ALTER TABLE ai_execution ADD COLUMN next_event_sequence INTEGER DEFAULT 0;
ALTER TABLE ai_execution ADD COLUMN parent_execution_id UUID REFERENCES ai_execution(id);
ALTER TABLE ai_execution ADD COLUMN correlation_id UUID;

-- 2. Backfill existing historical execution records (no raw defaults on new rows)
UPDATE ai_execution SET actor_type = 'system' WHERE actor_type IS NULL;
UPDATE ai_execution SET next_event_sequence = 0 WHERE next_event_sequence IS NULL;

-- 3. Set NOT NULL constraints on backfilled columns
ALTER TABLE ai_execution ALTER COLUMN actor_type SET NOT NULL;
ALTER TABLE ai_execution ALTER COLUMN next_event_sequence SET NOT NULL;

-- 4. Apply actor integrity constraints
ALTER TABLE ai_execution ADD CONSTRAINT chk_ai_execution_actor CHECK (
  (actor_type = 'user' AND actor_user_id IS NOT NULL AND actor_service_id IS NULL)
  OR
  (actor_type = 'service' AND actor_user_id IS NULL AND actor_service_id IS NOT NULL)
  OR
  (actor_type = 'system' AND actor_user_id IS NULL AND actor_service_id IS NULL)
);

ALTER TABLE ai_execution ADD CONSTRAINT chk_ai_execution_actor_type CHECK (
  actor_type IN ('user', 'service', 'system')
);

-- 5. Idempotency request hash constraint: if key is present, all other scope columns must be set
ALTER TABLE ai_execution ADD CONSTRAINT chk_ai_execution_idempotency_hash CHECK (
  idempotency_key IS NULL OR (
    request_hash IS NOT NULL
    AND application_id IS NOT NULL
    AND agent_definition_id IS NOT NULL
    AND agent_version_id IS NOT NULL
  )
);

-- 6. Scoped unique index for idempotency
CREATE UNIQUE INDEX uq_ai_execution_idempotency
ON ai_execution (
  tenant_id,
  application_id,
  agent_definition_id,
  idempotency_key
)
WHERE idempotency_key IS NOT NULL;
