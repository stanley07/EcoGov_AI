-- Milestone 2 Database Schema Migration
-- Version: 000002
-- Name: milestone2_schema

-- 1. Tenant Entity (highest level partition)
CREATE TABLE tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'ministry', 'agency', 'local_gov', 'commercial'
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_tenant_status ON tenant(status) WHERE deleted_at IS NULL;

-- 2. Organization Entity
CREATE TABLE organization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_organization_tenant ON organization(tenant_id);
CREATE INDEX idx_organization_status ON organization(status) WHERE deleted_at IS NULL;

-- 3. Department Entity
CREATE TABLE department (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_department_organization ON department(organization_id);

-- 4. User Account Entity (tenant-isolated username/email)
CREATE TABLE user_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_user_email ON user_account(tenant_id, email);

-- 5. Session Entity
CREATE TABLE session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_token ON session(token);

-- 6. Role Entity
CREATE TABLE role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_role_name ON role(tenant_id, name);

-- 7. Permission Entity
CREATE TABLE permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_permission_name ON permission(tenant_id, name);

-- 8. Role-Permission Cross table
CREATE TABLE role_permission (
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 9. Membership Entity (links User, Org, Dept, and Role)
CREATE TABLE membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
  department_id UUID REFERENCES department(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, organization_id, role_id)
);

CREATE INDEX idx_membership_user ON membership(user_id);
CREATE INDEX idx_membership_org ON membership(organization_id);

-- 10. Facility Entity (the central registry)
CREATE TABLE facility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  owner_user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  business_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(9, 6) NOT NULL,
  longitude DECIMAL(9, 6) NOT NULL,
  registration_status VARCHAR(50) NOT NULL DEFAULT 'draft',
  risk_rating VARCHAR(50) NOT NULL DEFAULT 'unknown',
  created_by UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_facility_tenant_category ON facility(tenant_id, category);
CREATE INDEX idx_facility_registration_status ON facility(tenant_id, registration_status);
CREATE INDEX idx_facility_owner ON facility(owner_user_id);

-- 11. Facility Document Entity
CREATE TABLE facility_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  document_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  created_by UUID NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_document_facility ON facility_document(facility_id);

-- 12. Workflow State Entity
CREATE TABLE workflow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  current_step_name VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_entity ON workflow(entity_type, entity_id);

-- 13. Workflow Steps tracking table
CREATE TABLE workflow_step (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  step_name VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  actor_type VARCHAR(50) NOT NULL, -- 'system', 'ai', 'user'
  actor_id UUID,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_step_parent ON workflow_step(workflow_id);

-- 14. Registration Review Decisions Entity
CREATE TABLE registration_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  reviewer_user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT,
  review_notes TEXT,
  decision VARCHAR(50) NOT NULL, -- 'approve', 'reject', 'request_correction'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_facility ON registration_review(facility_id);

-- 15. AI Execution Audit Entity
CREATE TABLE ai_execution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  agent_name VARCHAR(100) NOT NULL,
  objective TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_cost DECIMAL(10, 6) NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_execution_workflow ON ai_execution(workflow_id);

-- 16. Security Auditing Trail Entity
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_account(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  old_state JSONB,
  new_state JSONB,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  correlation_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_correlation ON audit_log(correlation_id);

-- 17. Seed Default System Data (Lagos State Environmental Protection Agency instance)
INSERT INTO tenant (id, name, type, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Lagos Environmental Protection Agency (LASEPA)', 'ministry', 'active');

INSERT INTO organization (id, tenant_id, name, status)
VALUES 
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'LASEPA HQ', 'active'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'Lagos Car Wash Association', 'active');

INSERT INTO department (id, tenant_id, organization_id, name)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Environmental Compliance Dept');

-- Seed System Roles
INSERT INTO role (id, tenant_id, name, description, is_system)
VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', 'super_admin', 'Full system management access', TRUE),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', 'organization_admin', 'Manage organization users and settings', TRUE),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000001', 'director', 'Reviews inspector audits and escalations', TRUE),
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000001', 'inspector', 'Performs compliance audits and reviews', TRUE),
  ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000001', 'facility_owner', 'Registers and manages compliance files', TRUE),
  ('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000001', 'citizen', 'Public reporting and metrics access', TRUE);

-- Seed System Users (Default password is 'password123')
INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
VALUES
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'admin@govos.ai', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'System', 'Administrator', 'active'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000001', 'director@govos.ai', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'Femi', 'Ogunleye', 'active'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000001', 'inspector@govos.ai', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'Chidi', 'Okeke', 'active'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000001', 'owner@carwash.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'Babatunde', 'Alabi', 'active');

-- Seed Memberships
INSERT INTO membership (id, tenant_id, user_id, organization_id, department_id, role_id)
VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000010', NULL, '00000000-0000-0000-0000-000000000501'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000503'),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000504'),
  ('00000000-0000-0000-0000-000000002004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000020', NULL, '00000000-0000-0000-0000-000000000505');

