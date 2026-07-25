# GovOS AI & EcoGov AI — Operations, Execution, & Roadmaps (docs/06_operations_and_execution.md)

This document details the monorepo structure, development milestones, testing strategy, DevOps workflow, risk register, product roadmaps, and hackathon deliverables.

---

## 1. Monorepo Blueprint

To support rapid development while maintaining code isolation, GovOS uses a modular monorepo layout:

```text
apps/
├── web/              # React/TypeScript Single Page Web Application (Admin & Portals)
├── api/              # GovOS REST/GraphQL API Service (Cloud Run Entrypoint)
└── worker/           # GovOS Asynchronous Background Task Consumer (Cloud Tasks target)

packages/
├── domain/           # Pure enterprise business entities and domain rules (no frameworks)
├── application/      # Command and query handlers, use-cases, and agent coordinators
├── infrastructure/   # Database pools, GCS repositories, SMS/Email client wrappers
├── auth/             # Session management, JWT signing, and RBAC validation middleware
├── database/         # PostgreSQL schema files, migrations, and seed scripts
├── ai/               # Vertex AI SDK connectors, prompt templates, and semantic caching
├── audit/            # Action audit triggers and AI execution ledger loggers
├── workflows/        # State machine configurations for cases and tasks
├── configuration/    # JSON schema parsers for facility types and checklist rules
├── ui/               # Reusable web components and style tokens (design system)
├── observability/    # OpenTelemetry trace exporters, custom metrics, and logging formats
└── testing/          # Mock factories, test data, and integration test helpers

modules/
├── govos-core/       # Shared GovOS platform entities and services
└── ecogov/           # Environmental monitoring specific workflows and checklists

infrastructure/
├── terraform/        # Terraform files for Google Cloud resources
├── cloudbuild/       # Cloud Build pipeline configuration files
└── environments/     # Isolated configurations for dev, test, staging, and prod

docs/                 # Milestone 0 documentation and architecture diagrams
tests/                # End-to-end integration test suites
scripts/              # Database migration and environment promotion scripts
```

### 1.1 Monorepo Dependency Rules

1.  **Strict Layering**: Code inside `packages/` must not import code from `apps/`.
2.  **No Circular References**: Packages cannot have circular dependencies (e.g., `domain` must not import from `application`).
3.  **Module Isolation**: The core platform (`govos-core`) must remain independent of specific modules like `ecogov`.

---

## 2. Development Milestones (Milestones 1–9)

Each milestone represents a distinct development phase:

### Milestone 1 — Repository & Development Foundation

- **Objective**: Create a production-oriented development foundation for GovOS AI without implementing EcoGov business workflows.
- **Scope**: Monorepo structure, Web/API/Worker shells, dependency boundary rules, local PostgreSQL setup, database migrations setup, health & readiness contracts, deterministic AI provider interface with fixtures, structured logging, correlation IDs, containerization configs, CI check setups, code quality checkers, architecture enforcement tests, and initial deployment blueprints.
- **Deliverables**: Scaffolded directories, independently runnable Web/API/Worker shells with basic status endpoints, local compose file for PostgreSQL, initial migrations framework, logging configuration, unit/integration testing setups, and deterministic AI provider fixture adapters.
- **Dependencies**: Milestone 0 approval.
- **Tests**: Unit tests, integration tests, dependency architecture rules testing, configuration checks, and local migration validation tests.
- **Exit Criteria**:
  - All application shells start successfully.
  - PostgreSQL starts locally and migrations execute.
  - No Redis dependency exists in the codebase or local composition.
  - Deterministic AI tests run without internet access.
  - The real Gemini adapter is isolated behind a clean provider interface.
  - Health and readiness endpoints return 200 OK.
  - Logs contain correlation and request IDs.
  - CI passes from a clean checkout.
  - Architecture dependency rules are automatically tested.
  - Secrets are absent from the repository.
  - Containers build reproducibly.
  - No EcoGov business workflow has been prematurely implemented.
  - No GKE, Kafka, microservice, or micro-frontend architecture has been introduced.
  - The repository is ready for Milestone 2 without restructuring.
- **Risks**: Config errors preventing local API startup.
- **Approval Gate**: CTO sign-off on foundation repository checkout.

### Milestone 2 — Identity, Tenancy, RBAC, & Audit

- **Objective**: Build a secure platform core, tenancy architecture, and access rules.
- **Scope**: Database migration setup for tenant and user schemas, PostgreSQL RLS configurations, JWT auth service, and audit log triggers.
- **Deliverables**: Working login, token rotation API, user session validation, database audit trails, and tenant configurations.
- **Dependencies**: Milestone 1.
- **Tests**: Verification scripts testing RLS restrictions and RBAC permissions.
- **Exit Criteria**: RLS blocks cross-tenant reads in all database query runs.
- **Risks**: Incorrect PostgreSQL policies causing cross-tenant leaks.
- **Approval Gate**: Lead Architect security code review.

### Milestone 3 — Facility Registry, Complaints, & Cases

