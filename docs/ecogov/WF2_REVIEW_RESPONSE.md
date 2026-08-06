# WF-2 Independent Enterprise Architecture Review Response

**Milestone**: WF-2 — GovOS Notification Platform
**Status**: Review Response
**Baseline Tag**: `wf-1-complete`
**Baseline Commit**: `5c3fcb16b2511eeb37de3f8f911de8188d9752d2`
**Date**: 2026-08-04

---

## Executive Summary & Decision

We have performed a production-grade enterprise architectural, security, database, operational, and release-readiness review of the proposed **GovOS Notification Platform (WF-2)**. The platform is designed to run in a multi-tenant government environment handling millions of notifications.

While the overall design is highly cohesive, reuses existing primitives (`task_execution`, `outbox_event`), and isolates tenant boundaries, we have identified critical vulnerabilities and architectural gaps that must be resolved prior to beginning implementation. These are classified below.

**Decision**: APPROVED WITH REQUIRED CHANGES

---

## Section 1: Detailed Findings

### P0 — Critical (Architecture/Security Blockers)

#### WF2-REV-01: Stuck `sending` State Transition in Crash Recovery (State Machine)
* **Description**: The delivery state machine does not define transitions from `sending` back to `queued` (or to `transient_failed` / `dead_lettered`) when a worker lease expires.
* **Risk**: If a worker crashes or loses network connectivity mid-send, the lease will expire, but database constraints will block the recovery sweeper from moving the row out of `sending` state. This creates permanent stuck/orphan records and blocks message delivery.
* **Recommendation**: Permit the transitions `sending --> queued` (re-queue for retry when pre-send status is proven) and `sending --> dead_lettered` (when outcome is unreconciled and ambiguous) in the transition validator triggers.
* **Affected Documents**: `docs/ecogov/WF2_DELIVERY_STATE_MACHINE.md`, `docs/ecogov/WF2_RETRY_AND_DEAD_LETTER_MODEL.md`
* **Implementation Impact**: State machine trigger code must explicitly support these recovery transitions.

---

### P1 — High (Must Revise Before Implementation)

#### WF2-REV-02: Cross-Tenant Child Reference Vulnerability (Database Model)
* **Description**: The database model does not mandate composite foreign keys containing `tenant_id` for child tables in the tenant hierarchy (such as `notification_recipient`, `notification_destination`, `notification_delivery`, `notification_delivery_attempt`, and `notification_inbox_item`).
* **Risk**: Single-column UUID foreign keys allow a record belonging to Tenant A to reference a parent record belonging to Tenant B if a bug in the application layer, SQL injection, or a malicious actor bypasses tenant checks, resulting in data leakage.
* **Recommendation**: Mandate composite foreign keys on all child tables. For example, `notification_delivery(tenant_id, request_id)` must reference `notification_request(tenant_id, id)`.
* **Affected Documents**: `docs/ecogov/WF2_DATABASE_MODEL.md`
* **Implementation Impact**: Migration 34 must define composite foreign keys across all parent-child tables.

#### WF2-REV-03: Missing Parent-Child Lineage for Replayed Requests (Auditability)
* **Description**: The `notification_request` schema does not define a `parent_request_id` or `replayed_from_request_id` column.
* **Risk**: When a dead-lettered request is replayed, a new request is created, but the lineage is lost. There is no database-level audit link connecting the replayed request to the original failed request.
* **Recommendation**: Add a nullable `parent_request_id UUID REFERENCES notification_request(id)` column to `notification_request` and populate it during replays.
* **Affected Documents**: `docs/ecogov/WF2_DATABASE_MODEL.md`, `docs/ecogov/WF2_RETRY_AND_DEAD_LETTER_MODEL.md`, `docs/ecogov/WF2_API_SPECIFICATION.md`
* **Implementation Impact**: Add the column in Migration 34, expose it in the API responses, and update the replay command.

#### WF2-REV-04: Failover Provider Policy Check Bypass (Multi-Tenancy & Security)
* **Description**: The failover rules allow automatic failover to the next provider in the route upon transient pre-send errors. However, there is no check that the fallback provider satisfies the same classification, data residency, and tenant-specific privacy constraints as the primary provider.
* **Risk**: A tenant's confidential notification could be silently routed through an unapproved fallback provider that violates data residency laws (e.g. EU data routed to US servers) or lacks proper encryption.
* **Recommendation**: Require that the failover engine re-evaluates all policy constraints (residency, classification, sender verification) for the fallback provider before dispatching.
* **Affected Documents**: `docs/ecogov/WF2_PROVIDER_MODEL.md`, `docs/ecogov/WF2_RETRY_AND_DEAD_LETTER_MODEL.md`
* **Implementation Impact**: The routing and failover service must apply the full policy filter to the fallback provider, not just pick the next index.

---

### P2 — Medium (Follow-up Improvements)

#### WF2-REV-05: Unconstrained High-Cardinality Rate Limit Bucket Table (Scalability)
* **Description**: Storing per-user or per-destination rate limit buckets in a standard relational table (`notification_rate_limit_bucket`) without a strict retention or partition strategy will result in millions of ephemeral rows, causing index bloat.
* **Risk**: Performance degradation under high-volume notification traffic. Slow rate-limiting checks due to bloated index scans.
* **Recommendation**: Limit per-user/destination buckets to short-lived cache systems, or if stored in PostgreSQL, implement a partition-by-range strategy by day and drop old tables aggressively, and use partial indexes for active buckets.
* **Affected Documents**: `docs/ecogov/WF2_DATABASE_MODEL.md`, `docs/ecogov/WF2_IMPLEMENTATION_PLAN.md`
* **Implementation Impact**: Refine rate limiter implementation to cache transient windows or use partitioning.

