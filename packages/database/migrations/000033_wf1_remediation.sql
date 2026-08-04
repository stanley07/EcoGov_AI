-- WF-1 approved remediation: canonical lifecycle, restricted immutability,
-- fenced scheduling, and definition-level authorization.
-- Version: 000033

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = 33) THEN
    RAISE EXCEPTION 'Migration 000033 is already recorded';
  END IF;
  IF (SELECT COALESCE(MAX(version), 0) FROM schema_migrations) <> 32 THEN
    RAISE EXCEPTION 'WF-1 remediation requires migration 000032 as the current baseline';
  END IF;
  IF EXISTS (
    SELECT 1 FROM workflow_step_execution
    WHERE status NOT IN ('pending','processing','completed','failed','created','ready','claimed','running','waiting','cancelled','skipped','dead_lettered')
  ) THEN
    RAISE EXCEPTION 'WF_STEP_STATUS_PREFLIGHT_FAILED';
  END IF;
END $$;

LOCK TABLE workflow_step_execution IN SHARE ROW EXCLUSIVE MODE;
UPDATE workflow_step_execution SET status = 'ready' WHERE status = 'pending';
UPDATE workflow_step_execution SET status = 'running' WHERE status = 'processing';
ALTER TABLE workflow_step_execution DROP CONSTRAINT IF EXISTS workflow_step_execution_status_check;
ALTER TABLE workflow_step_execution DROP CONSTRAINT IF EXISTS chk_wf_step_execution_status;
ALTER TABLE workflow_step_execution ADD CONSTRAINT chk_wf_step_execution_status CHECK (
  status IN ('created','ready','claimed','running','waiting','completed','failed','cancelled','skipped','dead_lettered')
);

CREATE OR REPLACE FUNCTION enforce_workflow_step_execution_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status='created' AND NEW.status IN ('ready','running','waiting','cancelled','skipped')) OR
    (OLD.status='ready' AND NEW.status IN ('claimed','running','waiting','cancelled','skipped')) OR
    (OLD.status='claimed' AND NEW.status IN ('running','ready','cancelled')) OR
    (OLD.status='running' AND NEW.status IN ('waiting','completed','failed','ready','cancelled')) OR
    (OLD.status='waiting' AND NEW.status IN ('ready','running','completed','failed','cancelled')) OR
    (OLD.status='failed' AND NEW.status IN ('ready','dead_lettered'))
  ) THEN RAISE EXCEPTION 'WF_INVALID_STEP_EXECUTION_TRANSITION: % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_step_execution_lifecycle ON workflow_step_execution;
CREATE TRIGGER workflow_step_execution_lifecycle BEFORE UPDATE OF status ON workflow_step_execution
  FOR EACH ROW EXECUTE FUNCTION enforce_workflow_step_execution_lifecycle();

UPDATE workflow_version SET status='published' WHERE status='active';
UPDATE workflow_version SET status='deprecated',is_default=FALSE WHERE status='withdrawn';
ALTER TABLE workflow_version DROP CONSTRAINT IF EXISTS chk_wf_version_status;
ALTER TABLE workflow_version ADD CONSTRAINT chk_wf_version_status CHECK(status IN ('draft','validating','published','deprecated'));
ALTER TABLE workflow_version DROP CONSTRAINT IF EXISTS chk_wf_version_default_published;
ALTER TABLE workflow_version ADD CONSTRAINT chk_wf_version_default_published CHECK(NOT is_default OR status='published');
DROP INDEX IF EXISTS uq_workflow_single_active_version;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_default_published ON workflow_version(tenant_id,definition_id)
  WHERE status='published' AND is_default;

CREATE OR REPLACE FUNCTION enforce_published_workflow_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft','validating') THEN
    RAISE EXCEPTION 'WF_INVALID_VERSION_TRANSITION';
  ELSIF OLD.status = 'validating' AND NEW.status NOT IN ('validating','draft','published') THEN
    RAISE EXCEPTION 'WF_INVALID_VERSION_TRANSITION';
  ELSIF OLD.status = 'published' AND NEW.status NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'WF_INVALID_VERSION_TRANSITION';
  ELSIF OLD.status = 'deprecated' AND NEW.status <> 'deprecated' THEN
    RAISE EXCEPTION 'WF_INVALID_VERSION_TRANSITION';
  END IF;

  IF OLD.status IN ('validating','published','deprecated') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.definition_id IS DISTINCT FROM OLD.definition_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.configuration IS DISTINCT FROM OLD.configuration OR
    NEW.configuration_hash IS DISTINCT FROM OLD.configuration_hash OR
    NEW.definition_schema_version IS DISTINCT FROM OLD.definition_schema_version OR
    NEW.published_from_version_id IS DISTINCT FROM OLD.published_from_version_id
  ) THEN RAISE EXCEPTION 'WF_PUBLISHED_VERSION_IMMUTABLE'; END IF;

  IF NEW.is_default AND NEW.status <> 'published' THEN
    RAISE EXCEPTION 'WF_DEFAULT_REQUIRES_PUBLISHED_VERSION';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_version_immutable ON workflow_version;
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE ON workflow_version
  FOR EACH ROW EXECUTE FUNCTION enforce_published_workflow_immutability();

ALTER TABLE task_execution ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0;
ALTER TABLE workflow_sla_clock ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE workflow_sla_clock ADD COLUMN IF NOT EXISTS breach_task_id UUID;
ALTER TABLE workflow_timer ADD COLUMN IF NOT EXISTS task_execution_id UUID;
ALTER TABLE workflow_timer ADD COLUMN IF NOT EXISTS failure_code VARCHAR(80);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_wf_timer_task_execution') THEN
    ALTER TABLE workflow_timer ADD CONSTRAINT fk_wf_timer_task_execution
      FOREIGN KEY(task_execution_id) REFERENCES task_execution(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_wf_sla_breach_task') THEN
    ALTER TABLE workflow_sla_clock ADD CONSTRAINT fk_wf_sla_breach_task
      FOREIGN KEY(breach_task_id) REFERENCES task_execution(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_sla_reminder_identity ON workflow_timer(tenant_id,step_execution_id,timer_type)
  WHERE timer_type='sla_reminder';
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_sla_breach_identity ON workflow_timer(tenant_id,step_execution_id,timer_type)
  WHERE timer_type='sla_breach';

CREATE TABLE IF NOT EXISTS workflow_definition_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  definition_id UUID NOT NULL,
  command_type VARCHAR(80) NOT NULL,
  permission_name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,definition_id,command_type,permission_name),
  FOREIGN KEY(tenant_id,definition_id) REFERENCES workflow_definition(tenant_id,id) ON DELETE RESTRICT,
  CHECK(command_type IN ('start','read','cancel','suspend','resume','repair'))
);

INSERT INTO permission(tenant_id,name,description)
SELECT t.id,p.name,'WF-1 exact workflow permission' FROM tenant t CROSS JOIN (VALUES
 ('workflow:work-item:accept'),('workflow:work-item:reassign'),('workflow:work-item:cancel'),
 ('workflow:recommendation:read'),('workflow:recommendation:decide')
) AS p(name) ON CONFLICT(tenant_id,name) DO NOTHING;
