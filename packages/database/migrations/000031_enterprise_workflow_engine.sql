-- WF-1 Enterprise Workflow Engine (additive compatibility evolution)
-- Version: 000031

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = 31) THEN
    RAISE EXCEPTION 'Migration 000031 is already recorded';
  END IF;
  IF (SELECT COALESCE(MAX(version),0) FROM schema_migrations) <> 30 THEN
    RAISE EXCEPTION 'WF-1 requires migration 000030 as the current baseline';
  END IF;
  IF EXISTS (SELECT 1 FROM workflow_instance i LEFT JOIN workflow_version v ON v.tenant_id=i.tenant_id AND v.id=i.version_id WHERE v.id IS NULL) THEN
    RAISE EXCEPTION 'Unsafe orphan workflow instances detected';
  END IF;
END $$;

ALTER TABLE workflow_definition
  ADD COLUMN key VARCHAR(100), ADD COLUMN scope VARCHAR(30) NOT NULL DEFAULT 'tenant',
  ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active', ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN created_by UUID, ADD COLUMN updated_by UUID;
UPDATE workflow_definition SET key=lower(regexp_replace(name,'[^a-zA-Z0-9]+','-','g')) WHERE key IS NULL;
ALTER TABLE workflow_definition ALTER COLUMN key SET NOT NULL;
ALTER TABLE workflow_definition ADD CONSTRAINT chk_wf_definition_scope CHECK(scope IN ('tenant','system_template'));
ALTER TABLE workflow_definition ADD CONSTRAINT chk_wf_definition_status CHECK(status IN ('active','archived'));
ALTER TABLE workflow_definition ADD CONSTRAINT chk_wf_definition_version CHECK(version>0);
CREATE UNIQUE INDEX uq_wf_definition_tenant_key ON workflow_definition(tenant_id,key);

DROP INDEX IF EXISTS uq_workflow_single_active_version;
ALTER TABLE workflow_version DROP CONSTRAINT IF EXISTS workflow_version_status_check;
ALTER TABLE workflow_version ADD COLUMN configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN validation_report JSONB, ADD COLUMN definition_schema_version VARCHAR(30) NOT NULL DEFAULT '1.0',
  ADD COLUMN published_from_version_id UUID, ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE workflow_version SET status='published',is_default=TRUE WHERE status='active';
