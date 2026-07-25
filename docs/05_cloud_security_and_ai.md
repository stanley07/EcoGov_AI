# GovOS AI & EcoGov AI — GCP Services, Security, & AI Integration Strategy (docs/05_cloud_security_and_ai.md)

This document contains the Google Cloud mapping, Deployment Architecture, Security Architecture, Threat Model, and Gemini Integration Strategy for the platform.

---

## 1. Google Cloud Mapping

The platform runs on a **Cloud Run-first architecture** to minimize DevOps overhead. Below is the mapping for every service:

### 1.1 Core Platform Services

#### Vertex AI & Gemini API

- **Purpose**: Core LLM orchestration engine for triage, evidence parsing, report drafting, and Q&A support.
- **Workload**: Triggers on complaints, checklists, evidence uploads, and weekly summary schedules.
- **Justification**: Native enterprise support on GCP, SOC 2 and ISO 27001-certified model boundaries, data privacy guarantees (Google does not use customer inputs for training).
- **Alternative / Trade-Off**: OpenAI API (requires cross-cloud latency and complex data security agreements).
- **Initial Use**: Triage classification, document extraction, evidence validation.
- **Future Use**: Multi-agent negotiations and predictive threat monitoring.
- **Operational Risk**: Latency variance under high system loads.
- **Cost Concern**: High tokens in large pdf extractions. Managed via max token caps.

#### Cloud Run

- **Purpose**: Hosts the Web API and Task Handlers.
- **Workload**: Processes HTTP traffic and asynchronous tasks.
- **Justification**: Fully managed container orchestration scaling to zero, reducing idle runtime costs.
- **Alternative**: Google Kubernetes Engine (GKE) (adds heavy operational complexity and idle VM costs; GKE is documented only as a future migration path).
- **Initial Use**: Runs modular monolith API and background tasks.
- **Future Use**: Serves as the base runtime for isolated microservices.
- **Operational Risk**: Cold starts (mitigated by configuring minimum instances).
- **Cost Concern**: Scale-out surges under traffic spikes. Controlled via max instance limits.

#### Cloud Run Jobs

- **Purpose**: Runs long-running batch operations (e.g., weekly analytics aggregations, archival tasks).
- **Workload**: Runs on a cron schedule or is triggered programmatically.
- **Justification**: Outpaces Cloud Run HTTP limits (which have a 60-minute maximum).
- **Alternative**: VM-based cron schedulers (leads to idle cost and management overhead).
- **Initial Use**: Triggering weekly tenant risk assessments.
- **Future Use**: Large-scale database pruning and audit verification cycles.
- **Operational Risk**: Task failure midway. Controlled via idempotent task design.
- **Cost Concern**: Low (billed strictly per second of active execution).

#### Cloud SQL for PostgreSQL

- **Purpose**: Primary relational transaction database.
- **Workload**: Serves transactional queries and analytical summaries.
- **Justification**: Native PostgreSQL engine supporting Row-Level Security and `pgvector` for semantic search.
- **Alternative**: Spanner (overkill for MVP), Firestore (NoSQL limits indexing capabilities).
- **Initial Use**: Stores users, facilities, checklists, and the AI Execution Ledger.
- **Future Use**: Sharded read-replicas for high-volume regions.
- **Operational Risk**: Storage depletion. Managed via auto-resize configurations.
- **Cost Concern**: High instance pricing for high-availability setups.

#### Cloud Storage

- **Purpose**: Storage for files, documents, and compliance evidence.
- **Workload**: Multi-gigabyte image and document uploads.
- **Justification**: Immutable storage policies, signed URL capabilities, and lifecycle rules.
- **Alternative**: Local disk mount (lacks scaling and replication).
- **Initial Use**: Hosting raw inspection photos and signed PDF reports.
- **Future Use**: Cold-tier storage for archived cases.
- **Operational Risk**: Unauthorized file access. Mitigated by signed URLs.
- **Cost Concern**: Low; cost increases only with massive historical files.

#### Cloud Tasks

- **Purpose**: Asynchronous task queue for outbox events.
- **Workload**: Non-blocking background worker tasks.
- **Justification**: Native rate-limiting, retry configurations, and HTTP target invocation.
- **Alternative**: Pub/Sub (Pub/Sub lacks scheduled delays and is harder to rate-limit for third-party API targets).
- **Initial Use**: Processing uploads, triggering AI agents, sending emails.
- **Future Use**: Inter-service request queue.
- **Operational Risk**: Tasks queuing behind slow processing tasks. Mitigated by parallel queues.
- **Cost Concern**: Extremely low.

#### Secret Manager

