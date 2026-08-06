# WF-2 Independent Implementation Review

**Repository:** `C:\Users\USER\Desktop\EcoGov_AI`
**Branch reviewed:** `codex/implementation`
**Review date:** 2026-08-05
**Review type:** Implementation review only
**Decision:** **NOT APPROVED FOR PRODUCTION**

## Executive summary

No P0 issue was confirmed because the present implementation cannot pass its migration/runtime contract and is not production-deployable. Thirteen P1 findings and two P2 findings remain. The largest release blockers are an incomplete/non-rerunnable Migration 34, missing tenant-safe constraints, absent template catalog guards, a second delivery queue that bypasses `task_execution`, unsafe webhook dispatch, a callback implementation whose SQL does not match the migration, incomplete authorization/recipient resolution, secret and PII exposure, and missing WF-1/legacy integration and verification evidence.

The required approval statement cannot be made. WF-2 is not production-ready.

## Review method and evidence

The review compared the working-tree implementation with the listed V3 architecture and supporting specifications. It inspected Migration 34, notification infrastructure/providers, API registration/routes, worker startup, RBAC changes, domain contracts, legacy invitation paths, and notification tests.

Read-only verification performed:

- `git diff --check`: passed, with line-ending warnings only.
- `npm.cmd run typecheck`: failed with TypeScript project/test errors; exit code 1.
- `docs/ecogov/WF2_EVIDENCE.md`: absent.
- Migration/test execution was not attempted because the migration is visibly non-rerunnable and the focused tests are destructive against the configured database. This review did not mutate the database.

## P1 findings

### P1-01 — Migration 34 is neither idempotent nor aligned with its runtime consumers

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`
- `apps/api/src/routes/notifications.ts`
- `packages/infrastructure/src/notifications/providers/registry.ts`

**Architectural requirement**

Migration 34 must be additive, idempotent, checksum-safe, rerunnable through the official runner, and must define the exact columns consumed by the API and worker.

**Implementation gap**

The migration uses unconditional `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, and `CREATE TRIGGER`; a second execution fails rather than applying zero. The callback route selects `provider`, `signature_verification_enabled`, and `signature_secret`, inserts `callback_endpoint_id`, `provider`, and `payload`, queries `notification_delivery.provider_message_id`, and writes `notification_delivery_status_history.provider_callback_id`. None of those columns exist under those names in Migration 34. The migrated names are `provider_key`, `encrypted_signing_secret`, `endpoint_id`, and `raw_payload_redacted`, while provider message IDs exist only on attempts.

**Risk**

The official migration rerun gate fails, and callback processing deterministically returns database errors even after an initial migration succeeds.

**Exact bounded remediation**

Make Migration 34 official-runner idempotent using the repository's established guarded-DDL pattern; reconcile every callback/delivery/history query to one approved schema vocabulary; add a migration-contract test that applies 34, reruns with zero applied, and executes prepared SQL for every runtime query.

### P1-02 — Required tenant-qualified foreign keys and organization relationships are missing

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

Every tenant-owned child reference must include `tenant_id`; organization-scoped rows must use tenant-safe organization FKs. Replay ancestry, routes, entries, callbacks, webhook challenges, dedupe records, inbox rows, and audit/history must not admit cross-tenant/orphan relationships.

**Implementation gap**

`notification_request.parent_request_id` is a single-column FK. Provider route entries have no `tenant_id` and reference routes by ID only. Callback rows reference endpoints by ID only. Webhook challenges reference endpoints by ID only. Deduplication records reference requests by ID only. Provider callback endpoints have no tenant-qualified route relationship. Inbox rows omit request and organization references. Audit rows omit organization/correlation/result constraints. Several entities required by the exact model have only partial keys or no ownership relationship.

**Risk**

Database writes can create tenant-inconsistent lineage and operational records; application predicates become the only isolation barrier, and orphan/misattributed evidence can survive retries and replay.

