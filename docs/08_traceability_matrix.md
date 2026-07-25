# GovOS AI & EcoGov AI — Traceability Matrix (docs/08_traceability_matrix.md)

This document contains the multi-dimensional Traceability Matrix mapping business goals to technical implementations, security controls, verification tests, and hackathon evidence.

---

## 1. Traceability Mapping Grid

To ensure there are no orphan requirements, agents, or database entities, the matrix is organized into primary operational flows.

### 1.1 Flow A: Citizen Complaint to AI Triage

```text
[Business Objective: Public Accountability]
 └── [Segment: State EPA]
      └── [Persona: Citizen Complainant]
           └── [Journey: Journey 1 (Complaint Triage)]
                └── [Requirement: REQ-CO-001 (Portal Submission)]
                     └── [Module: Complaints]
                          └── [Entity: complaint]
                               └── [API: POST /api/v1/complaints]
                                    └── [Agent: Complaint Triage Agent]
                                         └── [Security: PII Data Masking (NFR-PRV-001)]
                                              └── [Metric: Average Triage Latency < 4s]
                                                   └── [Test: E2E Triage integration tests]
                                                        └── [Evidence: Agent Execution Logs]
```

- **Business Objective**: OB-1: Public Trust and Transparency.
- **Customer Segment**: State & Municipal Environmental Agencies.
- **Persona**: Citizen Complainant / Complaint Intake Officer.
- **User Journey**: Journey 1: Complaint submission and triage (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#journey-1-complaint-submission-and-triage)).
- **Functional Requirement**: REQ-CO-001: Public Portal Submission (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#14-complaints--intake)).
- **Domain Module**: Complaints Module (`ecogov/complaints`).
- **Data Entity**: `complaint` table (see [docs/04_technical_architecture.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/04_technical_architecture.md#complaint)).
- **API Capability**: `POST /api/v1/complaints` (anonymous intake endpoint).
- **AI Agent**: Complaint Triage Agent (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#32-complaint-triage-agent)).
- **Security Control**: SEC-1: PII Data Masking (NFR-PRV-001) for anonymous submissions.
- **Metric**: MET-1: Processing time from submission to triage < 1 minute.
- **Test Reference**: `tests/integration/complaints_triage_test.ts`.
- **Hackathon Evidence**: Real-time triage log output in execution ledger.

---

### 1.2 Flow B: Geofenced Field Inspection

```text
[Business Objective: Inspector Integrity]
 └── [Segment: State EPA]
      └── [Persona: Field Inspector]
           └── [Journey: Journey 5 (Field Inspection)]
                └── [Requirement: REQ-CI-001 (GPS Verification)]
                     └── [Module: Inspections]
                          └── [Entity: inspection_task]
                               └── [API: POST /api/v1/inspections/{id}/submit]
                                    └── [Agent: None (Policy Engine validation)]
                                         └── [Security: Row-Level Security (NFR-SEC-001)]
                                              └── [Metric: Geofencing validation rate (100%)]
                                                   └── [Test: Route validation tests]
                                                        └── [Evidence: Inspector GPS logs]
```

- **Business Objective**: OB-2: Eliminate inspection fraud and bribe-seeking behaviors.
- **Customer Segment**: State Environmental Agencies.
- **Persona**: Inspector (Field Officer) (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#15-inspector-field-officer)).
- **User Journey**: Journey 5: Field inspection (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#journey-5-field-inspection)).
- **Functional Requirement**: REQ-CI-001: Mobile GPS Verification (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#15-cases--inspections)).
- **Domain Module**: Inspections Module (`ecogov/inspections`).
- **Data Entity**: `inspection_task` table (see [docs/04_technical_architecture.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/04_technical_architecture.md#inspection_task)).
- **API Capability**: `PUT /api/v1/inspections/{id}/submit` (checklist submission endpoint).
- **AI Agent**: None (handled by policy engine rules).
- **Security Control**: SEC-2: PostgreSQL Row-Level Security (RLS) restricts access to assigned inspector only.
- **Metric**: MET-2: 100% of submitted checklists have GPS coordinates verified.
- **Test Reference**: `tests/unit/geofence_validator_test.ts`.
- **Hackathon Evidence**: Mobile screenshots showing geofence restrictions.

---

### 1.3 Flow C: Evidence Upload & Quality Control

```text
[Business Objective: Legal Admissibility]
 └── [Segment: State EPA]
      └── [Persona: Field Inspector]
           └── [Journey: Journey 6 (Evidence Upload)]
                └── [Requirement: REQ-EV-001 (Evidence Hashing)]
                     └── [Module: Evidence]
                          └── [Entity: evidence_file]
                               └── [API: GET /api/v1/evidence/upload-url]
                                    └── [Agent: Evidence Analysis Agent]
                                         └── [Security: Secure Signed URLs & Malware Scans]
                                              └── [Metric: Hash verification rate (100%)]
                                                   └── [Test: File security validation tests]
                                                        └── [Evidence: Database integrity proofs]
```

- **Business Objective**: OB-3: Secure and legally admissible evidence collection.
- **Customer Segment**: Legal & Enforcement Teams.
- **Persona**: Inspector (Field Officer) / Legal Officer.
- **User Journey**: Journey 6 & Journey 7: Evidence upload and AI review (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#journey-6-evidence-upload)).
- **Functional Requirement**: REQ-EV-001: Immutable Evidence Hashing (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#16-evidence-management)).
- **Domain Module**: Evidence Module (`core/evidence`).
- **Data Entity**: `evidence_file` table (see [docs/04_technical_architecture.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/04_technical_architecture.md#evidence_file)).
- **API Capability**: `POST /api/v1/evidence/upload-url` (signed URL generation endpoint).
- **AI Agent**: Evidence Analysis Agent (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#35-evidence-analysis-agent)).
- **Security Control**: SEC-3: Cloud Storage Private Buckets + Signed URLs + ClamAV malware scanning.
- **Metric**: MET-3: Zero modified files pass SHA-256 integrity audits.
- **Test Reference**: `tests/integration/evidence_integrity_test.ts`.
- **Hackathon Evidence**: Database records showing SHA-256 hashes matched with GCS object metadata.

---

### 1.4 Flow D: AI Report Generation

```text
[Business Objective: Workflow Velocity]
 └── [Segment: State EPA]
      └── [Persona: Supervisor (Review Team)]
           └── [Journey: Journey 8 (Report Approval)]
                └── [Requirement: REQ-AO-001 (Agent Ledger)]
                     └── [Module: AI Operations]
                          └── [Entity: agent_execution]
                               └── [API: POST /api/v1/reports/draft]
                                    └── [Agent: Inspection Report Drafting Agent]
                                         └── [Security: Human-in-the-Loop Approval]
                                              └── [Metric: Report generation time < 10s]
                                                   └── [Test: AI generation contract tests]
                                                        └── [Evidence: AI Execution Ledger entries]
```

- **Business Objective**: OB-4: Reduce case processing bottlenecks.
- **Customer Segment**: Supervisor & Director Teams.
- **Persona**: Supervisor (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#14-supervisor-inspection--compliance-team)).
- **User Journey**: Journey 8: Inspection report approval (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#journey-8-inspection-report-approval)).
- **Functional Requirement**: REQ-AO-001: Agent Ledger Logging (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#18-ai-operations--ledger)).
- **Domain Module**: AI Operations Module (`core/ai`).
- **Data Entity**: `agent_execution` table (see [docs/04_technical_architecture.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/04_technical_architecture.md#agent_execution-ai-execution-ledger)).
- **API Capability**: `POST /api/v1/inspections/{id}/draft-report` (AI report drafting endpoint).
- **AI Agent**: Inspection Report Drafting Agent (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#36-inspection-report-drafting-agent)).
- **Security Control**: SEC-4: Human-in-the-loop approval gate. AI only drafts; supervisor must sign.
- **Metric**: MET-4: Under 5 minutes average supervisor review turnaround time.
- **Test Reference**: `tests/ai/report_drafting_agent_test.ts`.
- **Hackathon Evidence**: Signed inspection report PDF generated from checklist.

---

### 1.5 Flow E: Compliance Enforcement

```text
[Business Objective: Revenue Optimization]
 └── [Segment: State EPA / Facility Owners]
      └── [Persona: Compliance Officer]
           └── [Journey: Journey 9 (Compliance Recommendation)]
                └── [Requirement: REQ-CR-001 (Remediation Timeline)]
                     └── [Module: Compliance]
                          └── [Entity: compliance_action]
                               └── [API: POST /api/v1/compliance/actions]
                                    └── [Agent: Compliance Recommendation Agent]
                                         └── [Security: Least Privilege Permissions]
                                              └── [Metric: Warning notices resolved < 14 days]
                                                   └── [Test: Compliance workflow state tests]
                                                        └── [Evidence: Execution ledger metrics]
```

- **Business Objective**: OB-5: Capture lost regulatory revenues from fines and fees.
- **Customer Segment**: Environmental Compliance & Revenue Management.
- **Persona**: Compliance Officer / Facility Owner.
- **User Journey**: Journey 9 & Journey 10: Compliance recommendation and remediation (see [docs/02_user_experience.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/02_user_experience.md#journey-9-compliance-recommendation)).
- **Functional Requirement**: REQ-CR-001: Remediation Timeline Enforcement (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#17-compliance--remediation)).
- **Domain Module**: Compliance Module (`ecogov/compliance`).
- **Data Entity**: `compliance_action` table (see [docs/04_technical_architecture.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/04_technical_architecture.md#compliance_action)).
- **API Capability**: `POST /api/v1/compliance/actions` (issue legal notice endpoint).
- **AI Agent**: Compliance Recommendation Agent (see [docs/03_requirements_and_agents.md](file:///c:/Users/USER/Desktop/EcoGov_AI/docs/03_requirements_and_agents.md#37-compliance-recommendation-agent)).
- **Security Control**: SEC-5: Least privilege permissions restrict legal notice issues to authorized compliance officers.
- **Metric**: MET-5: 80% remediation completion rates within the warning window.
- **Test Reference**: `tests/integration/compliance_workflow_test.ts`.
- **Hackathon Evidence**: Compliance status reports in database audit logs.
