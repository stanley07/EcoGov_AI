export interface SystemStatus {
  serviceName: string;
  buildVersion: string;
  commitSha: string;
  environment: string;
}

export interface HealthCheckResult {
  status: "ok" | "error";
  timestamp: string;
}

export interface ReadinessCheckResult {
  status: "ready" | "not_ready";
  postgres: "connected" | "disconnected";
  migrations: "current" | "pending" | "unknown";
  timestamp: string;
}

export interface TaskEnvelope<TPayload> {
  taskId: string;
  taskType: string;
  schemaVersion: number;
  tenantId?: string;
  correlationId: string;
  causationId?: string;
  createdAt: string;
  payload: TPayload;
}

// --- Milestone 2 Domain Entities ---

export interface Tenant {
  id: string;
  name: string;
  type: "ministry" | "agency" | "local_gov" | "commercial";
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Department {
  id: string;
  tenantId: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface UserAccount {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  organizationId?: string;
  departmentId?: string;
  roleId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Facility {
  id: string;
  tenantId: string;
  organizationId: string;
  ownerUserId?: string;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  registrationStatus:
    | "draft"
    | "submitted"
    | "in_review"
    | "action_required"
    | "approved"
    | "rejected";
  riskRating: "unknown" | "low" | "medium" | "high";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface FacilityDocument {
  id: string;
  tenantId: string;
  facilityId: string;
  documentName: string;
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
  createdBy: string;
  createdAt: string;
  deletedAt?: string;
}

export interface Workflow {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  currentStepName: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  tenantId: string;
  workflowId: string;
  stepName: string;
  status:
    "pending" | "in_progress" | "completed" | "failed" | "action_required";
  actorType: "system" | "ai" | "user";
  actorId?: string;
  notes?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationReview {
  id: string;
  tenantId: string;
  facilityId: string;
  reviewerUserId?: string;
  reviewNotes?: string;
  decision: "approve" | "reject" | "request_correction";
  createdAt: string;
}

export interface AIExecution {
  id: string;
  tenantId: string;
  workflowId: string;
  agentName: string;
  objective: string;
  prompt: string;
  responsePayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs: number;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  oldState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId: string;
  createdAt: string;
}
