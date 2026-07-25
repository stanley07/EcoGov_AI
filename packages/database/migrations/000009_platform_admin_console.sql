-- Phase PA-1.1: Platform Administration Console Schema Changes

-- 1. Add is_system, session_version, version and slug to tenant table safely
ALTER TABLE tenant ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenant ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenant ADD COLUMN slug VARCHAR(255);

-- 2. Backfill existing slugs deterministically
UPDATE tenant
SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Resolve any duplicate slugs that might exist
UPDATE tenant t1
SET slug = slug || '-' || SUBSTRING(id::text, 1, 6)
WHERE EXISTS (
  SELECT 1 FROM tenant t2 WHERE t2.id <> t1.id AND t2.slug = t1.slug
);

ALTER TABLE tenant ALTER COLUMN slug SET NOT NULL;
ALTER TABLE tenant ADD CONSTRAINT uq_tenant_slug UNIQUE (slug);
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

-- 3. Add check constraints for type and status on tenant and user_account
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_type CHECK (type IN ('ministry', 'agency', 'department', 'platform'));
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_status CHECK (status IN ('provisioning', 'active', 'suspended', 'archived'));
ALTER TABLE user_account ADD CONSTRAINT chk_user_status CHECK (status IN ('active', 'invited', 'suspended'));

-- 4. Create platform_role_assignment table (Option B)
CREATE TABLE platform_role_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  role_name VARCHAR(100) NOT NULL,
  assigned_by UUID REFERENCES user_account(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES user_account(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  assignment_status VARCHAR(50) NOT NULL DEFAULT 'pending_activation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role_name IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT_ADMIN', 'PLATFORM_AUDITOR')),
  CHECK (assignment_status IN ('pending_activation', 'active', 'revoked'))
);

CREATE UNIQUE INDEX uq_current_platform_role
ON platform_role_assignment (user_id, role_name)
WHERE assignment_status IN ('pending_activation', 'active');

CREATE INDEX idx_platform_role_user ON platform_role_assignment(user_id);

-- 5. Create user_invitation table
CREATE TABLE user_invitation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL,
  display_email TEXT NOT NULL,
  invitation_type VARCHAR(100) NOT NULL,
  role_id UUID REFERENCES role(id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  accepted_by UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked', 'superseded')),
  CHECK (invitation_type IN ('platform_admin_activation', 'tenant_admin_activation', 'tenant_user_activation')),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
    OR status <> 'accepted'
  )
);

CREATE UNIQUE INDEX uq_pending_invitation_email
ON user_invitation (tenant_id, email_normalized, invitation_type)
WHERE status = 'pending';

CREATE INDEX idx_user_invitation_token ON user_invitation(token_hash);

-- 6. Create idempotency_record table
CREATE TABLE idempotency_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(255) NOT NULL,
  operation_name VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  response_status INTEGER,
  response_payload JSONB,
  resource_type VARCHAR(100),
  resource_id UUID,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('processing', 'completed', 'failed')),
  UNIQUE (actor_user_id, operation_name, idempotency_key)
);

-- 7. Insert Reserved System Tenant with is_system = TRUE, type = 'platform'
INSERT INTO tenant (id, name, slug, type, status, is_system)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'GovOS Platform',
  'govos-platform',
  'platform',
  'active',
  TRUE
) ON CONFLICT (id) DO NOTHING;