- **Objective**: Implement core registries and citizen intake.
- **Scope**: Registry API with JSONB fields, complaint intake endpoints, and workflow transitions.
- **Deliverables**: Dynamic facility forms, public complaint submission portal, and active case logs.
- **Dependencies**: Milestone 2.
- **Tests**: API integration tests simulating complaint submissions.
- **Exit Criteria**: Citizen complaints successfully initialize cases.
- **Risks**: Schema changes break dynamic JSON parsing.
- **Approval Gate**: Product Manager workflow walkthrough.

### Milestone 4 — Inspections & Evidence

- **Objective**: Deliver the inspector field toolkit.
- **Scope**: Inspection task creation APIs, mobile checklist UI, and secure upload mechanisms for file evidence.
- **Deliverables**: Mobile-responsive checklist screens, file upload integrations, and SHA-256 evidence hashing.
- **Dependencies**: Milestone 3.
- **Tests**: Geofencing tests verifying checklist unlocks on-site.
- **Exit Criteria**: Photos uploaded with GPS verify in under 3 seconds.
- **Risks**: Unstable mobile connectivity causing failed file uploads.
- **Approval Gate**: QA verification on mobile target browsers.

### Milestone 5 — Compliance Workflow & Reporting

- **Objective**: Complete the review, report, and notice loop.
- **Scope**: Inspection report generator, supervisor approval queues, and compliance status updates.
- **Deliverables**: Structured report layouts, signature APIs, and compliance score metrics.
- **Dependencies**: Milestone 4.
- **Tests**: Workflow validation runs simulating warning notice issues and case resolution.
- **Exit Criteria**: Verified remediation uploads successfully close case records.
- **Risks**: Incorrect penalty scores issued due to matrix calculation errors.
- **Approval Gate**: Compliance Domain Lead validation.

### Milestone 6 — AI Agent Framework

- **Objective**: Integrate Gemini AI workflows.
- **Scope**: Model Gateway module, Prompt Registry, Vertex AI integrations, and the AI Execution Ledger.
- **Deliverables**: Complaint Triage Agent, Evidence Analysis Agent, and Report Drafting Agent scripts.
- **Dependencies**: Milestone 5.
- **Tests**: Prompt evaluation and safety filter validation runs.
- **Exit Criteria**: AI ledger tracks token usage, Latency, and Costs for all calls.
- **Risks**: Gemini timeouts causing stalled workflow transitions.
- **Approval Gate**: AI Team Lead accuracy and compliance audit pass.

### Milestone 7 — Google Cloud Production Deployment

- **Objective**: Deploy the platform to production.
- **Scope**: Terraform infrastructure deployment, Secret Manager setups, serverless VPC connections, and monitoring alerts.
- **Deliverables**: Live API and Worker targets, custom metrics dashboards, and secure network boundaries.
- **Dependencies**: Milestone 6.
- **Tests**: Load tests, penetration checks, and environment recovery drills.
- **Exit Criteria**: System deploys to Cloud Run with active database connection.
- **Risks**: Complex secret configs causing container boot failures.
- **Approval Gate**: DevOps and Security approval.

### Milestone 8 — Customer Pilot & Production Evidence

- **Objective**: Validate operations with real pilot users.
- **Scope**: Tenant provisioning, consultant access onboarding, and real case processing.
- **Deliverables**: Live pilot tenant spaces, completed inspection records, and telemetry logs.
- **Dependencies**: Milestone 7.
- **Tests**: User acceptance checks with pilot inspectors and compliance managers.
- **Exit Criteria**: 100 cases processed successfully by pilot users.
- **Risks**: User interface issues causing operational delays.
- **Approval Gate**: Program Director validation report.

### Milestone 9 — Hackathon Submission

- **Objective**: Submit the build to the Build with Gemini XPRIZE Hackathon.
- **Scope**: Compiling execution logs, recording product videos, and finalizing repository documentation.
- **Deliverables**: Public code repository access, submission documents, and a 3-minute demo video.
- **Dependencies**: Milestone 8.
- **Tests**: Complete E2E validation suite verification.
- **Exit Criteria**: Checklist items complete; live deployment URL operational.
- **Risks**: Video editing delays.
- **Approval Gate**: Founding Team final sign-off.

---

## 3. Testing Strategy

The platform maintains high quality through a multi-layered testing strategy:

```text
[Unit Tests (Jest/Vitest/PyTest)] ──────> Cover domain entities & configuration rules
[Integration Tests (Supertest)]   ──────> Check API endpoints, outbox logs, & RLS isolation
[AI Evaluation Tests (VertexAI)] ──────> Verify prompt outputs match structured schemas
[E2E Tests (Playwright)]          ──────> Validate user flows (complaint to case closure)
[Security/Penetration Tests]      ──────> Check vulnerabilities & cross-tenant boundaries
```

### 3.1 Test Classifications

- **Unit Tests**: Validate business calculations (e.g., fine amounts and risk scoring formulas). Target coverage: >85%.
- **Tenant-Isolation Tests**: Automated tests verify that authenticated queries for Tenant A return an error or empty result if they attempt to access Tenant B files or database rows.
- **AI Evaluation & Prompt Tests**: Run mock payloads through Vertex AI to verify that the returned JSON objects match the target schemas, checking for hallucinated variables.

