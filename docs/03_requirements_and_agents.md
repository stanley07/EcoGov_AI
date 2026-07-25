# GovOS AI & EcoGov AI — Requirements & AI Agent Specifications (docs/03_requirements_and_agents.md)

This document contains functional and non-functional requirements, specifications for the 10 core AI agents, and the AI governance framework.

---

## 1. Functional Requirements

Requirements are categorized by module. All follow the structure: **ID**, **Description**, **Priority** (High/Medium/Low), **Actor**, **Preconditions**, **Expected Outcome**, **Acceptance Criteria**, **Related Workflow**, **Related Module**.

### 1.1 Identity & Access

- **REQ-ID-001: Multi-Factor Authentication (MFA)**
  - _Description_: Users must authenticate using credentials plus a time-based one-time password (TOTP).
  - _Priority_: High.
  - _Actor_: All Personas.
  - _Preconditions_: User account is registered and status is active.
  - _Expected Outcome_: Secure authenticated session.
  - _Acceptance Criteria_: Rejects logins without TOTP token; allows 3 attempts before locking account for 15 minutes.
  - _Related Workflow_: User Login.
  - _Related Module_: Identity.

- **REQ-ID-002: Role-Based Access Control (RBAC)**
  - _Description_: Enforce resource-level permissions based on role definitions (e.g., Inspector can read/write inspections, cannot approve reports).
  - _Priority_: High.
  - _Actor_: System / Tenant Admin.
  - _Preconditions_: Role permissions are declared in config.
  - _Expected Outcome_: Block unauthorized actions with HTTP 403.
  - _Acceptance Criteria_: Verification tests must run against API endpoints to check all standard roles.
  - _Related Workflow_: API access validation.
  - _Related Module_: RBAC.

### 1.2 Tenant Administration & Onboarding

- **REQ-TA-001: Tenant Database Isolation**
  - _Description_: Isolate data so that no tenant can read or write data belonging to another tenant.
  - _Priority_: High.
  - _Actor_: Tenant Admin / System.
  - _Preconditions_: Connection context initialized with a valid `tenant_id`.
  - _Expected Outcome_: Rows filtered at the database layer (PostgreSQL RLS).
  - _Acceptance Criteria_: SQL queries without `tenant_id` return zero rows or fail; tests verify RLS blocks cross-tenant access.
  - _Related Workflow_: Tenant Onboarding.
  - _Related Module_: Tenant Management.

### 1.3 Facility Registry

- **REQ-FR-001: Dynamic Configuration-Driven Fields**
  - _Description_: Render and validate facility profiles based on JSON schema configurations for that category.
  - _Priority_: High.
  - _Actor_: Facility Owner / Consultant.
  - _Preconditions_: Facility type configuration exists.
  - _Expected Outcome_: Frontend forms validate inputs using the configuration.
  - _Acceptance Criteria_: Creating a new facility type via JSON configuration enables form rendering immediately without code changes.
  - _Related Workflow_: Facility Registration.
  - _Related Module_: Facility Registry.

### 1.4 Complaints & Intake

- **REQ-CO-001: Public Portal Submission**
  - _Description_: Public portal allows anonymous or logged complaint submissions including geolocation and image files.
  - _Priority_: High.
  - _Actor_: Citizen Complainant.
  - _Preconditions_: Public portal is online.
  - _Expected Outcome_: Complaint registered; tracking token issued.
  - _Acceptance Criteria_: Generates a tracking ID and hashes files on upload.
  - _Related Workflow_: Complaint Submission and Triage.
  - _Related Module_: Complaints.

### 1.5 Cases & Inspections

- **REQ-CI-001: Mobile GPS Verification**
  - _Description_: Field checklist can only be submitted if browser geolocation matches the facility's location boundary (within 100 meters).
  - _Priority_: High.
  - _Actor_: Inspector.
  - _Preconditions_: Active inspection assignment.
  - _Expected Outcome_: Checklist unlocks on-site.
  - _Acceptance Criteria_: Checklist submission fails if coordinates are outside the geofence, unless a supervisor override code is input.
  - _Related Workflow_: Field Inspection.
  - _Related Module_: Inspections.

### 1.6 Evidence Management

