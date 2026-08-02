-- IAM-1 Gate 1: membership lifecycle, optimistic concurrency, and tenant integrity.
-- The migration runner wraps this file in a transaction.

ALTER TABLE membership
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE membership m
SET status = 'invited'
FROM user_account u
WHERE u.id = m.user_id
  AND u.tenant_id = m.tenant_id
  AND u.status = 'invited'
  AND m.status = 'active';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_account'::regclass
      AND conname = 'uq_user_account_tenant_id'
  ) THEN
    ALTER TABLE user_account
      ADD CONSTRAINT uq_user_account_tenant_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'role'::regclass
      AND conname = 'uq_role_tenant_id'
  ) THEN
    ALTER TABLE role
      ADD CONSTRAINT uq_role_tenant_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organization'::regclass
      AND conname = 'uq_organization_tenant_id'
  ) THEN
    ALTER TABLE organization
      ADD CONSTRAINT uq_organization_tenant_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'chk_membership_status'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT chk_membership_status
      CHECK (status IN ('invited', 'active', 'revoked')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'chk_membership_version_positive'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT chk_membership_version_positive
      CHECK (version >= 1) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'department'::regclass
      AND conname = 'uq_department_tenant_id'
  ) THEN
    ALTER TABLE department
      ADD CONSTRAINT uq_department_tenant_id UNIQUE (tenant_id, id);
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'fk_membership_tenant_user'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT fk_membership_tenant_user
      FOREIGN KEY (tenant_id, user_id)
      REFERENCES user_account (tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'fk_membership_tenant_role'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT fk_membership_tenant_role
      FOREIGN KEY (tenant_id, role_id)
      REFERENCES role (tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'fk_membership_tenant_organization'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT fk_membership_tenant_organization
      FOREIGN KEY (tenant_id, organization_id)
      REFERENCES organization (tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership'::regclass
      AND conname = 'fk_membership_tenant_department'
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT fk_membership_tenant_department
      FOREIGN KEY (tenant_id, department_id)
      REFERENCES department (tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE membership VALIDATE CONSTRAINT chk_membership_status;
ALTER TABLE membership VALIDATE CONSTRAINT chk_membership_version_positive;
ALTER TABLE membership VALIDATE CONSTRAINT fk_membership_tenant_user;
ALTER TABLE membership VALIDATE CONSTRAINT fk_membership_tenant_role;
ALTER TABLE membership VALIDATE CONSTRAINT fk_membership_tenant_organization;
ALTER TABLE membership VALIDATE CONSTRAINT fk_membership_tenant_department;

-- Replace PostgreSQL's NULL-unsafe legacy uniqueness with current-assignment indexes.
ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_user_id_organization_id_role_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_current_tenant_role
  ON membership (tenant_id, user_id, role_id)
  WHERE organization_id IS NULL AND status IN ('invited', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_current_organization_role
  ON membership (tenant_id, user_id, organization_id, role_id)
  WHERE organization_id IS NOT NULL AND status IN ('invited', 'active');

CREATE INDEX IF NOT EXISTS idx_membership_tenant_user_status
  ON membership (tenant_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_session_tenant_user
  ON session (tenant_id, user_id);
