-- IAM-1 Gate 4: account security state, password history, MFA challenges, and session metadata.
ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_by UUID,
  ADD COLUMN IF NOT EXISTS mfa_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_reset_by UUID,
  ADD COLUMN IF NOT EXISTS mfa_reset_reason TEXT,
  ADD COLUMN IF NOT EXISTS mfa_reenrollment_required BOOLEAN NOT NULL DEFAULT FALSE;

DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='user_account'::regclass AND conname='fk_user_password_reset_by') THEN
    ALTER TABLE user_account ADD CONSTRAINT fk_user_password_reset_by FOREIGN KEY(password_reset_by) REFERENCES user_account(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='user_account'::regclass AND conname='fk_user_mfa_reset_by') THEN
    ALTER TABLE user_account ADD CONSTRAINT fk_user_mfa_reset_by FOREIGN KEY(mfa_reset_by) REFERENCES user_account(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $migration$;
ALTER TABLE user_account VALIDATE CONSTRAINT fk_user_password_reset_by;
ALTER TABLE user_account VALIDATE CONSTRAINT fk_user_mfa_reset_by;

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS role_id UUID,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ip_address INET;

DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='session'::regclass AND conname='fk_session_tenant_role') THEN
    ALTER TABLE session ADD CONSTRAINT fk_session_tenant_role FOREIGN KEY(tenant_id,role_id) REFERENCES role(tenant_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
END $migration$;
ALTER TABLE session VALIDATE CONSTRAINT fk_session_tenant_role;

CREATE TABLE IF NOT EXISTS password_history(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, user_id UUID NOT NULL,
  password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_password_history_user FOREIGN KEY(tenant_id,user_id) REFERENCES user_account(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_history_user_created ON password_history(tenant_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS pending_auth_challenge(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, user_id UUID NOT NULL, role_id UUID NOT NULL,
  challenge_hash CHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_pending_auth_user FOREIGN KEY(tenant_id,user_id) REFERENCES user_account(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_pending_auth_role FOREIGN KEY(tenant_id,role_id) REFERENCES role(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT chk_pending_auth_attempts CHECK(attempt_count BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_pending_auth_active ON pending_auth_challenge(tenant_id,user_id,expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_authz_security_target ON authz_audit_log(tenant_id,resource,created_at DESC) WHERE action LIKE 'ACCOUNT_SECURITY_%';
