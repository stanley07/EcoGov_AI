-- Phase PA-1.1: Staged MFA schema extension & Idempotency Leases
DO $$
DECLARE
  has_mfa_secret BOOLEAN;
  has_mfa_recovery_codes BOOLEAN;
  legacy_count INTEGER := 0;
BEGIN
  -- 1. Check if legacy columns exist in user_account
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_account' AND column_name = 'mfa_secret'
  ) INTO has_mfa_secret;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_account' AND column_name = 'mfa_recovery_codes'
  ) INTO has_mfa_recovery_codes;

  -- 2. Count legacy values if columns exist
  IF has_mfa_secret THEN
    EXECUTE 'SELECT COUNT(*) FROM user_account WHERE mfa_secret IS NOT NULL' INTO legacy_count;
    IF legacy_count > 0 THEN
      RAISE EXCEPTION 'Preflight verification failed: Plaintext mfa_secret records exist. Safe migration aborted.';
    END IF;
  END IF;

  IF has_mfa_recovery_codes THEN
    EXECUTE 'SELECT COUNT(*) FROM user_account WHERE mfa_recovery_codes IS NOT NULL' INTO legacy_count;
    IF legacy_count > 0 THEN
      RAISE EXCEPTION 'Preflight verification failed: Plaintext mfa_recovery_codes records exist. Safe migration aborted.';
    END IF;
  END IF;
END $$;

-- 3. Add structured MFA columns to user_account
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_secret_encrypted JSONB;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_recovery_code_hashes JSONB;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_recovery_codes_generated_at TIMESTAMPTZ;

-- 4. Add leasing columns to idempotency_record
ALTER TABLE idempotency_record ADD COLUMN IF NOT EXISTS lock_owner UUID;
ALTER TABLE idempotency_record ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE idempotency_record ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(100);

-- 5. Add check constraint to idempotency_record
ALTER TABLE idempotency_record DROP CONSTRAINT IF EXISTS chk_idempotency_attempt_count;
ALTER TABLE idempotency_record ADD CONSTRAINT chk_idempotency_attempt_count CHECK (attempt_count >= 1);