**Exact bounded remediation**

Add the V3 composite parent keys and tenant-leading FKs to every listed relationship, including same-tenant replay ancestry; add organization FKs where the model requires organization scope; add negative SQL tests for every cross-tenant and cross-organization reference; require final invariant SQL to return zero.

### P1-03 — The V3 dual template-reference and publication invariants are not enforced

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`
- `packages/infrastructure/src/notifications/intake.ts`

**Architectural requirement**

Catalog references require a restricted trigger proving global platform/application ownership, published status, and exact application/semantic identity. Tenant references must remain same-tenant. Request acceptance must lock and pin the active effective binding and selected immutable version.

**Implementation gap**

The exact-one checks and tenant-version composite FK exist, but the required catalog guard trigger does not. Bindings do not store `application_key`; catalog/tenant scope and semantic ownership are not proven. Intake joins either version by single `id`, does not require version status `published`, ignores `effective_from/effective_to`, does not lock binding/version rows, and returns a generic error rather than `WF_BINDING_MISSING` 422.

**Risk**

A tenant binding or request can pin a draft, deprecated, semantically unrelated, or incorrectly scoped catalog version. Concurrent rotation can produce acceptance against evidence that was never valid atomically.

**Exact bounded remediation**

Install the approved restricted catalog constraint trigger on both binding and request; persist and verify exact `(application_key, semantic_key)` ownership; enforce effective dates and published state; lock binding then candidate version during acceptance; add all 13 V3 template-reference/binding tests, including concurrent mismatch cases.

### P1-04 — Published template content is still mutable

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`
- `packages/infrastructure/src/notifications/template-validator.ts`

**Architectural requirement**

Published/deprecated definitions and renderings are immutable; only the approved lifecycle transition is allowed. Publication uses bounded deterministic validation and rendering with a pinned content hash.

**Implementation gap**

The version trigger compares only selected fields during `published -> deprecated`, allowing unapproved changes to lifecycle/actor timestamps and other columns in the same update. Rendering protection blocks update/delete but permits inserting a new rendering under an already published version. No trigger enforces the complete lifecycle. The validator accepts absent/invalid schemas, ignores unknown variables and most bounds/types, and there is no deterministic renderer or publication service.

**Risk**

Previously accepted requests cannot reproduce or audit the content they were approved to deliver, and executable/oversized or undeclared template inputs are not governed.

**Exact bounded remediation**

Replace the partial comparison with a restricted immutability trigger covering every frozen column and lifecycle transition; reject rendering insert/update/delete when the parent is published/deprecated; implement the approved bounded validator/renderer and exact-hash publication command; add mutation and validator negative tests.

### P1-05 — Recipient resolution and organization isolation do not implement the approved selector rules

**Affected files**

- `packages/infrastructure/src/notifications/intake.ts`
- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

Only `direct_user`, `direct_destination`, `role`, `organization`, `workflow_work_item`, and `escalation_target` are allowed. Resolution must prove active tenant, organization, user, membership, role, verified destination, policy allowlist, bounded fan-out, and pre-delivery revalidation.

**Implementation gap**

The implementation adds unapproved `tenant_administrator` and `webhook_endpoint` selectors, omits workflow-work-item and escalation-target behavior, accepts direct user IDs without active membership/organization validation, resolves roles by role name across a tenant rather than approved role ID within an organization, and broadcasts organization membership without approved audience roles. It fabricates `+15550000000` for users without phone data and stores webhook URLs supplied through recipient paths. There are no fan-out bounds, active-tenant checks, verified-destination checks, cache invalidation contract, or pre-send eligibility revalidation.

**Risk**

Notifications can be sent to inactive, unauthorized, cross-organization, fabricated, or over-broad recipients. The fabricated SMS destination is a direct correctness and privacy incident risk.

**Exact bounded remediation**

