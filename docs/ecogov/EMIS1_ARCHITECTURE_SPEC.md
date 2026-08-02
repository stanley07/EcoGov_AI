# EcoGov AI v2 EMIS-1 Architecture Specification

This specification outlines the technical design for routing, vocabulary, API contracts, and compatibility layers for the EMIS-1 implementation.

---

## 1. Routing Strategy & Access Boundaries

To guarantee link stability and support deep links (e.g. sharing facility profiles) without requiring complex web-server history fallbacks, a robust **Hash Router** (`HashRouter`) will be implemented.

Routes are grouped into three distinct security and visibility boundaries:

### A. Public Routes (Unauthenticated)
These paths represent public citizen engagement and subcontractor onboarding actions. They run outside the main authenticated shell:
* `#/subcontractor-apply` -> Subcontractor registration wizard.
* `#/subcontractor-status` -> Subcontractor onboarding status check.
* `#/verify-licence` -> Public licence checker tool (planned).
* `#/report-incident` -> Public citizen incident/complaint submission form (planned).

### B. Authenticated EcoGov Portal (RBAC Guarded)
These paths represent the core internal EMIS workspace. Access requires authentication and specific permission grants:
* `#/dashboard` -> EMIS Executive Dashboard (requires `ecogov.dashboard.read`).
* `#/facilities` -> Environmental Facility Registry (requires `facility:read`).
* `#/facilities/:facilityId` -> Environmental Facility Profile (requires `facility:read`).

### C. Platform Administration Console (Super Admin Guarded)
These paths represent the platform control center:
* `#/platform/*` -> Platform usage, agent registries, health status, and system audit logs.

### Redirect Guard Logic
An authentication route guard intercepts navigation to any authenticated route. If the user is unauthenticated:
1. It redirects to the landing login page.
2. It appends the target hash path as a redirect parameter: `?redirect=#/facilities/123-uuid`.
3. Upon successful login, the application parses the parameter and restores the target hash path, ensuring deep link preservation.

---

## 2. Reusable GovOS Core Timeline Service

The timeline projection engine resides inside GovOS Core (`packages/platform-timeline`) as a reusable service that can be consumed by other vertical applications (e.g. Property Tax, Licensing, healthcare, education). Every domain object automatically uses this timeline for its "History" view.

### Interface Definition
```typescript
interface OperationalTimelineService {
  append(event: TimelineEventInput): Promise<void>;
  project(outboxEventId: string): Promise<void>;
  rebuild(options: RebuildOptions): Promise<void>;
  query(filter: TimelineQueryFilter): Promise<TimelineCursorResult>;
  summarize(event: TimelineEventRecord): string;
  watch(filter: TimelineQueryFilter, callback: (event: TimelineEventRecord) => void): () => void;
}
```

---

## 3. Timeline Event Registry & Immutability

Timeline events function as API contracts. Once published, event schemas and names are **immutable** and must never be renamed.

```typescript
export const TimelineEvents = {
  // Facility & Registration Lifecycle
  FacilityRegistrationStarted: "facility.registration_started",
  FacilityRegistrationSubmitted: "facility.registration_submitted",
  FacilityCreated: "facility.created",
  FacilityAiReviewed: "facility.ai_reviewed",
  FacilityOfficerAssigned: "facility.officer_assigned",
  FacilityApproved: "facility.approved",

  // Inspection Lifecycle (Future)
  InspectionScheduled: "inspection.scheduled",
  InspectionConducted: "inspection.conducted",
  InspectionCompleted: "inspection.completed",

  // Audit Lifecycle (Future)
  AuditStarted: "audit.started",
  AuditCompleted: "audit.completed",

  // Permit Lifecycle (Future)
  PermitRequested: "permit.requested",
  PermitApproved: "permit.approved",
  PermitIssued: "permit.issued",
  PermitRenewed: "permit.renewed",
  PermitSuspended: "permit.suspended",
  PermitRevoked: "permit.revoked",

  // Incident Lifecycle
  IncidentReported: "incident.reported",
  IncidentInvestigationStarted: "incident.investigation_started",
  IncidentResolved: "incident.resolved",

  // Compliance & Enforcement
  ComplianceUpdated: "compliance.updated",
  EnforcementGenerated: "enforcement.generated",
  EnforcementWarningIssued: "enforcement.warning_issued",
  AppealSubmitted: "appeal.submitted",
  AppealResolved: "appeal.resolved",

  // Reserved System Namespace (Background Workers)
  SystemStarted: "system.started",
  SystemCompleted: "system.completed",
  SystemFailed: "system.failed",
  SystemRetry: "system.retry",
  SystemCancelled: "system.cancelled"
} as const;

export type TimelineEvent = typeof TimelineEvents[keyof typeof TimelineEvents];
```

