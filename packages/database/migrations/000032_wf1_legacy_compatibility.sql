-- WF-1 compatibility correction for legacy workflow writers.
ALTER TABLE workflow_definition ALTER COLUMN key SET DEFAULT ('legacy-' || gen_random_uuid()::text);
ALTER TABLE workflow_step_definition ALTER COLUMN step_key SET DEFAULT ('legacy-' || gen_random_uuid()::text);
ALTER TABLE workflow_transition ALTER COLUMN transition_key SET DEFAULT ('legacy-' || gen_random_uuid()::text);

ALTER TABLE workflow_version DROP CONSTRAINT chk_wf_version_status;
ALTER TABLE workflow_version ADD CONSTRAINT chk_wf_version_status
  CHECK(status IN ('draft','validating','active','published','deprecated','withdrawn'));
CREATE UNIQUE INDEX uq_workflow_single_active_version
  ON workflow_version(tenant_id,definition_id) WHERE status='active';

ALTER TABLE workflow_instance ALTER COLUMN definition_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION wf1_derive_legacy_instance_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.definition_id IS NULL THEN
    SELECT definition_id INTO NEW.definition_id FROM workflow_version
    WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id;
  END IF;
  IF NEW.definition_id IS NULL THEN RAISE EXCEPTION 'WF_INSTANCE_VERSION_NOT_FOUND'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf1_legacy_instance_definition BEFORE INSERT ON workflow_instance
  FOR EACH ROW EXECUTE FUNCTION wf1_derive_legacy_instance_definition();
ALTER TABLE workflow_instance ALTER COLUMN definition_id SET NOT NULL;