Restrict the discriminator to the six approved selectors; implement each selector's tenant/org-leading transactional query and fail-closed empty behavior; remove fabricated destinations and require verified contact records; enforce direct-recipient permission, fan-out bounds, deterministic dedupe, immutable decision evidence, and pre-delivery revalidation; add selector isolation tests.

### P1-06 — Permission enforcement and API boundaries are incomplete and bypass approved controls

**Affected files**

- `apps/api/src/routes/notifications.ts`
- `apps/api/src/app.ts`
- `modules/govos-core/src/rbac.ts`
- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

Every endpoint requires its exact canonical permission, active session/membership, tenant/org predicates, expected version, idempotency, reason/MFA where required, and safe error contracts. Approved role mappings are exact; no role-name/static shortcut may broaden them.

**Implementation gap**

Only request intake and two inbox operations are implemented. Intake accepts caller recipients, `classification='emergency'`, and direct destinations with only `notification:request:create`; it does not require direct/emergency permissions, `Idempotency-Key`, schema validation, organization authorization, or the canonical `/v1/notifications/requests` contract. Runtime RBAC grants notification permissions directly to static `super_admin`, while Migration 34 seeds one fixed tenant and two hard-coded role IDs rather than the approved role manifest. Errors expose raw exception messages and use non-canonical statuses/shapes.

**Risk**

Tenant actors can invoke privileged recipient/emergency behavior without the required authority, and hard-coded mappings can grant the wrong tenant roles or fail on real deployments.

**Exact bounded remediation**

Implement only the approved endpoint inventory with exact middleware permissions and ownership checks; enforce direct/emergency/replay/rotation controls separately; use database-resolved approved mappings rather than static role shortcuts or fixed tenant/role IDs; add the full positive/negative permission matrix and generic-error tests.

### P1-07 — The worker creates a second queue and does not enforce the approved lease/fencing protocol

**Affected files**

- `packages/infrastructure/src/notifications/worker.ts`
- `packages/infrastructure/src/notifications/providers/registry.ts`
- `apps/worker/src/server.ts`
- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

`task_execution` is the sole delivery work queue with 60-second leases, 20-second heartbeat, monotonic fencing, deterministic task identity, bounded tenant-fair claiming, graceful cancellation, and fenced recovery.

**Implementation gap**

The worker claims `notification_delivery` directly, uses a five-minute lease, creates no `task_execution` record/link, has no heartbeat or cancellation, and processes a globally ordered five-row batch without tenant fairness. Although it increments a local fencing token, no send, state update, heartbeat, completion, or failure query checks lease owner, fencing token, tenant, state, or unexpired lease. It never transitions to `sending` and has no expired-`sending` reconciliation sweeper.

**Risk**

Lease expiry or worker restart can produce concurrent external sends and stale state commits; stuck/ambiguous outcomes are blindly retried or stranded, violating a V3 stop condition.

**Exact bounded remediation**

Route every delivery through deterministic `task_execution`; use the existing 60/20-second leased/fenced helpers and exact task identity; make all mutations compare tenant/task/owner/fence/state/lease; implement bounded tenant-fair batches and the approved recovery/reconciliation states; add concurrent stale-owner, lease-loss, restart, and double-delivery tests.

### P1-08 — Provider execution, attempts, retries, and transactions are not deterministic or atomic

**Affected files**

- `packages/infrastructure/src/notifications/providers/contract.ts`
- `packages/infrastructure/src/notifications/providers/registry.ts`
- `packages/infrastructure/src/notifications/providers/email.ts`
- `packages/infrastructure/src/notifications/providers/sms.ts`
- `packages/infrastructure/src/notifications/worker.ts`

**Architectural requirement**

Providers implement the approved versioned contract; routes are pinned and fail closed; attempts/history/state are transactional and fenced; classifications drive bounded jitter/retry/failover; unknown outcomes never become ordinary transient retries.

**Implementation gap**

