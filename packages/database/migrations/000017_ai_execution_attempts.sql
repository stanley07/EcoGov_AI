-- Milestone PA-2: Platform Execution Attempts
-- Version: 000017
-- Name: ai_execution_attempts

-- Preflight checks
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_execution_attempt') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_execution_attempt table already exists.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_execution') THEN
    RAISE EXCEPTION 'Preflight verification failed: ai_execution table does not exist.';
  END IF;
END $$;

-- 1. Create execution attempts table
CREATE TABLE ai_execution_attempt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL REFERENCES ai_execution(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  task_execution_id UUID REFERENCES task_execution(id) ON DELETE SET NULL,
  provider VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failure_code VARCHAR(50),
  retryable BOOLEAN NOT NULL DEFAULT TRUE,
  input_tokens INTEGER DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_microunits BIGINT DEFAULT 0 CHECK (estimated_cost_microunits >= 0),
  actual_cost_microunits BIGINT CHECK (actual_cost_microunits >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  finish_reason VARCHAR(50),
  provider_request_id VARCHAR(255),
  provider_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempt_count >= 0),
  tool_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_attempt_count >= 0),
  UNIQUE (ai_execution_id, attempt_number),
  CONSTRAINT chk_ai_execution_attempt_completed_after_started CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);
