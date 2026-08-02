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

// --- Milestone PA-4 Subcontractor Marketplace Domain Entities ---

export type SubcontractorApplicationStatus =
  | "draft"
  | "submitted"
  | "screening_queued"
  | "screening_in_progress"
  | "screening_failed"
  | "awaiting_officer_review"
  | "more_information_required"
  | "approved"
  | "rejected"
  | "invoice_pending"
  | "payment_pending"
  | "payment_confirmed"
  | "licence_issued"
  | "withdrawn"
  | "expired";

export interface SubcontractorApplication {
  id: string;
  tenantId: string;
  businessName: string;
  registrationNumber: string;
  taxIdentifier: string;
  contactEmail: string;
  contactPhone: string;
  operatingAddress: string;
  experienceYears: number;
  licenseType: string;
  accessTokenHash: string;
  status: SubcontractorApplicationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorApplicationDocument {
  id: string;
  tenantId: string;
  applicationId: string;
  documentType: string;
  storageKey: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: "pending" | "passed" | "failed";
  verificationStatus: "pending" | "verified" | "rejected";
  uploadedAt: string;
  supersededAt?: string;
}

export interface SubcontractorApplicationEvent {
  id: string;
  tenantId: string;
  applicationId: string;
  actorType: "user" | "system" | "ai" | "payment_provider";
  actorId?: string;
  previousState?: SubcontractorApplicationStatus;
  newState: SubcontractorApplicationStatus;
  reason?: string;
  correlationId: string;
  createdAt: string;
}

export interface SubcontractorScreeningResult {
  id: string;
  tenantId: string;
  applicationId: string;
  aiExecutionId: string;
  screeningPolicyVersion: string;
  outputContractVersionId?: string;
  inputSnapshotHash: string;
  screeningStatus: "completed" | "failed";
  applicationVersion: number;
  recommendation?: "recommended" | "needs_review" | "high_risk";
  score?: number;
  criteria?: Record<string, any>;
  riskFlags?: string[];
  modelVersion?: string;
  screenedAt: string;
}

export interface SubcontractorProfile {
  id: string;
  tenantId: string;
  applicationId?: string;
  businessName: string;
  status: "active" | "under_review" | "restricted" | "suspended" | "revoked" | "archived";
  performanceScore: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorLicence {
  id: string;
  tenantId: string;
  subcontractorId: string;
  invoiceId: string;
  licenceNumber: string;
  verificationCode: string;
  licenceType: string;
  status: "pending" | "active" | "expired" | "suspended" | "revoked" | "cancelled";
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  revokedAt?: string;
  revocationReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  workerIssueDuration?: number;
}

export interface SubcontractorAssignment {
  id: string;
  tenantId: string;
  subcontractorId: string;
  assignmentType: "lga" | "cluster";
  lgaId?: string;
  clusterId?: string;
  status: "active" | "terminated";
  startsAt: string;
  endsAt?: string;
  assignedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorQualityAudit {
  id: string;
  tenantId: string;
  subcontractorId: string;
  auditorType: "officer" | "ai" | "system";
  auditorId?: string;
  aiExecutionId?: string;
  auditType: string;
  associatedResourceType?: string;
  associatedResourceId?: string;
  score: number;
  status: "draft" | "completed" | "disputed" | "confirmed" | "overturned";
  createdAt: string;
}

export interface SubcontractorQualityFinding {
  id: string;
  tenantId: string;
  auditId: string;
  findingCode: string;
  severity: "low" | "medium" | "high" | "critical";
  evidenceReferences: Record<string, any>;
  description: string;
  createdAt: string;
}

export interface SubcontractorEnforcementAction {
  id: string;
  tenantId: string;
  subcontractorId: string;
  actionType: "warning" | "restriction" | "suspension" | "revocation";
  reason: string;
  initiatedBy: string;
  status: "proposed" | "active" | "stayed" | "overturned" | "resolved" | "expired";
  createdAt: string;
}

export interface SubcontractorAppeal {
  id: string;
  tenantId: string;
  enforcementActionId: string;
  subcontractorJustification: string;
  status: "pending" | "approved" | "rejected";
  officerDecision?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface MarketplaceInvoice {
  id: string;
  tenantId: string;
  applicationId: string;
  invoiceNumber: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountDueMicrounits: string;
  currency: string;
  status: "unpaid" | "pending" | "paid" | "void" | "expired" | "refunded" | "partially_refunded";
  version: number;
  createdAt: string;
}

export interface MarketplacePayment {
  id: string;
  tenantId: string;
  invoiceId: string;
  provider: string;
  providerCheckoutReference: string;
  providerTransactionReference?: string;
  amountPaidMicrounits: string;
  currency: string;
  status: "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refunded" | "partially_refunded" | "reversed";
  createdAt: string;
  updatedAt: string;
}

export interface MarketplacePaymentEvent {
  id: string;
  tenantId?: string;
  webhookEventId: string;
  provider: string;
  payloadHash: string;
  eventType: string;
  providerCreatedAt?: string;
  signatureVerifiedAt: string;
  processingStatus: "received" | "verified" | "processing" | "processed" | "failed" | "ignored";
  processingAttempts: number;
  processedAt?: string;
  lastErrorCode?: string;
  lastErrorMessageRedacted?: string;
  sanitizedPayload: Record<string, any>;
  receivedAt: string;
}

export interface MarketplaceRevenueLedger {
  id: string;
  tenantId: string;
  invoiceId: string;
  paymentId: string;
  entryReference: string;
  amountMicrounits: string;
  currency: string;
  entryType: "credit" | "debit" | "refund" | "chargeback" | "adjustment";
  occurredAt: string;
  createdAt: string;
}