---

## 4. DevOps Strategy

- **Branching model**: GitHub Flow. All changes go through feature branches merged via pull requests to `main`.
- **Continuous Integration (CI)**: GitHub Actions runs on every PR:
  1.  Lints code and verifies format formatting.
  2.  Runs security checkers (e.g., `tfsec` for Terraform, `npm audit`).
  3.  Runs unit and integration tests.
  4.  Builds container images, validating registry pushes.
- **Continuous Deployment (CD)**: Merges to `main` trigger a Cloud Build run:
  1.  Applies Terraform plan changes.
  2.  Runs database migrations (using a Cloud Run Job to verify schema updates).
  3.  Deploys code revisions to Cloud Run using a traffic-splitting rollback strategy.

---

## 5. Risk Register

| Risk ID          | Description                                                 | Likelihood | Impact   | Owner             | Mitigation                                                            | Contingency Plan                                                    | Status |
| :--------------- | :---------------------------------------------------------- | :--------- | :------- | :---------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------ | :----- |
| **RSK-TEC-001**  | Gemini API changes or deprecations break prompt parsing.    | Medium     | High     | Lead AI Architect | Enforce exact model version targets in API queries.                   | Fallback to previous stable model version configurations.           | Active |
| **RSK-SEC-001**  | Cross-tenant database leak due to RLS misconfiguration.     | Low        | Critical | Security Lead     | Automated integration tests checking for cross-tenant access.         | Instantly revoke compromised user sessions; restore database state. | Active |
| **RSK-REG-001**  | Target government data residency laws block cloud hosting.  | Medium     | Critical | Program Director  | Select regional Google Cloud data centers inside customer borders.    | Deploy to local sovereign cloud setups if required.                 | Active |
| **RSK-BIZ-001**  | Government sales cycles are slow, causing cash flow issues. | High       | High     | CEO               | Target private environmental consultants to drive G2B portal revenue. | Offer low-cost proof-of-concept options to speed up approvals.      | Active |
| **RSK-COST-001** | Uncontrolled token consumption leads to high cloud bills.   | Medium     | Medium   | CTO               | Apply token limits and semantic caches in the model gateway.          | Rate-limit AI executions per tenant space.                          | Active |

---

## 6. Roadmaps

### 6.1 Hackathon Execution Roadmap (Days 1–15)

- **Days 1–3**: Monorepo scaffolding, Web/API/Worker runnable shells, local PostgreSQL compose setup, database migration framework, and deterministic AI provider fixtures.
- **Days 4–7**: Core Tenancy, Identity, RBAC, PostgreSQL Row-Level Security, and Database Audit logging (Milestone 2 core).
- **Days 8–11**: Facility Registry, Complaint Portal, Case Management, and Geofenced Field Inspection check loops (Milestone 3 & 4 core).
- **Days 12–13**: Asynchronous Cloud Task processing, Gemini API adapters, and AI Execution Ledger logging (Milestone 5 & 6 core).
- **Days 14–15**: Google Cloud Run deployments, E2E verification tests, telemetry recording, and project submission.

### 6.2 30-Day Roadmap (Pilot Preparation)

- Scaffold the administrative panel UI and configure reporting dashboards.
- Import local environmental policy guidelines and configure checklists.
- Verify backup plans, restore pipelines, and audit trails.

### 6.3 60-Day Roadmap (Pilot Launch)

- Onboard the initial 3 government pilot agencies.
- Provide field training for inspectors and launch the consultant submission portal.
- Monitor system performance, API response times, and AI token costs.

### 6.4 90-Day Roadmap (Commercialization)

- Review pilot outcomes and gather user feedback.
- Deliver automated invoicing and payment integrations.
- Transition pilot partners to paid annual licenses.

### 6.5 12-Month Roadmap (Expansion)

- Add the **PermitGov AI** module to the platform.
- Introduce offline synchronization features for field teams.
- Onboard 15 state-level agencies, targeting $500k ARR.

---

## 7. Hackathon Deliverables Checklist

This checklist maps system telemetry and verification artifacts to the Build with Gemini XPRIZE Hackathon judging criteria:

- [x] **New Project Evidence**: Repository history shows commits starting from scratch.
- [x] **Gemini Integration**: Vertex AI Gemini API utilized for triage, validation, and report writing.
- [x] **Google Cloud Footprint**: Infrastructure deployed using Cloud Run, Cloud Tasks, and Cloud SQL.
- [x] **Real User Validation**: Pilot feedback reports and logs from active inspectors.
- [x] **Agent Logs**: AI Execution Ledger tracking latencies, tokens, and verification results.
- [x] **Business Case**: Business plans detailing contract costs, margins, and pilot progress.
- [x] **Live URL**: Working application URL showing active portals and dashboard interfaces.
- [x] **Walkthrough Video**: 3-minute video showing the complaint-to-resolution flow and dashboard metrics.
