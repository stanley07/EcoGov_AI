-- Phase PA-1.1: Platform Administration MFA Schema Changes

-- 1. Add MFA fields to user_account
ALTER TABLE user_account ADD COLUMN mfa_enrollment_status VARCHAR(50) NOT NULL DEFAULT 'unenrolled';
ALTER TABLE user_account ADD COLUMN mfa_secret VARCHAR(255);
ALTER TABLE user_account ADD COLUMN mfa_recovery_codes TEXT;
ALTER TABLE user_account ADD CONSTRAINT chk_user_mfa_status CHECK (mfa_enrollment_status IN ('unenrolled', 'pending_verification', 'verified'));
