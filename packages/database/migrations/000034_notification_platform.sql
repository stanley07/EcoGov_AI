-- Milestone: WF-2 Notification Platform Schema Migration
-- Version: 000034
-- Name: notification_platform

-- 1. Template Governance Tables
CREATE TABLE IF NOT EXISTS notification_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE RESTRICT,
  application_key VARCHAR(255),
  semantic_key VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  allow_tenant_override BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_template_catalog_scope CHECK (
    (tenant_id IS NOT NULL AND application_key IS NULL) OR
    (tenant_id IS NULL)
  ),
  CONSTRAINT uq_notification_template_tenant_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_template_catalog
ON notification_template (semantic_key)
WHERE tenant_id IS NULL AND application_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_template_app_catalog
ON notification_template (application_key, semantic_key)
WHERE tenant_id IS NULL AND application_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_template_tenant
ON notification_template (tenant_id, semantic_key)
WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_template_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE RESTRICT,
  template_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'validating', 'published', 'deprecated')) DEFAULT 'draft',
  variables_schema JSONB,
  fixture_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  published_at TIMESTAMPTZ,
  published_by UUID,
  CONSTRAINT fk_template_version_template_tenant FOREIGN KEY (tenant_id, template_id) REFERENCES notification_template(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_template_version_number UNIQUE (template_id, version_number),
  CONSTRAINT uq_template_version_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_template_rendering (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE RESTRICT,
  template_version_id UUID NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  subject_template TEXT,
  body_template TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_rendering_version_tenant FOREIGN KEY (tenant_id, template_version_id) REFERENCES notification_template_version(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_template_rendering_channel_locale UNIQUE (template_version_id, channel, locale),
  CONSTRAINT uq_template_rendering_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_template_binding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  organization_id UUID,
  semantic_key VARCHAR(255) NOT NULL,
  application_key VARCHAR(255),
  tenant_template_version_id UUID,
  catalog_template_version_id UUID REFERENCES notification_template_version(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_binding_reference_path CHECK (
    (tenant_template_version_id IS NULL AND catalog_template_version_id IS NOT NULL) OR
    (tenant_template_version_id IS NOT NULL AND catalog_template_version_id IS NULL)
  ),
  CONSTRAINT fk_binding_tenant_version FOREIGN KEY (tenant_id, tenant_template_version_id) REFERENCES notification_template_version(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_binding_tenant_organization FOREIGN KEY (tenant_id, organization_id) REFERENCES organization(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_binding_org
ON notification_template_binding (tenant_id, organization_id, semantic_key)
WHERE organization_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_binding_tenant_default
ON notification_template_binding (tenant_id, semantic_key)
WHERE organization_id IS NULL AND status = 'active';

-- 2. Policies and Preferences Tables
CREATE TABLE IF NOT EXISTS notification_channel_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  organization_id UUID,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  allow_opt_out BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_channel_policy_tenant_org FOREIGN KEY (tenant_id, organization_id) REFERENCES organization(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_policy_org
ON notification_channel_policy(tenant_id, organization_id, channel)
WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_policy_tenant
ON notification_channel_policy(tenant_id, channel)
WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS notification_user_preference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  is_subscribed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_pref_tenant_user FOREIGN KEY (tenant_id, user_id) REFERENCES user_account(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_user_preference UNIQUE (tenant_id, user_id, channel)
);

CREATE TABLE IF NOT EXISTS notification_quiet_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  start_hour INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 59),
  end_hour INTEGER NOT NULL CHECK (end_hour BETWEEN 0 AND 23),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 59),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_quiet_hours_tenant_user FOREIGN KEY (tenant_id, user_id) REFERENCES user_account(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quiet_hours_user
ON notification_quiet_hours(tenant_id, user_id)
WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quiet_hours_tenant
ON notification_quiet_hours(tenant_id)
WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS notification_suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  destination_digest CHAR(64) NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_suppression UNIQUE (tenant_id, destination_digest, channel)
);

-- 3. Request and Delivery Ledger Tables
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_execution_tenant_id ON task_execution(tenant_id, id);

CREATE TABLE IF NOT EXISTS notification_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  organization_id UUID,
  parent_request_id UUID,
  producer_namespace VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  variables JSONB NOT NULL,
  classification VARCHAR(50) NOT NULL CHECK (classification IN ('standard', 'legal', 'emergency')) DEFAULT 'standard',
  priority INTEGER NOT NULL DEFAULT 0,
  state VARCHAR(50) NOT NULL CHECK (state IN ('accepted', 'resolving', 'scheduled', 'processing', 'partially_delivered', 'delivered', 'suppressed', 'failed', 'dead_lettered', 'cancelled', 'expired')) DEFAULT 'accepted',
  semantic_key VARCHAR(255) NOT NULL,
  application_key VARCHAR(255),
  tenant_template_version_id UUID,
  catalog_template_version_id UUID REFERENCES notification_template_version(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_request_reference_path CHECK (
    (tenant_template_version_id IS NULL AND catalog_template_version_id IS NOT NULL) OR
    (tenant_template_version_id IS NOT NULL AND catalog_template_version_id IS NULL)
  ),
  CONSTRAINT fk_request_tenant_version FOREIGN KEY (tenant_id, tenant_template_version_id) REFERENCES notification_template_version(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_request_tenant_organization FOREIGN KEY (tenant_id, organization_id) REFERENCES organization(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_request_tenant_parent FOREIGN KEY (tenant_id, parent_request_id) REFERENCES notification_request(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_notification_request_tenant UNIQUE (tenant_id, id),
  CONSTRAINT uq_notification_request_idempotency UNIQUE (tenant_id, producer_namespace, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notification_recipient (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  recipient_type VARCHAR(50) NOT NULL CHECK (recipient_type IN ('direct_user', 'direct_destination', 'role', 'organization', 'workflow_work_item', 'escalation_target')),
  resolved_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_recipient_tenant_request FOREIGN KEY (tenant_id, request_id) REFERENCES notification_request(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_recipient_tenant_user FOREIGN KEY (tenant_id, resolved_user_id) REFERENCES user_account(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_notification_recipient_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_destination (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  encrypted_value TEXT NOT NULL,
  destination_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_destination_tenant_recipient FOREIGN KEY (tenant_id, recipient_id) REFERENCES notification_recipient(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_notification_destination_tenant UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  destination_id UUID NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  state VARCHAR(50) NOT NULL CHECK (state IN ('queued', 'scheduled', 'leased', 'sending', 'provider_accepted', 'delivered', 'transient_failed', 'rate_limited', 'permanent_failed', 'suppressed', 'dead_lettered', 'cancelled', 'expired')) DEFAULT 'queued',
  deduplication_identity VARCHAR(255),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 0,
  task_execution_id UUID,
  provider_message_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT fk_delivery_tenant_request FOREIGN KEY (tenant_id, request_id) REFERENCES notification_request(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_tenant_destination FOREIGN KEY (tenant_id, destination_id) REFERENCES notification_destination(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_tenant_task FOREIGN KEY (tenant_id, task_execution_id) REFERENCES task_execution(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_notification_delivery_tenant UNIQUE (tenant_id, id),
  CONSTRAINT uq_notification_delivery_dedupe UNIQUE (tenant_id, deduplication_identity)
);

CREATE TABLE IF NOT EXISTS notification_delivery_attempt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  delivery_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  provider_key VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'transient_failure', 'permanent_failure', 'rate_limited', 'ambiguous')),
  error_code VARCHAR(100),
  error_message_redacted TEXT,
  provider_message_id VARCHAR(255),
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fencing_token BIGINT NOT NULL DEFAULT 0,
  route_position INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT fk_attempt_tenant_delivery FOREIGN KEY (tenant_id, delivery_id) REFERENCES notification_delivery(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_attempt_sequence UNIQUE (tenant_id, delivery_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS notification_delivery_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  delivery_id UUID,
  sequence INTEGER NOT NULL,
  old_state VARCHAR(50),
  new_state VARCHAR(50) NOT NULL,
  transition_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_history_tenant_request FOREIGN KEY (tenant_id, request_id) REFERENCES notification_request(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_history_tenant_delivery FOREIGN KEY (tenant_id, delivery_id) REFERENCES notification_delivery(tenant_id, id) ON DELETE RESTRICT,
  provider_callback_id UUID,
  CONSTRAINT uq_delivery_status_history_seq UNIQUE (tenant_id, request_id, sequence)
);

-- 4. Providers and Routing Tables
CREATE TABLE IF NOT EXISTS notification_provider (
  key VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  configuration_secret_reference TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_provider_route (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'in-app', 'webhook')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_provider_route_tenant_channel UNIQUE (tenant_id, channel),
  CONSTRAINT uq_provider_route_tenant_id UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_provider_route_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  route_id UUID NOT NULL,
  provider_key VARCHAR(100) NOT NULL REFERENCES notification_provider(key) ON DELETE RESTRICT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_route_entry_tenant_route FOREIGN KEY (tenant_id, route_id) REFERENCES notification_provider_route(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_provider_route_entry UNIQUE (tenant_id, route_id, provider_key)
);

CREATE TABLE IF NOT EXISTS notification_provider_callback_endpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  provider_key VARCHAR(100) NOT NULL REFERENCES notification_provider(key) ON DELETE RESTRICT,
  opaque_endpoint_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  adapter_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  signature_algorithm VARCHAR(50) NOT NULL DEFAULT 'HMAC-SHA256',
  verification_key_reference TEXT NOT NULL,
  previous_key_reference TEXT,
  previous_key_expires_at TIMESTAMPTZ,
  replay_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (replay_window_seconds BETWEEN 30 AND 900),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_provider_callback_endpoint_tenant UNIQUE (tenant_id, provider_key),
  CONSTRAINT uq_provider_callback_endpoint_tenant_id UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_provider_callback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  endpoint_id UUID NOT NULL,
  provider_message_id VARCHAR(255) NOT NULL,
  raw_payload_redacted TEXT NOT NULL,
  callback_nonce VARCHAR(255) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_callback_tenant_endpoint FOREIGN KEY (tenant_id, endpoint_id) REFERENCES notification_provider_callback_endpoint(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_provider_callback_dedupe UNIQUE (tenant_id, endpoint_id, callback_nonce)
);

-- 5. Webhooks Tables
CREATE TABLE IF NOT EXISTS notification_webhook_endpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  url TEXT NOT NULL,
  signing_key_reference TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_endpoint_tenant_url UNIQUE (tenant_id, url),
  CONSTRAINT uq_webhook_endpoint_tenant_id UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS notification_webhook_challenge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  endpoint_id UUID NOT NULL,
  challenge_digest CHAR(64) NOT NULL,
  state VARCHAR(50) NOT NULL CHECK (state IN ('pending', 'verified', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_webhook_challenge_tenant_endpoint FOREIGN KEY (tenant_id, endpoint_id) REFERENCES notification_webhook_endpoint(tenant_id, id) ON DELETE RESTRICT
);

-- 6. Operations Tables
CREATE TABLE IF NOT EXISTS notification_rate_limit_bucket (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  bucket_key VARCHAR(255) NOT NULL,
  tokens DOUBLE PRECISION NOT NULL,
  last_refilled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_bucket_search ON notification_rate_limit_bucket(tenant_id, bucket_key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_cleanup ON notification_rate_limit_bucket(created_at);

CREATE TABLE IF NOT EXISTS notification_deduplication_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  deduplication_hash CHAR(64) NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_dedupe_tenant_request FOREIGN KEY (tenant_id, request_id) REFERENCES notification_request(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_notification_deduplication_record UNIQUE (tenant_id, deduplication_hash)
);

CREATE TABLE IF NOT EXISTS notification_inbox_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body_preview VARCHAR(500) NOT NULL,
  rendered_body TEXT NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('unread', 'read', 'archived')) DEFAULT 'unread',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_inbox_tenant_user FOREIGN KEY (tenant_id, user_id) REFERENCES user_account(tenant_id, id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT fk_inbox_tenant_delivery FOREIGN KEY (tenant_id, delivery_id) REFERENCES notification_delivery(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_inbox_tenant_delivery UNIQUE (tenant_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS notification_audit_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  actor_id UUID,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Immutability Triggers
CREATE OR REPLACE FUNCTION protect_immutable_template_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.status = 'published' OR OLD.status = 'deprecated') THEN
    IF (TG_OP = 'DELETE') THEN
      RAISE EXCEPTION 'Published or deprecated template versions are immutable and cannot be deleted.';
    ELSIF (TG_OP = 'UPDATE') THEN
      IF (OLD.status = 'published' AND NEW.status = 'deprecated' AND
          (to_jsonb(NEW) - ARRAY['status','updated_at']::text[]) =
          (to_jsonb(OLD) - ARRAY['status','updated_at']::text[])) THEN
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Published or deprecated template versions are immutable. Only status transition from published to deprecated is allowed.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_template_version ON notification_template_version;
CREATE TRIGGER trg_protect_template_version
BEFORE UPDATE OR DELETE ON notification_template_version
FOR EACH ROW EXECUTE FUNCTION protect_immutable_template_version();

CREATE OR REPLACE FUNCTION protect_immutable_template_rendering()
RETURNS TRIGGER AS $$
DECLARE
  parent_status VARCHAR(50);
BEGIN
  SELECT status INTO parent_status FROM notification_template_version WHERE id = COALESCE(NEW.template_version_id, OLD.template_version_id);
  IF (parent_status = 'published' OR parent_status = 'deprecated') THEN
    RAISE EXCEPTION 'Renderings associated with published or deprecated template versions are immutable and cannot be modified or deleted.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_template_rendering ON notification_template_rendering;
CREATE TRIGGER trg_protect_template_rendering
BEFORE INSERT OR UPDATE OR DELETE ON notification_template_rendering
FOR EACH ROW EXECUTE FUNCTION protect_immutable_template_rendering();

CREATE OR REPLACE FUNCTION validate_notification_template_reference()
RETURNS TRIGGER AS $$
DECLARE
  selected_version notification_template_version%ROWTYPE;
  selected_template notification_template%ROWTYPE;
BEGIN
  IF NEW.catalog_template_version_id IS NOT NULL THEN
    SELECT * INTO selected_version FROM notification_template_version
      WHERE id=NEW.catalog_template_version_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WF_TEMPLATE_VERSION_INVALID'; END IF;
    SELECT * INTO selected_template FROM notification_template
      WHERE id=selected_version.template_id FOR KEY SHARE;
    IF selected_version.tenant_id IS NOT NULL OR selected_template.tenant_id IS NOT NULL OR
       selected_version.status <> 'published' OR
       selected_template.semantic_key <> NEW.semantic_key OR
       selected_template.application_key IS DISTINCT FROM NEW.application_key THEN
      RAISE EXCEPTION 'WF_TEMPLATE_VERSION_INVALID';
    END IF;
  ELSE
    SELECT * INTO selected_version FROM notification_template_version
      WHERE tenant_id=NEW.tenant_id AND id=NEW.tenant_template_version_id FOR KEY SHARE;
    IF NOT FOUND OR selected_version.status <> 'published' THEN
      RAISE EXCEPTION 'WF_TEMPLATE_VERSION_INVALID';
    END IF;
    SELECT * INTO selected_template FROM notification_template
      WHERE tenant_id=NEW.tenant_id AND id=selected_version.template_id FOR KEY SHARE;
    IF NOT FOUND OR selected_template.semantic_key <> NEW.semantic_key THEN
      RAISE EXCEPTION 'WF_TEMPLATE_VERSION_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_template_binding_reference ON notification_template_binding;
CREATE CONSTRAINT TRIGGER trg_validate_template_binding_reference
AFTER INSERT OR UPDATE OF tenant_template_version_id,catalog_template_version_id,semantic_key,application_key
ON notification_template_binding DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION validate_notification_template_reference();

DROP TRIGGER IF EXISTS trg_validate_request_template_reference ON notification_request;
CREATE CONSTRAINT TRIGGER trg_validate_request_template_reference
AFTER INSERT OR UPDATE OF tenant_template_version_id,catalog_template_version_id,semantic_key,application_key
ON notification_request DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION validate_notification_template_reference();

CREATE OR REPLACE FUNCTION block_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table entries are append-only. Modification or deletion is prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_delivery_status_history ON notification_delivery_status_history;
CREATE TRIGGER trg_protect_delivery_status_history
BEFORE UPDATE OR DELETE ON notification_delivery_status_history
FOR EACH ROW EXECUTE FUNCTION block_update_delete();

DROP TRIGGER IF EXISTS trg_protect_notification_audit_event ON notification_audit_event;
CREATE TRIGGER trg_protect_notification_audit_event
BEFORE UPDATE OR DELETE ON notification_audit_event
FOR EACH ROW EXECUTE FUNCTION block_update_delete();

-- 8. Indexes for Keyset Pagination and Performance
CREATE INDEX IF NOT EXISTS idx_delivery_pagination ON notification_delivery (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_request_pagination ON notification_request (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_pagination ON notification_inbox_item (tenant_id, user_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_due_jobs ON notification_delivery (tenant_id, state, next_attempt_at, id) WHERE state IN ('queued', 'scheduled', 'transient_failed', 'rate_limited');
CREATE INDEX IF NOT EXISTS idx_binding_resolution ON notification_template_binding (tenant_id, semantic_key, organization_id, effective_from, effective_to) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_callback_message ON notification_delivery (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- 9. Seeding Permissions and Role Mappings
INSERT INTO permission (tenant_id, name, description)
VALUES
('00000000-0000-0000-0000-000000000001', 'notification:template:read', 'Permission to read templates'),
('00000000-0000-0000-0000-000000000001', 'notification:template:create', 'Permission to create templates'),
('00000000-0000-0000-0000-000000000001', 'notification:template:update', 'Permission to update templates'),
('00000000-0000-0000-0000-000000000001', 'notification:template:validate', 'Permission to validate templates'),
('00000000-0000-0000-0000-000000000001', 'notification:template:publish', 'Permission to publish templates'),
('00000000-0000-0000-0000-000000000001', 'notification:template:deprecate', 'Permission to deprecate templates'),
('00000000-0000-0000-0000-000000000001', 'notification:policy:read', 'Permission to read notification policy'),
('00000000-0000-0000-0000-000000000001', 'notification:policy:write', 'Permission to write notification policy'),
('00000000-0000-0000-0000-000000000001', 'notification:provider:read', 'Permission to read notification providers'),
('00000000-0000-0000-0000-000000000001', 'notification:provider:manage', 'Permission to manage notification providers'),
('00000000-0000-0000-0000-000000000001', 'notification:webhook:read', 'Permission to read webhooks'),
('00000000-0000-0000-0000-000000000001', 'notification:webhook:write', 'Permission to write webhooks'),
('00000000-0000-0000-0000-000000000001', 'notification:webhook:rotate-secret', 'Permission to rotate webhook secrets'),
('00000000-0000-0000-0000-000000000001', 'notification:request:create', 'Permission to create requests'),
('00000000-0000-0000-0000-000000000001', 'notification:request:create:direct', 'Permission to create requests for direct destinations'),
('00000000-0000-0000-0000-000000000001', 'notification:request:create:emergency', 'Permission to create emergency requests'),
('00000000-0000-0000-0000-000000000001', 'notification:request:read', 'Permission to read requests'),
('00000000-0000-0000-0000-000000000001', 'notification:request:cancel', 'Permission to cancel requests'),
('00000000-0000-0000-0000-000000000001', 'notification:recipient:direct', 'Permission to send to direct destination'),
('00000000-0000-0000-0000-000000000001', 'notification:emergency:send', 'Permission to bypass quiet hours'),
('00000000-0000-0000-0000-000000000001', 'notification:inbox:read', 'Permission to read inbox'),
('00000000-0000-0000-0000-000000000001', 'notification:inbox:manage', 'Permission to manage inbox'),
('00000000-0000-0000-0000-000000000001', 'notification:audit:read', 'Permission to read audit logs'),
('00000000-0000-0000-0000-000000000001', 'notification:operations:read', 'Permission to read delivery logs'),
('00000000-0000-0000-0000-000000000001', 'notification:operations:replay', 'Permission to replay notifications')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Role grants are intentionally resolved from the approved tenant role manifest.
-- Migration 34 seeds vocabulary only and never assumes deployment-specific role IDs.
