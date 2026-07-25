-- Milestone PA-2: Platform Agent Registry tables
-- Version: 000015
-- Name: agent_registries

-- Preflight checks: ensure we are in a clean/valid schema state
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'agent_definition') THEN
    RAISE EXCEPTION 'Preflight verification failed: agent_definition table already exists.';
  END IF;
END $$;

-- 1. Canonical Application Registry
CREATE TABLE application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Agent Definition & Versions (Application-scoped keys)
CREATE TABLE agent_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  owning_application_id UUID NOT NULL REFERENCES application(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'deprecated', 'inactive')),
  UNIQUE (owning_application_id, key)
);

-- 3. Prompt Registry (Application-scoped keys)
CREATE TABLE prompt_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  owning_application_id UUID NOT NULL REFERENCES application(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owning_application_id, key)
);

CREATE TABLE prompt_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_definition_id UUID NOT NULL REFERENCES prompt_definition(id) ON DELETE RESTRICT,
  version VARCHAR(50) NOT NULL,
  template TEXT NOT NULL,
  variables_schema JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_definition_id, version),
  CHECK (status IN ('draft', 'active', 'deprecated'))
);

-- 4. Output Contract Registry (Application-scoped keys)
CREATE TABLE output_contract_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  owning_application_id UUID NOT NULL REFERENCES application(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owning_application_id, key)
);

CREATE TABLE output_contract_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  output_contract_definition_id UUID NOT NULL REFERENCES output_contract_definition(id) ON DELETE RESTRICT,
  version VARCHAR(50) NOT NULL,
  json_schema JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (output_contract_definition_id, version),
  CHECK (status IN ('draft', 'active', 'deprecated'))
);

-- 5. Agent Versions with Limits
CREATE TABLE agent_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_definition_id UUID NOT NULL REFERENCES agent_definition(id) ON DELETE RESTRICT,
  version VARCHAR(50) NOT NULL,
  prompt_version_id UUID NOT NULL REFERENCES prompt_version(id) ON DELETE RESTRICT,
  output_contract_version_id UUID NOT NULL REFERENCES output_contract_version(id) ON DELETE RESTRICT,
  model_policy JSONB NOT NULL,
  safety_profile JSONB NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 30 CHECK (timeout_seconds > 0),
  max_model_turns INTEGER NOT NULL DEFAULT 5 CHECK (max_model_turns > 0),
  max_tool_calls INTEGER NOT NULL DEFAULT 3 CHECK (max_tool_calls >= 0),
  max_input_tokens INTEGER NOT NULL DEFAULT 50000 CHECK (max_input_tokens > 0),
  max_output_tokens INTEGER NOT NULL DEFAULT 1000 CHECK (max_output_tokens > 0),
  max_tool_output_bytes INTEGER NOT NULL DEFAULT 100000 CHECK (max_tool_output_bytes > 0),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  UNIQUE (agent_definition_id, version),
  CHECK (status IN ('draft', 'active', 'retired'))
);

-- 6. Tool Registry (Tool keys remain globally unique)
CREATE TABLE tool_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tool_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_definition_id UUID NOT NULL REFERENCES tool_definition(id) ON DELETE RESTRICT,
  version VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  output_schema JSONB,
  required_permissions VARCHAR(100)[] NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms > 0),
  max_output_bytes INTEGER NOT NULL DEFAULT 100000 CHECK (max_output_bytes > 0),
  retry_policy JSONB NOT NULL,
  redaction_policy JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tool_definition_id, version),
  CHECK (status IN ('draft', 'active', 'deprecated', 'retired'))
);

CREATE TABLE agent_version_tool (
  agent_version_id UUID NOT NULL REFERENCES agent_version(id) ON DELETE CASCADE,
  tool_version_id UUID NOT NULL REFERENCES tool_version(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_version_id, tool_version_id)
);

-- 7. Registry Database Immutability Triggers
CREATE OR REPLACE FUNCTION block_prompt_version_content_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('active', 'deprecated') THEN
    IF OLD.template <> NEW.template OR OLD.variables_schema <> NEW.variables_schema OR OLD.content_hash <> NEW.content_hash THEN
      RAISE EXCEPTION 'Immutable prompt version cannot be modified after activation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prompt_version_immutability
BEFORE UPDATE ON prompt_version
FOR EACH ROW EXECUTE FUNCTION block_prompt_version_content_updates();

CREATE OR REPLACE FUNCTION block_output_contract_version_content_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('active', 'deprecated') THEN
    IF OLD.json_schema <> NEW.json_schema OR OLD.content_hash <> NEW.content_hash THEN
      RAISE EXCEPTION 'Immutable output contract version cannot be modified after activation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_output_contract_version_immutability
BEFORE UPDATE ON output_contract_version
FOR EACH ROW EXECUTE FUNCTION block_output_contract_version_content_updates();

CREATE OR REPLACE FUNCTION block_agent_version_content_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('active', 'retired') THEN
    IF OLD.prompt_version_id <> NEW.prompt_version_id OR
       OLD.output_contract_version_id <> NEW.output_contract_version_id OR
       OLD.model_policy <> NEW.model_policy OR
       OLD.safety_profile <> NEW.safety_profile OR
       OLD.timeout_seconds <> NEW.timeout_seconds OR
       OLD.max_model_turns <> NEW.max_model_turns OR
       OLD.max_tool_calls <> NEW.max_tool_calls OR
       OLD.max_input_tokens <> NEW.max_input_tokens OR
       OLD.max_output_tokens <> NEW.max_output_tokens OR
       OLD.max_tool_output_bytes <> NEW.max_tool_output_bytes THEN
      RAISE EXCEPTION 'Immutable agent version cannot be modified after activation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agent_version_immutability
BEFORE UPDATE ON agent_version
FOR EACH ROW EXECUTE FUNCTION block_agent_version_content_updates();

CREATE OR REPLACE FUNCTION block_tool_version_content_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('active', 'deprecated', 'retired') THEN
    IF OLD.input_schema <> NEW.input_schema OR
       OLD.output_schema IS DISTINCT FROM NEW.output_schema OR
       OLD.required_permissions <> NEW.required_permissions OR
       OLD.timeout_ms <> NEW.timeout_ms OR
       OLD.retry_policy <> NEW.retry_policy OR
       OLD.redaction_policy <> NEW.redaction_policy THEN
      RAISE EXCEPTION 'Immutable tool version cannot be modified after activation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tool_version_immutability
BEFORE UPDATE ON tool_version
FOR EACH ROW EXECUTE FUNCTION block_tool_version_content_updates();