- **REQ-EV-001: Immutable Evidence Hashing**
  - _Description_: Every uploaded file is hashed at the upload source, and the hash is written to the database audit record.
  - _Priority_: High.
  - _Actor_: Inspector / System.
  - _Preconditions_: File upload initiated.
  - _Expected Outcome_: File written to Cloud Storage; database stores the SHA-256 hash.
  - _Acceptance Criteria_: Modifying or overwriting files triggers a checksum alert.
  - _Related Workflow_: Evidence Upload.
  - _Related Module_: Evidence.

### 1.7 Compliance & Remediation

- **REQ-CR-001: Remediation Timeline Enforcement**
  - _Description_: Automate case status escalation if a facility fails to upload remediation evidence within the timeframe.
  - _Priority_: High.
  - _Actor_: System / Compliance Officer.
  - _Preconditions_: Notice issued with warning deadline.
  - _Expected Outcome_: Status updates to "Non-Compliant" and alerts the compliance team.
  - _Acceptance Criteria_: Daily background cron task runs to flag overdue cases.
  - _Related Workflow_: Remediation Tracking.
  - _Related Module_: Compliance.

### 1.8 AI Operations & Ledger

- **REQ-AO-001: Agent Ledger Logging**
  - _Description_: Log all AI interactions, including prompts, JSON schemas, output texts, token count, and costs.
  - _Priority_: High.
  - _Actor_: System / Auditor.
  - _Preconditions_: AI Agent triggered.
  - _Expected Outcome_: Append-only log written to `agent_execution_ledger` table.
  - _Acceptance Criteria_: Complete details must be searchable by Case ID and Tenant ID.
  - _Related Workflow_: AI Report Drafting / AI Triage.
  - _Related Module_: AI Operations.

---

## 2. Non-Functional Requirements (NFRs)

- **NFR-SEC-001: Row-Level Security**: Every table holding tenant data must use Row-Level Security (RLS) policies in PostgreSQL based on session contexts to guarantee separation of data.
- **NFR-SEC-002: Data Encryption**: AES-256 encryption at rest for database and cloud storage. TLS 1.3 encryption in transit for all connections.
- **NFR-PRV-001: PII Data Masking**: Mask citizen phone numbers and names on public ledgers to comply with Nigeria Data Protection Act and global privacy rules.
- **NFR-PERF-001: Latency**: API endpoints (excluding AI generation) must respond in under 200ms at p95.
- **NFR-PERF-002: AI Response Latency**: Vertex AI Gemini API processing (triage/report generation) must complete in under 15 seconds.
- **NFR-AV-001: Availability**: Target 99.9% uptime for the API gateway and Web UI, managed via Cloud Run scaling and health probes.
- **NFR-SC-001: Scaling**: Scale Cloud Run container instances from 0 to 100 within 2 minutes to handle unexpected complaint intake traffic.
- **NFR-MA-001: Accessibility**: Web interfaces must conform to WCAG 2.1 Level AA guidelines, ensuring usability on screen readers.
- **NFR-MA-002: Mobile-First**: UI layout optimized for mobile screens (360px width) with maximum page bundle size of 150KB for poor-bandwidth environments.
- **NFR-COST-001: Token Budget**: Cap maximum token cost per complaint triage at $0.01 and report drafting at $0.05.

---

## 3. AI Agent Specifications (10 Agents)

All 10 agents must follow the defined specifications.

### 3.1 Registration Review Agent

- **Purpose**: Reviews business registrations and license applications to verify compliance before human sign-off.
- **Trigger**: User submits a new facility registration.
- **Inputs**: JSON registration payload, uploaded document names, and text descriptions.
- **Context**: Bounded regulatory criteria based on the facility category.
- **Retrieval Sources**: Core registration policy schemas.
- **Allowed Tools**: None (read-only validator).
- **Output Schema**:
  ```json
  {
    "registration_id": "string",
    "valid": "boolean",
    "missing_documents": ["string"],
    "errors": [{ "field": "string", "issue": "string" }],
    "risk_classification_recommendation": "string",
    "confidence": "number"
  }
  ```
- **Confidence Handling**: If confidence < 0.85, flags the application for manual review.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: Requires Compliance Officer confirmation.
- **Prohibited Actions**: Cannot update database status to "Registered" directly.
- **Error Handling**: Returns standardized JSON error with message code.
- **Retry Behaviour**: Max 3 attempts, backoff exponential.
- **Evaluation Tests**: Checked against a suite of 20 test registration mock payloads.
- **Business Metric**: Reduces application review queue backlogs.
- **Audit Fields**: Logs inputs, output schema, model name, and processing time.
- **Cost Budget**: $0.01 per execution.
- **Latency Target**: Under 5 seconds.

