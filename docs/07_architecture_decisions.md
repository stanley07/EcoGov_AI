# GovOS AI & EcoGov AI — Architecture Decision Records (docs/07_architecture_decisions.md)

This document records the architectural decisions made during the design of GovOS AI and EcoGov AI.

---

## ADR-001: Modular Monolith Over Microservices

- **Status**: Approved
- **Context**: The platform must support multiple tenants and scale, but early-stage microservices add deployment overhead, database fragmentation, and network latency.
- **Decision**: Implement a modular monolith using isolated directories and clear boundary rules.
- **Alternatives**: Microservices (rejected due to operational complexity and costs).
- **Advantages**: Simplified deployments, unified repository, and simple transactional operations.
- **Disadvantages**: Scales as a single unit; a crash in one module could affect the entire service.
- **Consequences**: Boundary checks must be enforced by linters to prevent circular imports.
- **Migration Trigger**: Extract components to microservices when a single module requires 3x the resources of other services.
- **Review Date**: 2026-12-01

---

## ADR-002: Single Modular Frontend Over Micro-Frontends

- **Status**: Approved
- **Context**: GovOS portals (citizen, inspector, admin) share design elements, and micro-frontends add bundle weight and state complexity.
- **Decision**: Deploy a single modular frontend application with feature modules.
- **Alternatives**: Micro-frontends (rejected due to configuration complexity).
- **Advantages**: Shares components easily; fast page loads.
- **Disadvantages**: Deployment releases the entire portal suite.
- **Consequences**: Clean feature folder layouts must be strictly maintained.
- **Migration Trigger**: Split frontend targets when team size exceeds 20 active developers.
- **Review Date**: 2026-12-01

---

## ADR-003: Cloud Run Over GKE (Google Kubernetes Engine)

- **Status**: Approved
- **Context**: Deploying on GKE requires configuring VMs, load balancers, and node pools, which increases cloud costs and operational workloads.
- **Decision**: Deploy the application containers to Google Cloud Run, scaling down to zero when idle.
- **Alternatives**: GKE (rejected for initial launch), Compute Engine (rejected due to VM management overhead).
- **Advantages**: Serverless scaling, zero idle costs, and built-in revision rollbacks.
- **Disadvantages**: Maximum request timeout limit of 60 minutes; limited local disk access.
- **Consequences**: Long jobs must run as Cloud Run Jobs instead of standard HTTP loops.
- **Migration Trigger**: Migrate to GKE when the tenant requires custom network topologies or VM-level storage mounts.
- **Review Date**: 2026-12-01

---

## ADR-004: PostgreSQL as Primary Data Store

- **Status**: Approved
- **Context**: The application requires relational integrity, audit logs, configuration storage, and text search queries.
- **Decision**: Use PostgreSQL (Cloud SQL) as the primary transactional system of record.
- **Alternatives**: MongoDB/NoSQL (rejected due to lack of transactions), Spanner (rejected due to initial costs).
- **Advantages**: Row-Level Security, JSONB configurations, and full-text indexing.
- **Disadvantages**: Vertical scaling limits on single write instances.
- **Consequences**: Database schemas must be declared in migrations.
- **Migration Trigger**: Introduce read-replicas when database CPU usage exceeds 70% consistently.
- **Review Date**: 2026-12-01

---

## ADR-005: `pgvector` Before Dedicated Vector Database

- **Status**: Approved
- **Context**: AI features require vector searches, but a dedicated vector database adds infrastructure complexity and costs.
- **Decision**: Use PostgreSQL's `pgvector` extension for storing and querying embeddings.
- **Alternatives**: Pinecone, Milvus (rejected due to extra costs and synchronization needs).
- **Advantages**: Keeps all data in a single transactional database.
- **Disadvantages**: Less performant than dedicated index engines under massive search volumes.
- **Consequences**: Index types (IVFFlat/HNSW) must be configured on vector columns.
- **Migration Trigger**: Migrate to a dedicated vector database when semantic search queries exceed 1,000 requests per minute.
- **Review Date**: 2026-12-01

---

## ADR-006: Shared Database and Shared Schema Multi-Tenancy

- **Status**: Approved
- **Context**: The system must isolate tenant data, but running separate databases for every tenant increases costs and management overhead.
- **Decision**: Use a shared database and schema, isolating data using tenant IDs.
- **Alternatives**: Dedicated database per tenant (rejected due to cost and maintenance overhead).
- **Advantages**: Low cost, simple schema updates, and optimized resource use.
- **Disadvantages**: Risk of data leaks if tenant isolation logic fails.
- **Consequences**: Every query must include a `tenant_id` filter (enforced via PostgreSQL RLS).
- **Migration Trigger**: Offer dedicated databases only for large enterprise/sovereign government contracts.
- **Review Date**: 2026-12-01