- **Purpose**: Secure storage of database credentials, API keys, and certificates.
- **Workload**: Accessed during container boot.
- **Justification**: Fine-grained IAM controls, versioning, and environment injection.
- **Alternative**: Hardcoded environment files (insecure).
- **Initial Use**: Storing Postgres passwords and Vertex API project keys.
- **Future Use**: Managing per-tenant encryption keys.
- **Operational Risk**: Key rotation failures. Mitigated by dry-run key testing.
- **Cost Concern**: Negligible.

#### Cloud Logging & Cloud Monitoring

- **Purpose**: Auditing, log collection, and performance visualization.
- **Workload**: Continual ingestion of system logs and latency metrics.
- **Justification**: Out-of-the-box integration with Cloud Run and Vertex AI.
- **Alternative**: Datadog (adds third-party integration costs).
- **Initial Use**: Logging API errors, RLS failures, and agent execution times.
- **Future Use**: Automated alerting via PagerDuty for SLA breaches.
- **Operational Risk**: Log floods. Mitigated by custom log levels.
- **Cost Concern**: High cost under debug logging. Default to INFO levels.

#### Artifact Registry & Google Cloud Build

- **Purpose**: Container image building and storage.
- **Workload**: Triggered on code commits.
- **Justification**: Automated vulnerability scanning, IAM-secured.
- **Alternative**: Docker Hub.
- **Initial Use**: Building API/Worker containers.
- **Future Use**: Deploying regional images.
- **Operational Risk**: Slow build pipelines. Mitigated by build caching.
- **Cost Concern**: Low.

#### Google Maps Platform

- **Purpose**: Geocoding, address autocomplete, and route calculation.
- **Workload**: Runs during facility registration and inspector routing tasks.
- **Justification**: Extensive geographical database with local street-level precision.
- **Alternative**: OpenStreetMap (OSM) (lacks routing accuracy in emerging markets).
- **Initial Use**: Verifying inspection addresses and calculating travel paths.
- **Future Use**: Spatial risk mapping.
- **Operational Risk**: API key exposure (managed via key restrictions).
- **Cost Concern**: High cost under excessive client map queries. Managed by server-side caching.

---

## 2. Deployment Architecture

We deploy across four environments using an isolated project strategy.

```text
[GCP global-admin project]
    └── [Identity / Terraform Access]
        ├── [GCP dev-project]    --> Local testing
        ├── [GCP test-project]   --> CI integration runs
        ├── [GCP staging-project] --> Pre-release validation
        └── [GCP prod-project]   --> High-Availability production
```

### 2.1 Project Strategy

Each environment runs in its own Google Cloud project. This establishes a strict security boundary, preventing development tests from affecting production databases or resources.

### 2.2 Network Boundaries

Production instances run in a Virtual Private Cloud (VPC) with:

- **Private IPs Only**: Cloud SQL database does not have a public IP. It is accessed via Serverless VPC Access connectors from Cloud Run.
- **VPC Service Controls**: Restricts outbound connections from Cloud Run to prevent data exfiltration.

### 2.3 Service Accounts

We use unique service accounts following the principle of least privilege:

- `api-runner@prod-project.iam.gserviceaccount.com`: Permission to read/write PostgreSQL and enqueue Cloud Tasks.
- `worker-runner@prod-project.iam.gserviceaccount.com`: Permission to read/write PostgreSQL, read/write Cloud Storage buckets, and call Vertex AI APIs.

### 2.4 Region Selection & Data Residency

- **Default Region**: `europe-west3` (Frankfurt) or `us-central1` (Iowa).
- **Regional Deployments**: For customers in specific jurisdictions (e.g., Nigeria), the entire tenant profile is deployed to a regional instance to comply with local data residency laws (e.g., Nigeria Data Protection Act).

---

## 3. Security Architecture

### 3.1 Authentication & Session Management

- Authentication runs on JWT tokens signed with RS256 keys rotated monthly.
- Short-lived access tokens (15 minutes) combined with sliding refresh tokens (7 days) stored in secure, `HttpOnly`, `SameSite=Strict` cookies.

### 3.2 Row-Level Security (RLS)

The database enforces tenant isolation using RLS. All incoming requests pass through a middleware that sets the transaction scope:
`SET LOCAL app.current_tenant_id = 'tenant-uuid';`
Every query is limited to this tenant. If the identifier is missing, the query fails by default.

### 3.3 Evidence Access

Images stored in Cloud Storage buckets are private by default. Users access files via **signed URLs** with a maximum lifetime of 10 minutes. Signed URLs are issued only after confirming that the requester's user account has case-level access permissions.

### 3.4 Upload Validation & Malware Scanning

Before saving files to Cloud Storage, the worker:

