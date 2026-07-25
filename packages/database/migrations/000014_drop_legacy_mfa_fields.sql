-- Phase PA-1.2: Remove legacy plaintext MFA fields
DO $$
DECLARE
  legacy_count BIGINT;
BEGIN
  -- 1. Check and verify mfa_secret column
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_account'
      AND column_name = 'mfa_secret'
  ) THEN
    EXECUTE
      'SELECT COUNT(*) FROM user_account WHERE mfa_secret IS NOT NULL'
      INTO legacy_count;

    IF legacy_count > 0 THEN
      RAISE EXCEPTION
        'Legacy mfa_secret values remain; removal aborted.';
    END IF;
  END IF;

  -- 2. Check and verify mfa_recovery_codes column
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_account'
      AND column_name = 'mfa_recovery_codes'
  ) THEN
    EXECUTE
      'SELECT COUNT(*) FROM user_account WHERE mfa_recovery_codes IS NOT NULL'
      INTO legacy_count;

    IF legacy_count > 0 THEN
      RAISE EXCEPTION
        'Legacy recovery-code values remain; removal aborted.';
    END IF;
  END IF;

  -- 3. Assert all enrolled MFA users have structured credentials
  IF EXISTS (
    SELECT 1
    FROM user_account
    WHERE mfa_enrollment_status IN ('enrolled', 'verified')
      AND (
        mfa_secret_encrypted IS NULL
        OR mfa_recovery_code_hashes IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'Structured MFA credentials are incomplete; removal aborted.';
  END IF;
END $$;

-- 4. Safely drop columns
ALTER TABLE user_account DROP COLUMN IF EXISTS mfa_secret;
ALTER TABLE user_account DROP COLUMN IF EXISTS mfa_recovery_codes;