#### WF2-REV-06: Missing Keyset/Cursor Pagination for High-Volume Endpoints (Performance)
* **Description**: The API specification suggests pagination but does not enforce keyset pagination on high-volume delivery log endpoints.
* **Risk**: High database CPU utilization and timeout failures when querying historical notification logs with `LIMIT/OFFSET`.
* **Recommendation**: Enforce cursor-based keyset pagination (e.g. using `(created_at, id)`) on all high-volume log and inbox endpoints.
* **Affected Documents**: `docs/ecogov/WF2_API_SPECIFICATION.md`
* **Implementation Impact**: Expose `next_cursor` in responses and accept `cursor` query parameters in API routes.

#### WF2-REV-07: Insecure User-Identity and Membership Resolution Cache (Security)
* **Description**: The recipient resolution model does not specify caching controls for membership queries.
* **Risk**: Terminated employees could receive sensitive notifications if membership queries are cached with a long TTL after revocation.
* **Recommendation**: Membership queries must be executed directly against PostgreSQL (which is authoritative) within the request transaction, or if cached, must have a mandatory invalidation hook on the IAM membership/user status updates.
* **Affected Documents**: `docs/ecogov/WF2_RECIPIENT_RESOLUTION.md`
* **Implementation Impact**: Invalidate or bypass cache for critical security resolution checks.

#### WF2-REV-08: Missing Pinned Version Validation in Template Binding Rotation (Integrity)
* **Description**: When rotating default template bindings, the API does not verify that the target template version belongs to the same semantic key.
* **Risk**: Mismatched variables and rendering failures. The system trying to render an invoice template with variables intended for a workflow assignment notification.
* **Recommendation**: Add validation logic verifying that `template_version.template_id` matches the template bound by `semantic_key`.
* **Affected Documents**: `docs/ecogov/WF2_DATABASE_MODEL.md`, `docs/ecogov/WF2_API_SPECIFICATION.md`
* **Implementation Impact**: Enforce in binding logic.

---

### P3 — Low (Minor / Documentation)

#### WF2-REV-09: Unspecified Delivery Confirmation Timeout Window (Operational Readiness)
* **Description**: The time window for transitioning a delivery from `provider_accepted` to `expired` is not defined.
* **Risk**: Indefinite resource locking or memory retention if timeouts are not established.
* **Recommendation**: Document a standard 72-hour window for email and a 24-hour window for SMS/webhooks.
* **Affected Documents**: `docs/ecogov/WF2_DELIVERY_STATE_MACHINE.md`
* **Implementation Impact**: Configure default confirmation timeout in worker configuration.

---

## Section 2: Review Area Analysis

### 1. Database Model
* **Normalisation & FKs**: Normalisation is solid. Relational tables are mapped clean. Composite FKs must be enforced as per `WF2-REV-02` to prevent tenant cross-contamination.
* **Soft Deletes & Archival**: The system relies on status transitions rather than soft deletes, which preserves compliance audit evidence. Crypto-erasure of bodies after 30 days is excellent.

### 2. Delivery State Machine
* **Transitions**: Correctly separates request aggregates and channel delivery. Resolves crash recovery stuck states by adding `sending --> queued` and `sending --> dead_lettered` transitions (`WF2-REV-01`).

### 3. Retry Strategy
* **Exponential Backoff**: Configured with full jitter capped at 15 minutes, which is robust.
* **Lease Fencing**: Fencing tokens are correctly propagated to prevent concurrent updates from stale workers.

### 4. Recipient Resolution
* **Isolation**: Blocks cross-tenant and cross-org fallback. Recipient snapshots are frozen in the database at resolution time, which protects against membership drift during retries.

### 5. Template Versioning
* **Immutability**: Draft candidate validation and triggers preventing published edits are sound. logic-less interpolation prevents dynamic code execution.

### 6. Provider Model
* **SMTP/SMS/Webhook**: Normalised error classification mapping. Webhook egress dynamic DNS rebinding checks and private IP SSRF blocks are mandatory.

### 7. REST APIs
* **Idempotency**: Unique `(tenant_id, producer_namespace, idempotency_key)` is race-safe. Keyset pagination is required for high-volume logs (`WF2-REV-06`).

### 8. Security
* **SSRF & DNS Rebinding**: Protection mechanisms are robust but must disable client-side DNS caching to prevent mid-flight IP re-mapping.

### 9. Operational Readiness
* **Structured Logging**: Emits opaque IDs and hashes only; body text and raw destinations are redacted from log outputs.

### 10. Rollback Safety
* **Migration 34**: Additive changes ensure compatibility with old binaries if application rollbacks occur.

---

## Section 3: Cross-Document Validation Results

1. **State Machine vs. Retry Model**: The retry model refers to recovery from `sending` timeouts, but the state machine did not permit transitions out of `sending` state. This contradiction is resolved by adding the `sending --> queued/dead_lettered` transitions.
2. **API vs. Database Model**: The database model lists `deduplication_record`, but the API specification did not define parent lineage for replayed requests. Exposing `parent_request_id` resolves this mismatch.

---

## Final Review Decision

APPROVED WITH REQUIRED CHANGES

*The implementation team is authorized to proceed to drafting Migration 000034 and preparing the V2 implementation plan incorporating these required changes.*