### 3.2 Complaint Triage Agent

- **Purpose**: Parses unstructured public complaints to classify category and calculate risk levels.
- **Trigger**: Public submission of a complaint.
- **Inputs**: Raw text, image filenames, and geolocations.
- **Context**: Bounded definitions of environmental violations.
- **Retrieval Sources**: Environmental categories database.
- **Allowed Tools**: Vector database search for potential duplicate checks.
- **Output Schema**:
  ```json
  {
    "category": "string",
    "extracted_entities": {
      "facility_name": "string",
      "location_clues": "string"
    },
    "urgency_score": "number",
    "risk_reasoning": "string",
    "duplicate_case_id": "string"
  }
  ```
- **Confidence Handling**: Low confidence maps category to "Unclassified" and assigns case to manual triage.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: Manual review by Complaint Intake Officer required.
- **Prohibited Actions**: Cannot archive a complaint without review.
- **Error Handling**: Default to category "General Inquiry" if parsing fails.
- **Retry Behaviour**: No retries on classification errors; flags for manual review.
- **Evaluation Tests**: Evaluated with a set of 50 test complaints.
- **Business Metric**: Eliminates duplicate filings.
- **Audit Fields**: Inputs, model, prompts, and duplicates flagged.
- **Cost Budget**: $0.01 per execution.
- **Latency Target**: Under 4 seconds.

### 3.3 Risk Assessment Agent

- **Purpose**: Computes risk priorities for facilities based on historic complaints, inspection results, and facility types.
- **Trigger**: Weekly scheduler or when a case is created.
- **Inputs**: Facility history, category details, and recent violations.
- **Context**: Risk policy guidelines.
- **Retrieval Sources**: Historical database metrics.
- **Allowed Tools**: Database read queries.
- **Output Schema**:
  ```json
  {
    "facility_id": "string",
    "base_risk_score": "number",
    "escalation_multiplier": "number",
    "final_risk_score": "number",
    "recommended_inspection_frequency_months": "number",
    "priority_indicators": ["string"]
  }
  ```
- **Confidence Handling**: Emits warning flag if historical data is less than 3 months old.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: None (informs dashboards).
- **Prohibited Actions**: Cannot change facility category metadata directly.
- **Error Handling**: Falls back to base risk score defined in static category configurations.
- **Retry Behaviour**: 2 retries on database query timeouts.
- **Evaluation Tests**: Checked against historical spreadsheets.
- **Business Metric**: Accuracy of high-risk targeting.
- **Audit Fields**: Risk inputs, formula indicators.
- **Cost Budget**: $0.015 per execution.
- **Latency Target**: Under 3 seconds.

### 3.4 Inspection Planning Agent

- **Purpose**: Suggests routes and schedules for inspectors to optimize travel times and cover high-risk facilities.
- **Trigger**: Director requests a weekly inspection schedule.
- **Inputs**: Active inspection tasks, inspector list, geolocations, and work hours.
- **Context**: Geographical boundary constraints.
- **Retrieval Sources**: Google Maps distances API responses.
- **Allowed Tools**: Maps routing api.
- **Output Schema**:
  ```json
  {
    "inspector_id": "string",
    "scheduled_date": "string",
    "ordered_stops": [
      {
        "stop_index": "number",
        "facility_id": "string",
        "estimated_arrival": "string"
      }
    ]
  }
  ```
- **Confidence Handling**: Overrides routing suggestions if traffic or weather warnings are active.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: Director must sign off on schedules.
- **Prohibited Actions**: Cannot assign tasks to unavailable inspectors.
- **Error Handling**: Defaults to simple location proximity sorting if route optimization fails.
- **Retry Behaviour**: 1 retry, then fall back.
- **Evaluation Tests**: Path optimization tests.
- **Business Metric**: Distance traveled per inspector per day.
- **Audit Fields**: Calculated distances, route recommendations.
- **Cost Budget**: $0.02 per execution.
- **Latency Target**: Under 6 seconds.

### 3.5 Evidence Analysis Agent