---

## 4. Timeline Aggregate Registry

To prevent domain modules from defining conflicting aggregate tags, all modules import from a central aggregate registry:

```typescript
export const AggregateTypes = {
  Facility: "facility",
  FacilityRegistration: "facility_registration",
  EnvironmentalAudit: "environmental_audit",
  Inspection: "inspection",
  Incident: "incident",
  Permit: "permit",
  ComplianceAssessment: "compliance_assessment",
  EnforcementNotice: "enforcement_notice",
  WasteSite: "waste_site",
  MonitoringStation: "monitoring_station",
  LaboratoryResult: "laboratory_result",
  ReportJob: "report_job",
  Property: "property",
  Assessment: "assessment",
  Invoice: "invoice",
  Application: "application",
  CitizenReport: "citizen_report"
} as const;

export type AggregateType = typeof AggregateTypes[keyof typeof AggregateTypes];
```

---

## 5. Compliance Scoring & Explainability Specification

The `compliance.updated` event records recalculations of the facility's compliance score. The timeline metadata allowlist explicitly supports explainability fields:

### Allowed Metadata Keys
* `compliance_score_version`: Version of the scoring algorithm used.
* `compliance_score`: Quantitative score value (e.g. 0 to 100).
* `compliance_grade`: Qualitative compliance grade (e.g. 'A', 'B', 'C', 'F').
* `calculation_snapshot`: JSON object capturing the source count indicators (audits, inspections, open incidents).
* `trigger_event`: The event type that prompted the recalculation (e.g., `'inspection.completed'`).
* `algorithm_version`: Version string of the active compliance model (e.g., `'2.1.0'`).

---

## 6. Dashboard Availability Response Contract

For all modules not yet implemented in the current milestone, the backend APIs must return a structured JSON response indicating that the module is unavailable, rather than returning zero counts or fake mock data.

### TypeScript Definition
```typescript
type MetricValue =
  | {
      status: "available";
      value: number;
      asOf: string;
    }
  | {
      status: "unavailable";
      reason:
        | "module_not_implemented"
        | "module_not_enabled"
        | "insufficient_data"
        | "permission_denied";
    }
  | {
      status: "error";
      code: string;
      retryable: boolean;
    };
```

---

## 7. Phased API Route Map (EMIS-1)

Only the following APIs will be exposed during EMIS-1. No placeholder or mock domain APIs will be registered for future features.

### Active Routes
* `GET /operational-timeline/:aggregateType/:aggregateId` -> Retrieves namespaced events from `operational_timeline_event`.
* `GET /dashboard/environmental-summary` -> Returns high-level operational counts (e.g. facility counts).
* `GET /dashboard/environmental-statistics` -> Returns available statistics (e.g. registrations over time).
* `GET /dashboard/recent-activities` -> Returns recent timeline events across all facilities.
* `GET /facilities/:id/profile-summary` -> Returns overview data, documents, and photos for a facility.

### Roadmap (Planned, NOT Implemented - Future Milestones)
* `GET /inspections` -> Future inspections module API.
* `GET /permits` -> Future facility licensing and permits module API.
* `GET /audits` -> Future environmental audits module API.
* `GET /enforcements` -> Future enforcements and appeals module API.

---

## 8. Compatibility & Migration Map

* **Guided Demo Journey**: The demo control panel triggers step changes by setting `window.location.hash = "#/dashboard"` to guide the user seamlessly through the layout without requiring page reloads.
* **Subcontractor Marketplace Links**: Existing subcontractor onboarding links will preserve redirect targets, mapping cleanly onto the `#/subcontractor-apply` and `#/subcontractor-status` hash segments.
* **Platform Administration Consoles**: Navigation tabs inside the Admin Console map to sub-hashes under `#/platform/` (e.g., `#/platform/audit`, `#/platform/health`), resolving to the legacy views.
