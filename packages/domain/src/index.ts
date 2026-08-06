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

// --- Milestone WF-2 Notification Platform Domain Entities ---

export interface NotificationTemplate {
  id: string;
  tenantId?: string;
  applicationKey?: string;
  semanticKey: string;
  name: string;
  description?: string;
  allowTenantOverride: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface NotificationTemplateVersion {
  id: string;
  tenantId?: string;
  templateId: string;
  versionNumber: number;
  status: "draft" | "validating" | "published" | "deprecated";
  variablesSchema?: Record<string, any>;
  fixtureHash?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface NotificationTemplateRendering {
  id: string;
  tenantId?: string;
  templateVersionId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  locale: string;
  subjectTemplate?: string;
  bodyTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateBinding {
  id: string;
  tenantId: string;
  organizationId?: string;
  semanticKey: string;
  tenantTemplateVersionId?: string;
  catalogTemplateVersionId?: string;
  status: "active" | "inactive";
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NotificationChannelPolicy {
  id: string;
  tenantId: string;
  organizationId?: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  allowOptOut: boolean;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationUserPreference {
  id: string;
  tenantId: string;
  userId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  isSubscribed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationQuietHours {
  id: string;
  tenantId: string;
  userId?: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSuppression {
  id: string;
  tenantId: string;
  destinationDigest: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  reason?: string;
  createdAt: string;
}

export interface NotificationRequest {
  id: string;
  tenantId: string;
  organizationId?: string;
  parentRequestId?: string;
  producerNamespace: string;
  idempotencyKey: string;
  variables: Record<string, any>;
  classification: "standard" | "legal" | "emergency";
  priority: number;
  state: "accepted" | "resolving" | "scheduled" | "processing" | "partially_delivered" | "delivered" | "suppressed" | "failed" | "dead_lettered" | "cancelled" | "expired";
  semanticKey: string;
  tenantTemplateVersionId?: string;
  catalogTemplateVersionId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NotificationRecipient {
  id: string;
  tenantId: string;
  requestId: string;
  recipientType: "direct_user" | "direct_destination" | "role" | "organization" | "workflow_work_item" | "escalation_target" | "tenant_administrator" | "supervisor" | "webhook_endpoint";
  resolvedUserId?: string;
  createdAt: string;
}

export interface NotificationDestination {
  id: string;
  tenantId: string;
  recipientId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  encryptedValue: string;
  destinationDigest: string;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  tenantId: string;
  requestId: string;
  destinationId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  state: "queued" | "scheduled" | "leased" | "sending" | "provider_accepted" | "delivered" | "transient_failed" | "rate_limited" | "permanent_failed" | "suppressed" | "dead_lettered" | "cancelled" | "expired";
  deduplicationIdentity?: string;
  scheduledAt: string;
  nextAttemptAt: string;
  retryCount: number;
  maxAttempts: number;
  leaseId?: string;
  leaseExpiresAt?: string;
  fencingToken: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NotificationDeliveryAttempt {
  id: string;
  tenantId: string;
  deliveryId: string;
  attemptNumber: number;
  providerKey: string;
  status: "success" | "transient_failure" | "permanent_failure" | "rate_limited" | "ambiguous";
  errorCode?: string;
  errorMessageRedacted?: string;
  providerMessageId?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface NotificationDeliveryStatusHistory {
  id: string;
  tenantId: string;
  requestId: string;
  deliveryId?: string;
  sequence: number;
  oldState?: string;
  newState: string;
  transitionReason?: string;
  createdAt: string;
}

export interface NotificationProvider {
  key: string;
  name: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  encryptedConfiguration: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationProviderRoute {
  id: string;
  tenantId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationProviderRouteEntry {
  id: string;
  routeId: string;
  providerKey: string;
  priority: number;
  createdAt: string;
}

export interface NotificationProviderCallbackEndpoint {
  id: string;
  tenantId: string;
  providerKey: string;
  opaqueEndpointId: string;
  adapterVersion: string;
  isActive: boolean;
  signatureAlgorithm: string;
  encryptedSigningSecret: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NotificationProviderCallback {
  id: string;
  tenantId: string;
  endpointId: string;
  providerMessageId: string;
  rawPayloadRedacted: string;
  processedAt: string;
}

export interface NotificationWebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  encryptedSecret: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationWebhookChallenge {
  id: string;
  tenantId: string;
  endpointId: string;
  challengeToken: string;
  state: "pending" | "verified" | "failed";
  createdAt: string;
}

export interface NotificationRateLimitBucket {
  id: string;
  tenantId: string;
  bucketKey: string;
  tokens: number;
  lastRefilledAt: string;
  createdAt: string;
}

export interface NotificationDeduplicationRecord {
  id: string;
  tenantId: string;
  deduplicationHash: string;
  requestId: string;
  createdAt: string;
}

export interface NotificationInboxItem {
  id: string;
  tenantId: string;
  userId: string;
  deliveryId: string;
  subject: string;
  bodyPreview: string;
  renderedBody: string;
  status: "unread" | "read" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface NotificationAuditEvent {
  id: string;
  tenantId: string;
  actorId?: string;
  action: string;
  resource: string;
  context: Record<string, any>;
  createdAt: string;
}

