-- Milestone 2 Hardening & Refinement Migration
-- Version: 000003
-- Name: milestone2_hardening

-- Clean up any default user seeds from migration 2 to prevent hardcoded passwords in repo
DELETE FROM membership;
DELETE FROM user_account;

-- Remove old tables to build hardened tenant-isolated composite schema
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS ai_execution CASCADE;
DROP TABLE IF EXISTS registration_review CASCADE;
DROP TABLE IF EXISTS workflow_step CASCADE;
DROP TABLE IF EXISTS workflow CASCADE;

-- Extend role hierarchy with cycle protection
ALTER TABLE role ADD COLUMN parent_role_id UUID REFERENCES role(id) ON DELETE RESTRICT;

-- Enforce composite keys on tenant
ALTER TABLE tenant ADD CONSTRAINT uq_tenant_id UNIQUE (id);

-- Enforce composite tenant keys on organization
ALTER TABLE organization ADD CONSTRAINT uq_organization_tenant_id UNIQUE (tenant_id, id);

-- Enforce composite tenant keys on user_account
ALTER TABLE user_account ADD CONSTRAINT uq_user_account_tenant_id UNIQUE (tenant_id, id);

-- Enforce composite tenant keys on role
ALTER TABLE role ADD CONSTRAINT uq_role_tenant_id UNIQUE (tenant_id, id);

-- 1. Workflow Definition Configuration
CREATE TABLE workflow_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE workflow_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  definition_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  deprecated_at TIMESTAMPTZ,
  configuration_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (definition_id, version_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES workflow_definition(tenant_id, id) ON DELETE RESTRICT,
  CHECK (status IN ('draft', 'active', 'deprecated'))
);

CREATE UNIQUE INDEX uq_workflow_single_active_version
ON workflow_version (definition_id)
WHERE status = 'active';

CREATE TABLE workflow_step_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  version_id UUID NOT NULL,
  step_name VARCHAR(100) NOT NULL,
  step_type VARCHAR(50) NOT NULL,
  configuration JSONB NOT NULL,
  configuration_schema_version VARCHAR(50) NOT NULL,
  is_entry_step BOOLEAN NOT NULL DEFAULT FALSE,
  is_terminal_step BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_id, step_name),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES workflow_version(tenant_id, id) ON DELETE RESTRICT,
  CHECK (step_type IN ('human_review', 'agent_execution', 'notification', 'document_validation', 'domain_command', 'wait_until', 'conditional_branch'))
);

CREATE TABLE workflow_transition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  version_id UUID NOT NULL,
  from_step_definition_id UUID,
  outcome_code VARCHAR(50) NOT NULL,
  to_step_definition_id UUID NOT NULL,
  condition_expression JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, from_step_definition_id, outcome_code, priority),
  FOREIGN KEY (tenant_id, version_id) REFERENCES workflow_version(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, from_step_definition_id) REFERENCES workflow_step_definition(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, to_step_definition_id) REFERENCES workflow_step_definition(tenant_id, id) ON DELETE RESTRICT,
  CHECK (priority >= 0)
);

-- 2. Workflow Runtime Instances
CREATE TABLE workflow_instance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  version_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES workflow_version(tenant_id, id) ON DELETE RESTRICT,
  CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE TABLE workflow_step_execution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  workflow_instance_id UUID NOT NULL,
  step_definition_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  actor_type VARCHAR(50) NOT NULL,
  actor_id UUID,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES workflow_instance(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, step_definition_id) REFERENCES workflow_step_definition(tenant_id, id) ON DELETE RESTRICT,
  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CHECK (actor_type IN ('user', 'agent', 'system', 'service'))
);

CREATE TABLE workflow_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  workflow_instance_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES workflow_instance(tenant_id, id) ON DELETE RESTRICT
);

-- 3. Refined AI Audit Subsystem (Append-only metadata log)
CREATE TABLE ai_execution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  workflow_instance_id UUID,
  workflow_step_execution_id UUID,
  agent_name VARCHAR(100) NOT NULL,
  model_provider VARCHAR(255) NOT NULL,
  model_name VARCHAR(255) NOT NULL,
  prompt_template_version VARCHAR(255),
  input_schema_version VARCHAR(255),
  output_schema_version VARCHAR(255),
  input_hash VARCHAR(64) NOT NULL,
  output_hash VARCHAR(64),
  token_input INTEGER,
  token_output INTEGER,
  estimated_cost_minor_units BIGINT,
  billing_currency CHAR(3) NOT NULL DEFAULT 'USD',
  latency_ms INTEGER,
  execution_status VARCHAR(50) NOT NULL,
  validation_status VARCHAR(50) NOT NULL,
  review_status VARCHAR(50) NOT NULL DEFAULT 'unreviewed',
  failure_category VARCHAR(50),
  human_override BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  error_code VARCHAR(50),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES workflow_instance(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workflow_step_execution_id) REFERENCES workflow_step_execution(tenant_id, id) ON DELETE RESTRICT,
  CHECK (execution_status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'policy_blocked')),
  CHECK (validation_status IN ('pending', 'valid', 'invalid', 'not_applicable')),
  CHECK (review_status IN ('unreviewed', 'accepted', 'rejected')),
  CHECK (failure_category IN ('provider_error', 'rate_limited', 'authentication_error', 'schema_error', 'policy_error', 'internal_error')),
  CHECK (token_input IS NULL OR token_input >= 0),
  CHECK (token_output IS NULL OR token_output >= 0),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (estimated_cost_minor_units IS NULL OR estimated_cost_minor_units >= 0),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE ai_evidence_bundle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  ai_execution_id UUID NOT NULL,
  storage_reference VARCHAR(512) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  storage_generation VARCHAR(255),
  encryption_key_version VARCHAR(255),
  retention_class VARCHAR(50) NOT NULL,
  redaction_policy_version VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, ai_execution_id) REFERENCES ai_execution(tenant_id, id) ON DELETE RESTRICT
);

-- 4. Durable Idempotency
CREATE TABLE task_execution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  task_id VARCHAR(255) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ DEFAULT NOW(),
  lease_owner VARCHAR(255),
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_reference JSONB,
  failure_code VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, task_id),
  CHECK (status IN ('pending', 'processing', 'completed', 'retryable_failed', 'permanently_failed')),
  CHECK (attempt_count >= 0),
  CHECK (max_attempts > 0),
  CHECK (attempt_count <= max_attempts)
);

-- 5. Authorization Auditing
CREATE TABLE authz_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES user_account(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  result VARCHAR(50) NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (result IN ('allow', 'deny'))
);

-- Indexes for common runtime operations
CREATE INDEX idx_task_execution_claimable
ON task_execution (available_at, status)
WHERE status IN ('pending', 'retryable_failed');

CREATE INDEX idx_task_execution_expired_lease
ON task_execution (lease_expires_at)
WHERE status = 'processing';

CREATE INDEX idx_workflow_instance_entity
ON workflow_instance (tenant_id, entity_type, entity_id);

CREATE INDEX idx_workflow_step_pending
ON workflow_step_execution (tenant_id, status, created_at);

CREATE INDEX idx_ai_execution_workflow
ON ai_execution (tenant_id, workflow_instance_id, started_at);

CREATE INDEX idx_authz_audit_tenant_time
ON authz_audit_log (tenant_id, created_at);
