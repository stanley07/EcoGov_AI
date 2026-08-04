# WF-2 Independent Review Acceptance

Status: All independent-review findings accepted and incorporated

Baseline: `wf-1-complete` (`5c3fcb16b2511eeb37de3f8f911de8188d9752d2`)

Date: 2026-08-04

## Decision

The WF-2 architecture accepts every finding in `WF2_REVIEW_RESPONSE.md`, including P0, P1, P2, and P3. The authoritative architecture package and `WF2_IMPLEMENTATION_PLAN_V2.md` now contain the required corrections. This document authorizes no code or migration by itself; implementation remains governed by the engineering framework and revised plan.

## Finding dispositions

### WF2-REV-01 — Stuck `sending` recovery (P0)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DELIVERY_STATE_MACHINE.md`, `WF2_RETRY_AND_DEAD_LETTER_MODEL.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`, `WF2_ROLLBACK_STRATEGY.md`, ADR-005.
- Architectural change: permits fenced reconciliation transitions `sending -> queued`, `sending -> provider_accepted`, `sending -> delivered`, `sending -> expired`, and `sending -> dead_lettered`. Confirmed non-acceptance is retry-eligible only after policy/budget checks; ambiguous outcomes dead-letter. Expired leases are swept in bounded tenant-fair batches, and no `sending` row lacks a due recovery action.
- Implementation impact: migration transition guards and worker recovery must implement provider reconciliation, fencing, recovery budgets, history, and operational alerts.

### WF2-REV-02 — Composite tenant foreign keys (P1)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DATABASE_MODEL.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`.
- Architectural change: every tenant-owned parent/child relationship now requires `(tenant_id,id)` parent uniqueness and a tenant-qualified composite FK. The model includes an explicit matrix for recipients, destinations, deliveries, attempts, history, policies, preferences, routes, webhook records, dedupe, inbox, replay, task, and outbox references. Single-column UUID child FKs are forbidden.
- Implementation impact: migration 34 must create the composite keys/FKs and preflight any required unique keys on reused tables.

### WF2-REV-03 — Replay lineage (P1)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DATABASE_MODEL.md`, `WF2_RETRY_AND_DEAD_LETTER_MODEL.md`, `WF2_API_SPECIFICATION.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`, ADR-005.
- Architectural change: `notification_request.parent_request_id` is a nullable same-tenant composite self-reference to the immediate replay source. Replay preserves root ancestry and bounded depth, creates new request/correlation/idempotency identities, records the replay command and parent correlation, and appends audit/history to both parent and child.
- Implementation impact: migration, replay command, API list/detail/replay response, audit/history, cycle/depth guards, and lineage tests must be added.

### WF2-REV-04 — Failover policy re-evaluation (P1)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_PROVIDER_MODEL.md`, `WF2_RETRY_AND_DEAD_LETTER_MODEL.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`, ADR-005.
- Architectural change: route order is only candidate order. Before every failover the engine reruns residency, classification, tenant policy, organization policy, channel/sender/endpoint ownership, secret/key status, provider capability/health, security, rate/cost, expiry, recipient eligibility, and suppression checks. An empty eligible set fails closed.
- Implementation impact: the routing service cannot carry primary-provider eligibility into fallback selection; it must record redacted per-candidate rejection evidence.

### WF2-REV-05 — Rate-limit scalability (P2)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DATABASE_MODEL.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`.
- Architectural change: transient PostgreSQL buckets are daily range-partitioned by `window_start`, tenant-qualified, actively indexed only for current windows, retained 7 days by default, and created/dropped by a bounded leased/fenced maintenance task. Aggregated non-PII metrics use separate 90-day retention. An approved cache may serve high-cardinality checks, with PostgreSQL as fail-closed fallback.
- Implementation impact: migration partition DDL, maintenance worker, alerts, load tests, and retention evidence are required.

### WF2-REV-06 — High-volume keyset pagination (P2)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_API_SPECIFICATION.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`.
- Architectural change: requests, deliveries, dead letters, and inbox use keyset pagination ordered by `(created_at DESC,id DESC)`, with opaque versioned/filter-bound cursors and bounded limits. Offset is forbidden for these resources.
- Implementation impact: query/index design, cursor validation, response `nextCursor`, concurrent-insert stability, and pagination tests are required.

### WF2-REV-07 — Identity-cache invalidation (P2)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_RECIPIENT_RESOLUTION.md`, `WF2_SECURITY_MODEL.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`, ADR-005.
- Architectural change: caches hold non-authoritative candidates only. IAM user/membership/role/organization and destination changes issue immediate tenant-qualified invalidation. Transactional PostgreSQL validation at resolution and just before external delivery remains mandatory whenever freshness cannot be proven; stale eligibility suppresses rather than retargets.
- Implementation impact: IAM after-commit invalidation hooks, tenant-qualified cache eviction, bounded TTL, transactional resolver queries, just-in-time worker revalidation, and failure-path tests are required.

### WF2-REV-08 — Template binding semantic integrity (P2)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DATABASE_MODEL.md`, `WF2_API_SPECIFICATION.md`, `WF2_TEMPLATE_VERSIONING.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`.
- Architectural change: rotation locks the binding and candidate version and verifies that the candidate's parent template owns the exact `(application_key,semantic_key)`, is published, and has compatible tenant/catalog ownership before atomic default rotation.
- Implementation impact: database/service guards and negative mismatch/concurrency tests are required.

### WF2-REV-09 — Delivery confirmation timeout (P3)

- Acceptance: **ACCEPTED**.
- Affected documents: `WF2_DELIVERY_STATE_MACHINE.md`, `WF2_IMPLEMENTATION_PLAN.md`, `WF2_IMPLEMENTATION_PLAN_V2.md`, `WF2_VERIFICATION_CHECKLIST.md`.
- Architectural change: default confirmation windows are 72 hours for email and 24 hours for SMS/webhook. Expiry records evidence and never automatically resends. In-app delivery completes transactionally and has no confirmation wait.
- Implementation impact: channel policy defaults, scheduler/reconciliation behavior, deterministic-clock tests, metrics, and evidence are required.

## Cross-document consistency confirmation

The revised package uses these canonical terms consistently:

- delivery recovery: `sending` reconciliation, never blind retry;
- retry classifications: `transient`, `rate_limited`, `permanent`, `suppressed`, `unknown`, `dead_lettered`;
- replay lineage: `parent_request_id` in storage and `parentRequestId`, `rootRequestId`, `replayDepth` in APIs;
- failover: complete policy re-evaluation for every candidate;
- pagination: `(created_at,id)` keyset cursor for requests, deliveries, dead letters, and inbox;
- recipient cache: non-authoritative candidate cache with immediate IAM invalidation and transactional database validation;
- binding integrity: exact `(application_key,semantic_key)` parent-template match;
- confirmation windows: 72 hours email, 24 hours SMS/webhook.
- compatibility retirement: `notification.compatibility.invitation.legacy_fallback_count` increments once per legacy payload with bounded, non-sensitive labels;
- rate algorithm: token bucket or sliding window, never fixed-window boundary reset, with daily transient partitions and bounded cleanup.

Table names, permission names, state vocabulary, retry terminology, replay terminology, and failover terminology were checked across ADR-005 and all WF-2 architecture documents. No source, test, migration, or database change is part of this revision.