The provider contract contains only `send`. Registry resolution silently falls back to `system-<channel>` when no route exists. Email/SMS are random mock implementations. Provider invocation occurs before an attempt is durably recorded. `pool.query('BEGIN')` is used without a dedicated client, so subsequent pool queries are not guaranteed to share a transaction. `ambiguous` maps to `transient_failed`; backoff has no full jitter or bounded `Retry-After`; route snapshots, eligibility rechecks, failover position, expiry, provider idempotency, confirmation windows, and reconciliation are absent. History sequence uses unsafe `MAX()+1` concurrency.

**Risk**

External side effects can occur without durable evidence, ambiguous sends can duplicate, transactions can partially commit, and concurrent history/attempt inserts can conflict or lose ordering.

**Exact bounded remediation**

Implement the approved adapter contract and route snapshot; fail closed on empty routes; persist fenced `sending`/attempt evidence before invocation using one checked-out client; classify outcomes exactly, preserving unknown reconciliation; implement bounded jitter/retry/failover and atomic sequence allocation; add crash-point and concurrent ordering tests.

### P1-09 — Outbound webhook SSRF and signing controls are bypassable

**Affected files**

- `packages/infrastructure/src/notifications/ssrf-webhook.ts`
- `packages/infrastructure/src/notifications/providers/webhook.ts`
- `packages/infrastructure/src/notifications/intake.ts`

**Architectural requirement**

Webhook delivery requires verified HTTPS ownership, URL normalization, all-address validation on every attempt, private/reserved/metadata IPv4/IPv6 blocking, socket pinning to the verified address with TLS SNI/hostname verification, disabled redirects, bounded bodies/timeouts, timestamp/nonce/key-ID signing, and safe retry classification.

**Implementation gap**

HTTP is accepted. Only one `dns.lookup` result is checked, with an incomplete address denylist. `fetch(url)` performs a separate unpinned resolution and follows redirects by default, so DNS rebinding and redirect SSRF remain possible. Redirect responses are treated as success. The payload signature has no timestamp, nonce, or key ID, and arbitrary direct-destination URLs bypass endpoint ownership verification.

**Risk**

An authorized request producer can cause the worker to access internal, metadata, loopback/reserved IPv6, or redirect targets, and webhook recipients cannot safely prevent replay.

**Exact bounded remediation**

Use only active verified HTTPS endpoint records; resolve and validate every returned address immediately before each attempt; connect to a selected validated address while retaining TLS hostname/SNI; disable redirects or repeat the full validation; implement canonical timestamp/nonce/key-ID signatures and replay bounds; add DNS-rebinding, redirect, metadata, and IPv6 tests.

### P1-10 — Provider callback authentication, replay protection, and routing are unsafe and nonfunctional

**Affected files**

- `apps/api/src/routes/notifications.ts`
- `apps/api/src/app.ts`
- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

Opaque endpoint lookup must preselect one tenant/provider/adapter/key context; signature verification uses the raw body in constant time; timestamp/nonce replay checks precede parsing/state lookup; delivery mutation uses tenant/provider/message CAS; all failures return indistinguishable generic responses.

**Implementation gap**

In addition to the schema mismatch in P1-01, the code accepts the literal signature `mock-valid-signature`, reconstructs JSON instead of using raw bytes, performs a normal string comparison, has no timestamp/skew/nonce reservation, stores the full callback payload, defaults absent message/status fields, and returns distinguishable 401/404/500 responses. Delivery mutation is not a legal transition CAS and provider ownership is not included in lookup.

**Risk**

Once schema names are reconciled, forged/replayed callbacks could mutate delivery state or disclose endpoint validity; currently the route is operationally broken.

**Exact bounded remediation**

Remove all mock bypasses; preserve raw request bytes; preselect the active endpoint/key/adapter; verify constant-time signature, timestamp, and nonce before parsing; store only approved hashes/redacted metadata; lookup and CAS by tenant/provider/message/current state; return one generic response; add every V3 callback negative/race test.