---

## ADR-007: Row-Level Security Plus Application Enforcement

- **Status**: Approved
- **Context**: Application-layer checks can be bypassed by developer errors, presenting data leak risks.
- **Decision**: Enable Row-Level Security (RLS) in PostgreSQL, backed by application validation checks.
- **Alternatives**: Application-only tenancy checks (rejected due to risk of leaks).
- **Advantages**: Database-level security blocks unauthorized data access.
- **Disadvantages**: Minor performance overhead; harder to write complex join queries.
- **Consequences**: Database connection pools must run with RLS set session parameters.
- **Migration Trigger**: Re-evaluate if database CPU usage is heavily impacted by RLS rules.
- **Review Date**: 2026-12-01

---

## ADR-008: Transactional Outbox for Domain Events

- **Status**: Approved
- **Context**: Network failures can cause event publishes to fail, leaving databases and downstream services out of sync.
- **Decision**: Write events to an `outbox_event` table in the same transaction as the business update, then process them asynchronously.
- **Alternatives**: Direct event dispatch (rejected due to consistency risks).
- **Advantages**: Guarantees event delivery; decoupling of services.
- **Disadvantages**: Requires a poller/relay process to read the outbox.
- **Consequences**: Requires writing event schemas to database tables.
- **Migration Trigger**: Retain this pattern as the standard for transactional consistency.
- **Review Date**: 2026-12-01

---

## ADR-009: Cloud Tasks Before Broad Pub/Sub Usage

- **Status**: Approved
- **Context**: Decoupled systems use Pub/Sub, but Pub/Sub lacks rate-limiting and task schedules.
- **Decision**: Use Google Cloud Tasks for non-blocking queue operations.
- **Alternatives**: Pub/Sub (reserved for integration events), RabbitMQ (rejected due to hosting costs).
- **Advantages**: Rate-limiting, exact retries, scheduled delivery, and serverless consumption.
- **Disadvantages**: Direct HTTP invocation target limits tasks to 1 hour runtimes.
- **Consequences**: Worker services must present secure HTTPS endpoints for tasks.
- **Migration Trigger**: Introduce Pub/Sub when multiple services need to consume the same event independently.
- **Review Date**: 2026-12-01

---

## ADR-010: Configuration-Driven Facility Types

- **Status**: Approved
- **Context**: Environmental agencies monitor various facility types. Hardcoding rules requires code releases for every change.
- **Decision**: Store facility definitions and requirements as JSON configurations.
- **Alternatives**: Hardcoded database entities (rejected due to lack of flexibility).
- **Advantages**: New facility types can be configured instantly via administrative screens.
- **Disadvantages**: Complex database queries on JSONB columns are slower than structured columns.
- **Consequences**: Indexing must be set up on key JSON keys.
- **Migration Trigger**: Retained as core design principle.
- **Review Date**: 2026-12-01

---

## ADR-011: Policy Engine Plus AI Rather Than AI-Only Decisions

- **Status**: Approved
- **Context**: Pure AI determinations (e.g., calculations of fines) are subject to hallucinations, presenting legal risks.
- **Decision**: Build a rule-based policy engine. The AI parses text and suggests inputs, but the engine calculates the final values.
- **Alternatives**: AI-only decision models (rejected due to accuracy risks).
- **Advantages**: Predictable, auditable outcomes that match local regulations.
- **Disadvantages**: Requires maintaining both prompt instructions and policy rules.
- **Consequences**: Discrepancies between AI and policy calculations must be logged.
- **Migration Trigger**: Retained as a core safety design pattern.
- **Review Date**: 2026-12-01

---

## ADR-012: Human Approval for Consequential Actions

- **Status**: Approved
- **Context**: Autonomous AI actions (like issuing fines or closing facilities) present legal and ethical risks.
- **Decision**: Require manual human sign-off before committing actions with legal consequences.
- **Alternatives**: Fully autonomous AI workflows (rejected due to regulatory limits).
- **Advantages**: Clear legal accountability and protection against AI errors.
- **Disadvantages**: Adds manual steps to workflows.
- **Consequences**: Review queues must be designed into dashboards.
- **Migration Trigger**: Maintain for all legal actions.
- **Review Date**: 2026-12-01

---

## ADR-013: Cloud Storage for Evidence

- **Status**: Approved
- **Context**: Case evidence requires durable, secure, and low-cost storage.
- **Decision**: Store all binary evidence (images, videos, PDF audits) in Google Cloud Storage.
- **Alternatives**: Database BLOB storage (rejected due to size limits and costs).
- **Advantages**: High durability, secure Signed URLs, and cost-efficient.
- **Disadvantages**: File updates require matching database sync logic.
- **Consequences**: File hashes must be verified against database records.
- **Migration Trigger**: Retain as standard storage layer.
- **Review Date**: 2026-12-01

