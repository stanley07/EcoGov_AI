CREATE TABLE subcontractor_application_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  application_id UUID NOT NULL,
  application_version INTEGER NOT NULL,
  input_schema_version VARCHAR(50) NOT NULL,
  canonical_payload JSONB NOT NULL,
  input_snapshot_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_snapshot_app FOREIGN KEY (tenant_id, application_id) REFERENCES subcontractor_application(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_snapshot_version UNIQUE (tenant_id, application_id, application_version)
);