UPDATE workflow_version SET status='deprecated' WHERE status='deprecated';
ALTER TABLE workflow_version ADD CONSTRAINT chk_wf_version_status CHECK(status IN ('draft','validating','published','deprecated','withdrawn'));
ALTER TABLE workflow_version ADD CONSTRAINT chk_wf_version_row_version CHECK(version>0);
ALTER TABLE workflow_version ADD CONSTRAINT fk_wf_version_parent FOREIGN KEY(tenant_id,published_from_version_id) REFERENCES workflow_version(tenant_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_wf_default_published ON workflow_version(tenant_id,definition_id) WHERE status='published' AND is_default;

ALTER TABLE workflow_step_definition ADD COLUMN step_key VARCHAR(100), ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN required_permission VARCHAR(150), ADD COLUMN assignment JSONB,
  ADD COLUMN sla JSONB, ADD COLUMN handler_name VARCHAR(100), ADD COLUMN handler_version VARCHAR(30);
UPDATE workflow_step_definition SET step_key=lower(regexp_replace(step_name,'[^a-zA-Z0-9]+','-','g')) WHERE step_key IS NULL;
ALTER TABLE workflow_step_definition ALTER COLUMN step_key SET NOT NULL;
CREATE UNIQUE INDEX uq_wf_step_key ON workflow_step_definition(tenant_id,version_id,step_key);

ALTER TABLE workflow_transition ADD COLUMN transition_key VARCHAR(100), ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN required_permission VARCHAR(150), ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE workflow_transition SET transition_key=lower(outcome_code)||'-'||substr(id::text,1,8) WHERE transition_key IS NULL;
ALTER TABLE workflow_transition ALTER COLUMN transition_key SET NOT NULL;
CREATE UNIQUE INDEX uq_wf_transition_key ON workflow_transition(tenant_id,version_id,transition_key);
CREATE UNIQUE INDEX uq_wf_transition_default ON workflow_transition(tenant_id,version_id,from_step_definition_id) WHERE is_default;

ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD COLUMN definition_id UUID, ADD COLUMN current_step_definition_id UUID,
  ADD COLUMN organization_id UUID, ADD COLUMN business_key VARCHAR(255), ADD COLUMN correlation_id UUID,
  ADD COLUMN idempotency_key VARCHAR(255), ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN started_by UUID, ADD COLUMN started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN completed_at TIMESTAMPTZ, ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN suspended_at TIMESTAMPTZ, ADD COLUMN terminal_outcome VARCHAR(100),
  ADD COLUMN variables JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE workflow_instance i SET definition_id=v.definition_id FROM workflow_version v WHERE v.tenant_id=i.tenant_id AND v.id=i.version_id AND i.definition_id IS NULL;
ALTER TABLE workflow_instance ALTER COLUMN definition_id SET NOT NULL;
ALTER TABLE workflow_instance ADD CONSTRAINT fk_wf_instance_definition FOREIGN KEY(tenant_id,definition_id) REFERENCES workflow_definition(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE workflow_instance ADD CONSTRAINT fk_wf_instance_current_step FOREIGN KEY(tenant_id,current_step_definition_id) REFERENCES workflow_step_definition(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE workflow_instance ADD CONSTRAINT fk_wf_instance_org FOREIGN KEY(tenant_id,organization_id) REFERENCES organization(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE workflow_instance ADD CONSTRAINT chk_wf_instance_status CHECK(status IN ('pending','active','running','waiting','suspended','completed','cancelled','failed'));
ALTER TABLE workflow_instance ADD CONSTRAINT chk_wf_instance_version CHECK(version>0);
CREATE UNIQUE INDEX uq_wf_instance_idempotency ON workflow_instance(tenant_id,definition_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_wf_instance_tenant_status ON workflow_instance(tenant_id,status,updated_at DESC);

ALTER TABLE workflow_step_execution ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN execution_number INTEGER NOT NULL DEFAULT 1, ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN started_at TIMESTAMPTZ, ADD COLUMN due_at TIMESTAMPTZ, ADD COLUMN claimed_at TIMESTAMPTZ,
  ADD COLUMN claimed_by UUID, ADD COLUMN outcome_code VARCHAR(100), ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5, ADD COLUMN task_execution_id UUID;
ALTER TABLE workflow_step_execution ADD CONSTRAINT chk_wf_step_retry CHECK(retry_count>=0 AND retry_count<=max_attempts);
CREATE UNIQUE INDEX uq_wf_step_execution_number ON workflow_step_execution(tenant_id,workflow_instance_id,step_definition_id,execution_number);

CREATE TABLE workflow_command (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  instance_id UUID, idempotency_key VARCHAR(255) NOT NULL, command_type VARCHAR(80) NOT NULL,
  request_hash CHAR(64) NOT NULL, actor_user_id UUID, status VARCHAR(20) NOT NULL DEFAULT 'processing',
  response_payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  CHECK(status IN ('processing','completed','failed'))
);
CREATE TABLE workflow_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  instance_id UUID NOT NULL, sequence_number INTEGER NOT NULL, event_type VARCHAR(100) NOT NULL,
  actor_type VARCHAR(20) NOT NULL, actor_id UUID, command_id UUID, correlation_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,instance_id,sequence_number),
  FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,command_id) REFERENCES workflow_command(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_wf_event_history ON workflow_event(tenant_id,instance_id,sequence_number);

CREATE TABLE workflow_work_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  organization_id UUID, instance_id UUID NOT NULL, step_execution_id UUID NOT NULL,
  assignment_type VARCHAR(30) NOT NULL, assignee_user_id UUID, assignee_role_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 1,
  claimed_by UUID, claimed_at TIMESTAMPTZ, due_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,organization_id) REFERENCES organization(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,step_execution_id) REFERENCES workflow_step_execution(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,assignee_user_id) REFERENCES user_account(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,assignee_role_id) REFERENCES role(tenant_id,id) ON DELETE RESTRICT,
  CHECK(assignment_type IN ('direct_user','role_queue','organization_queue')),
  CHECK(status IN ('open','claimed','in_progress','completed','cancelled','expired')), CHECK(version>0)
);
CREATE UNIQUE INDEX uq_wf_active_work_item ON workflow_work_item(tenant_id,step_execution_id) WHERE status IN ('open','claimed','in_progress');
CREATE INDEX idx_wf_work_queue ON workflow_work_item(tenant_id,organization_id,status,due_at) WHERE status IN ('open','claimed','in_progress');

CREATE TABLE workflow_work_item_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  work_item_id UUID NOT NULL, action VARCHAR(40) NOT NULL, actor_id UUID, from_user_id UUID, to_user_id UUID,
  reason VARCHAR(500), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id,work_item_id) REFERENCES workflow_work_item(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE workflow_timer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  instance_id UUID NOT NULL, step_execution_id UUID, timer_type VARCHAR(30) NOT NULL, due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', idempotency_key VARCHAR(255) NOT NULL,
  lease_owner VARCHAR(255), lease_expires_at TIMESTAMPTZ, fencing_token BIGINT NOT NULL DEFAULT 0,
  fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,step_execution_id) REFERENCES workflow_step_execution(tenant_id,id) ON DELETE RESTRICT,
  CHECK(status IN ('pending','leased','fired','cancelled','failed'))
);
CREATE INDEX idx_wf_due_timer ON workflow_timer(due_at) WHERE status='pending';
CREATE TABLE workflow_sla_clock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  instance_id UUID NOT NULL, step_execution_id UUID, state VARCHAR(20) NOT NULL DEFAULT 'running',
  reminder_at TIMESTAMPTZ, due_at TIMESTAMPTZ NOT NULL, breached_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1,
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,step_execution_id) REFERENCES workflow_step_execution(tenant_id,id) ON DELETE RESTRICT,
  CHECK(state IN ('running','paused','met','breached','cancelled'))
);
CREATE UNIQUE INDEX uq_wf_active_sla ON workflow_sla_clock(tenant_id,step_execution_id) WHERE state IN ('running','paused');
CREATE TABLE workflow_escalation_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  sla_clock_id UUID NOT NULL, level INTEGER NOT NULL, action_type VARCHAR(30) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  outbox_event_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,sla_clock_id) REFERENCES workflow_sla_clock(tenant_id,id) ON DELETE RESTRICT,
  CHECK(level BETWEEN 1 AND 10), CHECK(action_type IN ('notify','reassign')), CHECK(status IN ('pending','completed','failed'))
);
CREATE TABLE workflow_ai_recommendation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  instance_id UUID NOT NULL, workflow_version_id UUID NOT NULL, instance_version INTEGER NOT NULL,
  recommendation_type VARCHAR(30) NOT NULL, recommendation JSONB NOT NULL, confidence NUMERIC(5,4),
  explanation TEXT, model_provider VARCHAR(100) NOT NULL, model_name VARCHAR(100) NOT NULL, model_version VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,instance_id) REFERENCES workflow_instance(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,workflow_version_id) REFERENCES workflow_version(tenant_id,id) ON DELETE RESTRICT,
  CHECK(recommendation_type IN ('transition','assignee','priority','risk')),
  CHECK(status IN ('active','accepted','rejected','stale')), CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE OR REPLACE FUNCTION reject_workflow_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WF_IMMUTABLE_HISTORY'; END $$;