---

## ADR-014: Evidence Hashing and Immutable History

- **Status**: Approved
- **Context**: Environmental cases must survive courtroom challenges. Evidence integrity is critical.
- **Decision**: Generate SHA-256 hashes of files on upload, locking database records to prevent modifications.
- **Alternatives**: Overwriteable file storage (rejected due to audit risks).
- **Advantages**: Clear chain of custody; prevents evidence tampering.
- **Disadvantages**: Increases storage usage since updates require saving new file versions.
- **Consequences**: Edits require saving a new file record linked to the previous version.
- **Migration Trigger**: Retained as core design pattern.
- **Review Date**: 2026-12-01

---

## ADR-015: Terraform for Infrastructure

- **Status**: Approved
- **Context**: Manual cloud configuration leads to drift across dev, staging, and production environments.
- **Decision**: Declare all Google Cloud resources in Terraform.
- **Alternatives**: Manual UI configuration (rejected due to drift risks).
- **Advantages**: Consistent environments and version-controlled infrastructure.
- **Disadvantages**: Requires Terraform training for developers.
- **Consequences**: No manual environment changes allowed in production.
- **Migration Trigger**: Retained as DevOps policy.
- **Review Date**: 2026-12-01

---

## ADR-016: Model Gateway for Gemini Integration

- **Status**: Approved
- **Context**: Direct SDK integrations spread prompt logic and key management throughout the codebase, making changes difficult.
- **Decision**: Route all AI requests through a central Model Gateway service.
- **Alternatives**: Direct API calls in local services (rejected due to code duplication).
- **Advantages**: Central prompt management, token tracking, and semantic caching.
- **Disadvantages**: Single point of failure for AI features.
- **Consequences**: Gateway performance must be monitored closely.
- **Migration Trigger**: Split gateway target if call volumes exceed 5,000 RPM.
- **Review Date**: 2026-12-01

---

## ADR-017: AI Execution Ledger as a Core Platform Capability

- **Status**: Approved
- **Context**: Debugging AI operations in production requires tracing inputs, outputs, and model configurations.
- **Decision**: Implement an append-only ledger logging every AI interaction.
- **Alternatives**: Standard application logging (rejected due to readability limits).
- **Advantages**: Clear audit trail, simple cost analysis, and production troubleshooting.
- **Disadvantages**: Database storage grows quickly with large prompt logs.
- **Consequences**: Table partitioning must be configured on logging tables.
- **Migration Trigger**: Archive logs older than 90 days to cold storage.
- **Review Date**: 2026-12-01

---

## ADR-018: Jurisdiction-Specific Policy Packs

- **Status**: Approved
- **Context**: GovOS AI targets multiple regions, each with different environmental laws.
- **Decision**: Isolate regulatory criteria, citation text, and penalty structures into configuration policy packs.
- **Alternatives**: Regional code forks (rejected due to code drift risks).
- **Advantages**: Clean single-codebase operations; new regions are onboarded by uploading policy packs.
- **Disadvantages**: Adds configuration parsing validation tasks.
- **Consequences**: Schema verifications must run on configuration uploads.
- **Migration Trigger**: Retained as core architecture standard.
- **Review Date**: 2026-12-01

---

## ADR-019: Regional Deployment Before Multi-Region Active-Active

- **Status**: Approved
- **Context**: High-availability setups require multi-region replication, which adds database sync challenges and high costs.
- **Decision**: Deploy single-region databases with automated failover and daily backups.
- **Alternatives**: Active-active multi-region deployment (rejected due to complexity and costs).
- **Advantages**: Simple architecture; reliable transaction commits.
- **Disadvantages**: Regional outages can cause temporary downtime.
- **Consequences**: RTO and RPO targets must be documented.
- **Migration Trigger**: Deploy to multi-region when SLA contracts require >99.99% availability.
- **Review Date**: 2026-12-01

---

## ADR-020: Extract Services Only After Measurable Need

- **Status**: Approved
- **Context**: Teams often split applications into microservices prematurely, leading to unnecessary operational overhead.
- **Decision**: Keep components inside the modular monolith until resource metrics or team sizes demand splitting.
- **Alternatives**: Early-stage microservice setup (rejected).
- **Advantages**: Development velocity is optimized during initial launch.
- **Disadvantages**: Refactoring boundaries later requires discipline.
- **Consequences**: Module imports must be audited regularly.
- **Migration Trigger**: Re-evaluate during annual architectural reviews.
- **Review Date**: 2026-12-01
