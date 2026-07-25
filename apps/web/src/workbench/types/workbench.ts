export type ComplaintStatus =
  | "triage_pending"
  | "officer_review"
  | "assigned"
  | "rejected"
  | "merged"
  | "withdrawn"
  | "closed";

export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "action_required"
  | "approved"
  | "rejected";

export type WorkbenchQueueItem =
  | {
      kind: "complaint";
      complaintId: string;
      referenceNumber: string;
      status: ComplaintStatus;
      priority: "routine" | "standard" | "urgent" | "critical";
      isEmergency: boolean;
      submittedAt: string;
      version: number;
    }
  | {
      kind: "facility_registration";
      facilityId: string;
      registrationId: string;
      referenceNumber: string;
      status: RegistrationStatus;
      preliminaryRiskRating: "low" | "medium" | "high" | "unknown";
      submittedAt: string;
      version: number;
    };

export interface TimelineEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  title: string;
  actorType: "citizen" | "business" | "system" | "ai" | "officer";
  status: "completed" | "active" | "failed" | "blocked" | "pending" | "processing";
  summary: string;
  metadata?: Record<string, any>;
}

export interface WorkbenchMetrics {
  pendingReviews: number;
  emergencyReviews: number;
  assignedToday: number;
  completedToday: number;
  averageReviewDurationSeconds: number;
  aiRecommendationsPending: number;
}
