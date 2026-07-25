-- Milestone 3 AI Runtime Hardening Migration
-- Version: 000004
-- Name: milestone3_runtime

ALTER TABLE ai_execution ADD COLUMN current_state VARCHAR(50) NOT NULL DEFAULT 'queued';
ALTER TABLE ai_execution ADD COLUMN iteration_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_execution ADD COLUMN model_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_execution ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_execution ADD COLUMN accumulated_cost_minor_units BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_execution ADD COLUMN active_deadline TIMESTAMPTZ;

CREATE TABLE ai_model_call (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL,
  prompt_content_hash VARCHAR(64) NOT NULL,
  response_content_hash VARCHAR(64),
  token_input INTEGER NOT NULL,
  token_output INTEGER NOT NULL,
  estimated_cost_minor_units BIGINT NOT NULL,
  latency_ms INTEGER NOT NULL,
  finish_reason VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, ai_execution_id) REFERENCES ai_execution(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE ai_tool_invocation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  tool_version VARCHAR(50) NOT NULL,
  arguments_hash VARCHAR(64) NOT NULL,
  result_hash VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  execution_status VARCHAR(50) NOT NULL,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, ai_execution_id) REFERENCES ai_execution(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE ai_policy_decision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL,
  policy_name VARCHAR(100) NOT NULL,
  decision VARCHAR(50) NOT NULL, -- allowed, allowed_after_redaction, blocked, human_review_required
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, ai_execution_id) REFERENCES ai_execution(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE ai_execution_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL,
  from_state VARCHAR(50) NOT NULL,
  to_state VARCHAR(50) NOT NULL,
  event_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, ai_execution_id) REFERENCES ai_execution(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_ai_model_call_execution ON ai_model_call(tenant_id, ai_execution_id);
CREATE INDEX idx_ai_tool_invocation_execution ON ai_tool_invocation(tenant_id, ai_execution_id);
CREATE INDEX idx_ai_policy_decision_execution ON ai_policy_decision(tenant_id, ai_execution_id);
CREATE INDEX idx_ai_execution_event_execution ON ai_execution_event(tenant_id, ai_execution_id);