- **Purpose**: Validates uploaded images to verify they match checklist items and check for signs of tampering.
- **Trigger**: File upload event.
- **Inputs**: File reference, category type, and checklist question.
- **Context**: Quality rules (focus, clarity, object presence).
- **Retrieval Sources**: None.
- **Allowed Tools**: None.
- **Output Schema**:
  ```json
  {
    "file_id": "string",
    "tampering_detected": "boolean",
    "image_quality_check": {
      "clear": "boolean",
      "reason": "string"
    },
    "objects_detected": ["string"],
    "matches_checklist_intent": "boolean"
  }
  ```
- **Confidence Handling**: If confidence of matching checklist intent < 0.8, returns warning flag.
- **Authority Level**: Level 2 (Quality Filter).
- **Approval Requirements**: None (rejects image back to inspector directly if low quality).
- **Prohibited Actions**: Cannot delete the original uploaded image file.
- **Error Handling**: Reverts to manual approval if validation fails.
- **Retry Behaviour**: 1 retry.
- **Evaluation Tests**: Checked against blurred/incorrect images.
- **Business Metric**: Rejection rate of invalid photos in the field.
- **Audit Fields**: Object lists, quality flags.
- **Cost Budget**: $0.03 per execution.
- **Latency Target**: Under 5 seconds.

### 3.6 Inspection Report Drafting Agent

- **Purpose**: Compiles checklist data, inspector notes, and evidence analyses into a structured report.
- **Trigger**: Checklist submission.
- **Inputs**: Completed checklist JSON, notes, and evidence reports.
- **Context**: Professional government reporting templates.
- **Retrieval Sources**: Policy guidelines and templates.
- **Allowed Tools**: None.
- **Output Schema**:
  ```json
  {
    "executive_summary": "string",
    "findings": [
      {
        "section": "string",
        "finding": "string",
        "violation_detected": "boolean",
        "policy_reference": "string"
      }
    ],
    "overall_compliance_status": "string"
  }
  ```
- **Confidence Handling**: Flags report if inspector notes are less than 20 characters.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: Supervisor approval required.
- **Prohibited Actions**: Cannot publish the report to the facility profile.
- **Error Handling**: Generates draft with placeholders if inputs are malformed.
- **Retry Behaviour**: 2 retries.
- **Evaluation Tests**: Content verification tests.
- **Business Metric**: Average report turnaround time.
- **Audit Fields**: Generated text blocks, schema variables.
- **Cost Budget**: $0.05 per execution.
- **Latency Target**: Under 10 seconds.

### 3.7 Compliance Recommendation Agent

- **Purpose**: Suggests enforcement actions (fines, notices) based on report findings and the policy config.
- **Trigger**: Report approval event.
- **Inputs**: Approved report JSON, facility violation history.
- **Context**: Penalty matrix.
- **Retrieval Sources**: Regulatory policy engine database.
- **Allowed Tools**: None.
- **Output Schema**:
  ```json
  {
    "violation_detected": "boolean",
    "recommended_action": "string",
    "fine_amount": "number",
    "remediation_days": "number",
    "policy_citations": ["string"]
  }
  ```
- **Confidence Handling**: Recommends human override if facility has active legal disputes.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: Compliance Officer approval required.
- **Prohibited Actions**: Cannot issue legal orders or charge fines directly.
- **Error Handling**: Defaults to a standard "Warning Letter" with 14-day remediation timeline.
- **Retry Behaviour**: No retries.
- **Evaluation Tests**: Checked against historic case verdicts.
- **Business Metric**: Policy citation accuracy.
- **Audit Fields**: Base regulations cited, compliance ratings.
- **Cost Budget**: $0.02 per execution.
- **Latency Target**: Under 4 seconds.

### 3.8 Executive Intelligence Agent

- **Purpose**: Summarizes systemic risk trends, compliance statistics, and operational blockages for leadership.
- **Trigger**: Weekly scheduled run or user dashboard request.
- **Inputs**: Aggregated metrics, tenant-wide case records.
- **Context**: Bounded KPI calculations.
- **Retrieval Sources**: BigQuery analytics summaries (future) or SQL read views.
- **Allowed Tools**: SQL read executor.
- **Output Schema**:
  ```json
  {
    "executive_summary": "string",
    "key_indicators": {
      "inspections_completed": "number",
      "backlog_count": "number",
      "remediation_rate": "number"
    },
    "systemic_issues": ["string"],
    "regional_outliers": ["string"]
  }
  ```