CREATE TRIGGER workflow_event_immutable BEFORE UPDATE OR DELETE ON workflow_event FOR EACH ROW EXECUTE FUNCTION reject_workflow_immutable_change();
CREATE TRIGGER workflow_work_item_history_immutable BEFORE UPDATE OR DELETE ON workflow_work_item_history FOR EACH ROW EXECUTE FUNCTION reject_workflow_immutable_change();
CREATE OR REPLACE FUNCTION enforce_published_workflow_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status IN ('published','deprecated') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'WF_PUBLISHED_VERSION_IMMUTABLE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE ON workflow_version FOR EACH ROW EXECUTE FUNCTION enforce_published_workflow_immutability();

INSERT INTO permission(tenant_id,name,description)
SELECT t.id,p.name,'WF-1 exact workflow permission' FROM tenant t CROSS JOIN (VALUES
 ('workflow:definition:read'),('workflow:definition:create'),('workflow:definition:update'),('workflow:definition:validate'),('workflow:definition:publish'),
 ('workflow:instance:read'),('workflow:instance:start'),('workflow:instance:suspend'),('workflow:instance:resume'),('workflow:instance:cancel'),('workflow:instance:repair'),
 ('workflow:work-item:read'),('workflow:work-item:claim'),('workflow:work-item:assign'),('workflow:work-item:complete'),
 ('workflow:policy:read'),('workflow:policy:write'),('workflow:policy:publish'),('workflow:audit:read'),('workflow:operations:read')
) AS p(name) ON CONFLICT(tenant_id,name) DO NOTHING;