### P1-11 — Secret handling and PII protections violate the approved boundary

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`
- `packages/infrastructure/src/notifications/encryption.ts`
- `packages/infrastructure/src/notifications/providers/registry.ts`
- `packages/infrastructure/src/notifications/providers/email.ts`
- `packages/infrastructure/src/notifications/providers/sms.ts`
- `packages/infrastructure/src/notifications/providers/development.ts`
- `apps/api/src/routes/notifications.ts`

**Architectural requirement**

Database rows hold opaque secret/key references, not credentials. Decryption is JIT in least-privilege workers. Raw destinations, bodies, tokens, callback payloads, and secrets never enter logs/errors/ordinary reads. Development defaults cannot become credential material.

**Implementation gap**

Provider, callback, and webhook tables store encrypted configuration/secrets directly rather than references. A deterministic built-in development key is used when `ENCRYPTION_KEY` is absent. Registry tries tenant decryption and then a global `system` key. Email/SMS log plaintext destinations. Callback intake stores the entire payload and returns raw database/error messages. The development adapter supplies a dummy activation URL and fallback key material.

**Risk**

Destinations, notification variables, tokens, and credential material can leak through logs/database/error responses, and development fallback encryption does not provide tenant-grade confidentiality.

**Exact bounded remediation**

Replace stored secrets/configuration with approved secret-manager references and key versions; remove built-in/global fallback keys; limit JIT decrypt to workers; mask all logs and genericize errors; hash/redact callback evidence; preserve the existing protected mailbox contract without dummy tokens; add secret/PII log, API, task, audit, and database scans.

### P1-12 — Required notification capabilities and WF-1/legacy compatibility are absent

**Affected files**

- `apps/worker/src/executors/sendInvitationExecutor.ts`
- `apps/worker/src/server.ts`
- `apps/api/src/routes/organizations.ts`
- `apps/api/src/routes/tenant-iam.ts`
- `modules/govos-core/src/platform-admin/tenant-provisioning-service.ts`
- `packages/infrastructure/src/notifications/`
- `apps/api/src/routes/notifications.ts`

**Architectural requirement**

Legacy invitation execution must delegate to the canonical request/delivery path with equivalence telemetry. Approved outbox mappings must support WF-1 assignment, SLA reminder, breach/escalation, completion, and cancellation without changing workflow ordering. Policies, suppression, dedupe, rate limiting, dead-letter replay, administrative APIs, and operational evidence are required WF-2 scope.

**Implementation gap**

Existing invitation producers and `SendInvitationExecutor` remain on the old direct mailbox/no-op path; there is no canonical adapter or `notification.compatibility.invitation.legacy_fallback_count`. No outbox intake consumer or WF-1 mapping exists. The rate-limit table has no runtime use, partitioning, retention worker, or atomic algorithm. Dead-letter preview/replay, request cancellation/history, template/policy/provider/webhook administration, operations dashboards, preference APIs, audit commands, and rollout flags are absent.

**Risk**

The implementation does not deliver the approved reusable platform, WF-1 notifications, compatibility guarantees, operational recovery, or controlled rollout. Activating it would create two behaviorally different notification paths.

**Exact bounded remediation**

Complete only the approved implementation-plan phases: canonical legacy adapter and telemetry; versioned outbox mappings; policy/suppression/dedupe/rate/dead-letter services; exact admin/operations APIs; and per-tenant/channel/event feature flags. Prove invitation and WF-1 equivalence before retiring or activating any path.

### P1-13 — Verification, rollback evidence, and production gates are not satisfied

**Affected files**

- `packages/testing/src/notifications.test.ts`
- `packages/testing/src/iam-cross-tenant-remediation.test.ts`
- generated `*.tsbuildinfo` and `scripts/iam/*.{js,map,d.ts,d.ts.map}` working-tree files
- missing `docs/ecogov/WF2_EVIDENCE.md`

**Architectural requirement**

Migration apply/no-op/rollback/reapply, all focused V3 security/concurrency/compatibility tests, full sequential suite, workspace TypeScript/builds, invariant SQL, secret/generated-file scans, rollback drill, and evidence must pass before production approval.

**Implementation gap**

The single WF-2 test file contains five broad integration tests and does not cover the V3 template references, cross-tenant/org constraints, permission matrix, callbacks, fencing, races, retries, legacy/WF-1 equivalence, rollback, or invariant SQL. Its cleanup disables many triggers and does not restore them in a `finally` path if cleanup fails. The root TypeScript build fails. Evidence is absent. Generated build artifacts are present in the working tree, including modified `tsbuildinfo` files and emitted IAM JavaScript/declaration/map files.

**Risk**

Release claims cannot be reproduced, destructive tests can pollute shared database state, and unverified security/concurrency defects can reach production.

**Exact bounded remediation**

Add the complete checklist suites with isolated schemas/databases or guaranteed sequential cleanup in `finally`; make all TypeScript/build gates pass; run official migration and rollback rehearsals; execute invariant, secret, PII, dependency, and generated-file scans; remove generated artifacts from the candidate change; produce `WF2_EVIDENCE.md` with exact commands/totals/checksums and independent-review dispositions.

## P2 findings

### P2-01 — Inbox API and lifecycle do not match the approved contract

**Affected files**

- `apps/api/src/routes/notifications.ts`
- `packages/database/migrations/000034_notification_platform.sql`
- `packages/infrastructure/src/notifications/providers/in-app.ts`

**Architectural requirement**

Inbox endpoints live under `/v1/notifications`, use keyset pagination and exact POST commands with expected version/idempotency, enforce legal state transitions, and expose only sanitized/classification-approved content.

**Implementation gap**

Routes are `/notifications/inbox` with `PATCH` actions, fixed `LIMIT 50`, no cursor, no `If-Match`/idempotency, no unread/read-all/detail commands, and no version increment/CAS. The in-app provider inserts rendered content without a unique tenant/delivery constraint or sanitization/classification gate.

**Risk**

Concurrent actions can overwrite each other, pagination is unstable, duplicate inbox items can be created, and unsafe content can reach users.

**Exact bounded remediation**

Implement the exact API paths/methods/cursor contract, versioned state commands and ownership predicates; add unique `(tenant_id, delivery_id)`; sanitize and classification-filter before persistence; add duplicate/concurrency/pagination tests.

### P2-02 — Data model omits required bounded operational metadata and indexes

**Affected files**

- `packages/database/migrations/000034_notification_platform.sql`

**Architectural requirement**

The exact model requires route versions/hashes, retry/expiry/task identities, attempt fencing and route position, callback replay metadata, audit correlation, rate-window partitioning, retention metadata, and indexes for bounded worker/API operations.

**Implementation gap**

The migration defines reduced rows without many of these fields. Rate buckets are unpartitioned and lack a unique atomic bucket identity. Due-work indexing omits tenant/fairness dimensions. Callback replay-window cleanup, active binding effective-time lookup, provider message correlation, attempt uniqueness, and dead-letter operational indexes are absent.

**Risk**

Even after functional fixes, high-volume operations can scan or race, evidence cannot reproduce routing/retry decisions, and transient rate data grows without bounded cleanup.

**Exact bounded remediation**

Conform Migration 34 to the exact entity columns and supporting indexes in `WF2_DATABASE_MODEL.md`; implement daily rate partitions and seven-day cleanup; add uniqueness for attempts/buckets/callback identities; verify query plans and bounded batch performance with representative fixtures.

## Production-readiness conclusion

WF-2 implementation is **not approved for production**. No commit or push was performed, and no implementation file was modified by this review. Production approval requires remediation and evidence for every P1 finding, followed by a new independent implementation review. P2 findings must be resolved before general availability because both affect correctness and bounded operation, although they are not the primary release blockers.