- **Confidence Handling**: Flags regions with fewer than 5 active inspectors.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: None (internal reporting only).
- **Prohibited Actions**: Cannot modify case states or settings.
- **Error Handling**: Fallback to standard dashboard graphs.
- **Retry Behaviour**: 2 retries on aggregation failures.
- **Evaluation Tests**: Aggregation mock validations.
- **Business Metric**: Reporting coverage.
- **Audit Fields**: Data filters used, generated text.
- **Cost Budget**: $0.08 per execution.
- **Latency Target**: Under 12 seconds.

### 3.9 Citizen or Facility Support Agent

- **Purpose**: Answers public questions on regulations, case statuses, and permit requirements.
- **Trigger**: Message sent to the support chatbot.
- **Inputs**: User text message, case reference number.
- **Context**: Bounded public documentation database.
- **Retrieval Sources**: Public policy documentation vector database.
- **Allowed Tools**: Vector similarity search.
- **Output Schema**:
  ```json
  {
    "response_text": "string",
    "references": ["string"],
    "needs_human_handoff": "boolean"
  }
  ```
- **Confidence Handling**: Automatically triggers a human handoff if the query involves open legal cases or confidence is < 0.9.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: None (answers informational queries).
- **Prohibited Actions**: Cannot verify case changes or issue compliance advice.
- **Error Handling**: Returns support contact details if query is unparseable.
- **Retry Behaviour**: No retries.
- **Evaluation Tests**: Prompt safety validation tests.
- **Business Metric**: Human support ticket deflection rate.
- **Audit Fields**: Conversation log ID, similarity scores.
- **Cost Budget**: $0.005 per message.
- **Latency Target**: Under 3 seconds.

### 3.10 Workflow Coordination Agent

- **Purpose**: Tracks active task queues and alerts users of stalled cases or configuration errors.
- **Trigger**: Hourly scheduler.
- **Inputs**: Active task records, workflow configurations.
- **Context**: SLA timeline configurations.
- **Retrieval Sources**: Database queries.
- **Allowed Tools**: Database read queries.
- **Output Schema**:
  ```json
  {
    "alerts": [
      {
        "case_id": "string",
        "assigned_user_id": "string",
        "stalled_duration_days": "number",
        "action_required": "string"
      }
    ]
  }
  ```
- **Confidence Handling**: Ignores alerts on cases marked on hold.
- **Authority Level**: Level 1 (Read/Recommend).
- **Approval Requirements**: None (alerts system operators).
- **Prohibited Actions**: Cannot reassign cases without supervisor approval.
- **Error Handling**: Logs errors to system console.
- **Retry Behaviour**: 3 retries.
- **Evaluation Tests**: Workflow deadline mock runs.
- **Business Metric**: Tasks resolved within SLA limits.
- **Audit Fields**: Alert logs.
- **Cost Budget**: $0.01 per execution.
- **Latency Target**: Under 5 seconds.

---

## 4. AI Governance Framework

To maintain public trust and comply with regulatory requirements, GovOS AI enforces a strict AI Governance Framework:

### 4.1 Autonomy & Authority Limits

No AI agent can autonomously change status configurations, issue penalties, edit officially approved records, or publish accusations. All actions with legal or financial consequences require human review and authorization.

### 4.2 Human-in-the-Loop (HITL) Execution Model

Every AI recommendation is placed in a queue for human review. The reviewer has three options:

1.  **Approve**: Accepts the recommendation, prompting system transition.
2.  **Edit**: Modifies the output before approval.
3.  **Reject**: Discards the recommendation, requiring manual input.
    If modified, the system records the difference between the AI recommendation and the final human approved values.

### 4.3 Grounding & Hallucination Mitigations

- **System Prompts**: System prompts enforce structured output constraints and restrict the model from answering questions outside the uploaded reference context.
- **Semantic Grounding**: Retried items (RAG) are validated for semantic similarity against policy documentation before insertion into the context window.
- **Output JSON Schema Enforcement**: Use Vertex AI's structured schema capabilities to force the models to output exact JSON objects matching our data entities, eliminating formatting anomalies.

### 4.4 Adversarial Prompt & Injection Protection

All user inputs are pre-filtered to remove injection indicators (e.g., instructions to ignore system prompts). The gateway validates that the returned outputs match the requested schema structure before updating records.

### 4.5 Versioning & Replayability

Every prompt change is registered with a version number. The ledger records the exact prompt version, model name, and input parameters, allowing developers to replay the execution context during audits.