1.  Verifies the file header matches the allowed mime-types (`image/jpeg`, `image/png`, `application/pdf`).
2.  Runs the file through a ClamAV scan (running on an isolated Cloud Run service) to flag malware.
3.  Resizes images to remove EXIF GPS tags from the public-facing version, keeping coordinates only in the database ledger.

---

## 4. Threat Model Matrix

| Threat                          | Likelihood | Impact   | Prevention                                                                     | Detection                                                     | Response                                          | Residual Risk |
| :------------------------------ | :--------- | :------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------ | :------------ |
| **Cross-Tenant Data Leakage**   | Low        | Critical | PostgreSQL Row-Level Security (RLS) and tenant-isolation integration tests.    | Database audit logs tracking cross-tenant attempts.           | Revoke user sessions; suspend compromised tenant. | Negligible    |
| **Privilege Escalation**        | Medium     | High     | System-wide RBAC verification middleware on all endpoints.                     | Monitoring logs tracking unauthorized 403 API responses.      | Revoke user accounts; audit API boundary rules.   | Low           |
| **Malicious File Upload**       | High       | High     | Mime-type headers validation + ClamAV malware scans.                           | Scan log alerts tracking rejected files.                      | Block IP address; quarantine upload folder.       | Low           |
| **Prompt Injection**            | High       | Medium   | Input sanitation + system prompts + validation of structured output schemas.   | Regex filters tracking command strings in AI logs.            | Update system prompt configurations.              | Medium        |
| **Forged Field Evidence**       | Medium     | High     | Enforce capture timestamps; browser geolocation validation (geofencing).       | Checksums mismatch alerts; GPS anomaly audits.                | Reject checklist; notify supervisor of fraud.     | Low           |
| **Report Tampering**            | Low        | High     | Cryptographic SHA-256 hashes of generated report files written to database.    | Cron checker verifying file hashes in storage match database. | Re-generate PDF; flag case for supervisor.        | Low           |
| **AI Model Hallucination**      | High       | Medium   | Context grounding (RAG) + structural output validation + human approval gates. | Quality audit reviews matching AI outputs to ground truths.   | Update prompt instructions; adjust temperature.   | Medium        |
| **API Denial of Service (DoS)** | High       | Medium   | Cloud Armor rate limiting + Cloud Run auto-scaling configs.                    | Log monitoring tracking rate limit triggers.                  | Adjust IP block rules; scale containers.          | Low           |

---

## 5. Gemini Integration Strategy

Gemini 1.5 Flash (default for speed/cost) and Gemini 1.5 Pro (used for complex PDF parsing) are accessed via Vertex AI SDKs.

```text
[Incoming Event] ──> [Model Gateway] ──> [Semantic Cache Check] ──> [Gemini API]
                                                                        │
[Output Validated] <── [Schema Check] <── [Safety Settings Filter] <───┘
```

### 5.1 Model Gateway & Semantic Cache

All AI interactions pass through a central Model Gateway service:

- **Semantic Cache**: Before calling the Gemini API, the system checks a local in-memory cache for semantically identical questions (e.g., in customer support). If a match is found with >95% confidence, it returns the cached response, saving token costs and reducing latency. A distributed cache (e.g., Memorystore/Redis) will only be introduced post-MVP when multi-instance horizontal scaling warrants it.
- **Token Budgets**: Each tenant is assigned a monthly token budget. If a tenant exceeds their limit, the system alerts the admin and slows down non-essential background tasks.

### 5.2 Structured JSON Outputs

We enforce output formats by providing the Gemini API with structured JSON schemas. This prevents formatting anomalies and allows direct parsing into database records.
For example, the **Complaint Triage Agent** is initialized with a schema declaring required types for `urgency_score` (number) and `category` (string enum).

### 5.3 Safety Settings & Content Filters

We configure Vertex AI safety settings to block harmful content. We use the following thresholds:

- `HATE_SPEECH`: BLOCK_MEDIUM_AND_ABOVE
- `HARASSMENT`: BLOCK_MEDIUM_AND_ABOVE
- `SEXUALLY_EXPLICIT`: BLOCK_LOW_AND_ABOVE
- `DANGEROUS_CONTENT`: BLOCK_MEDIUM_AND_ABOVE
  If a user input triggers a safety block, the system returns a standard validation error and logs the event for administrator review.

### 5.4 Fallbacks & Retries

If the Gemini API returns a 429 rate-limit error or 503 service unavailable error:

1.  **Retry**: Cloud Tasks automatically retries the task up to 3 times using exponential backoff.
2.  **Fallback**: If retries fail, the system falls back to a lightweight heuristic parser or assigns the task directly to the human manual queue with an "AI Extraction Failed" status indicator.
