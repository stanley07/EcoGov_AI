-- IAM-1 Gate 5: organization lifecycle concurrency and scoped invitations.
ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $migration$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='organization'::regclass AND conname='chk_organization_status') THEN
    ALTER TABLE organization ADD CONSTRAINT chk_organization_status CHECK(status IN('active','suspended','archived')) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='organization'::regclass AND conname='chk_organization_version_positive') THEN
    ALTER TABLE organization ADD CONSTRAINT chk_organization_version_positive CHECK(version>=1) NOT VALID;
  END IF;
END $migration$;
ALTER TABLE organization VALIDATE CONSTRAINT chk_organization_status;
ALTER TABLE organization VALIDATE CONSTRAINT chk_organization_version_positive;

ALTER TABLE user_invitation ADD COLUMN IF NOT EXISTS organization_id UUID;
DO $migration$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='user_invitation'::regclass AND conname='fk_invitation_tenant_organization') THEN
    ALTER TABLE user_invitation ADD CONSTRAINT fk_invitation_tenant_organization
      FOREIGN KEY(tenant_id,organization_id) REFERENCES organization(tenant_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $migration$;
ALTER TABLE user_invitation VALIDATE CONSTRAINT fk_invitation_tenant_organization;
CREATE INDEX IF NOT EXISTS idx_invitation_tenant_organization_status ON user_invitation(tenant_id,organization_id,status);
CREATE INDEX IF NOT EXISTS idx_organization_tenant_status ON organization(tenant_id,status) WHERE deleted_at IS NULL;
