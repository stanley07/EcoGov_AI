# WF-2 Implementation Review Response

**Repository:** `C:\Users\USER\Desktop\EcoGov_AI`
**Branch:** `codex/implementation`
**Review Date:** 2026-08-05

This document tracks the independent validation, reproduction evidence, architectural requirements, and remediations for all findings listed in `docs/ecogov/WF2_IMPLEMENTATION_REVIEW.md`.

---

## 1. P1 Findings Validation

### P1-01 — Migration 34 is neither idempotent nor aligned with its runtime consumers

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Idempotent, rerunnable schema migrations aligned with runtime code.
- **Evidence:**
  - `000034_notification_platform.sql` uses unconditional `CREATE TABLE` and `CREATE INDEX` without `IF NOT EXISTS` guards, causing subsequent execution to throw errors.
  - Runtime queries in `apps/api/src/routes/notifications.ts` reference mismatching columns: e.g., querying `provider` and `signature_secret` instead of `provider_key` and `encrypted_signing_secret`.
- **Affected Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
  - `apps/api/src/routes/notifications.ts`
  - `packages/infrastructure/src/notifications/providers/registry.ts`
- **Required Fix:**
  - Restructure DDL statements in Migration 34 using `IF NOT EXISTS` constraints.
  - Reconcile database query fields in routing and registry modules to match the schema definitions (`provider_key`, `encrypted_signing_secret`, `endpoint_id`, `raw_payload_redacted`).
- **Required Verification:** Rerun Migration 34 on an active database to verify zero-op success; run query compatibility tests.
- **Final Severity:** `P1`

---

### P1-02 — Required tenant-qualified foreign keys and organization relationships are missing

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Multi-tenant schemas must enforce composite foreign keys including `tenant_id` to prevent cross-tenant leakages.
- **Evidence:**
  - `notification_request.parent_request_id` references `notification_request(id)` but lacks validation of the tenant boundary (i.e. composite key reference on `(tenant_id, parent_request_id)`).
  - `notification_provider_route_entry` and `notification_inbox_item` omit tenant/organization qualified constraint paths.
- **Affected Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
- **Required Fix:** Add composite keys and leading `tenant_id` FK constraints to every child relationship (parent-child requests, routes entries, callbacks, and deduplication tables).
- **Required Verification:** Run negative SQL insertion tests attempting to link records across different tenants.
- **Final Severity:** `P1`

---

### P1-03 — The V3 dual template-reference and publication invariants are not enforced

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Request intake must enforce published version locks and validate binding constraints within the active date range.
- **Evidence:**
  - `intake.ts` joins version by single `id`, ignores version status, ignores `effective_from/effective_to` dates, and fails to transactionally lock binding/version rows during intake.
- **Affected Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
  - `packages/infrastructure/src/notifications/intake.ts`
- **Required Fix:** Enforce `published` version checks, date range active windows, and lock binding/version rows in `intake.ts`. Add a platform-level catalog trigger to validate catalog version binds.
- **Required Verification:** Integration tests verifying that requesting draft, expired, or missing template versions returns a validation error.
- **Final Severity:** `P1`

---

### P1-04 — Published template content is still mutable

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Published/deprecated templates and renderings must be immutable.
- **Evidence:**
  - `protect_immutable_template_version` only restricts updates to selected columns, permitting modification of other version attributes.
  - Rendering trigger allows inserts under published versions.
- **Affected Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
  - `packages/infrastructure/src/notifications/template-validator.ts`
- **Required Fix:** Update mutation triggers to block any update/delete of templates or insert/update/delete of renderings once the version status is `'published'` or `'deprecated'`.
- **Required Verification:** Assert database exceptions are thrown when attempting DML on rendering or version tables for published templates.
- **Final Severity:** `P1`

---

### P1-05 — Recipient resolution and organization isolation do not implement the approved selector rules

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Confine recipient types to the six approved selector blocks and enforce active membership boundaries.
- **Evidence:**
  - `intake.ts` supports unapproved selectors `tenant_administrator` and `webhook_endpoint`.
  - It generates fallback data `+15550000000` for users without active phone records.
- **Affected Files:**
  - `packages/infrastructure/src/notifications/intake.ts`
- **Required Fix:** Restrict selector types to `direct_user`, `direct_destination`, `role`, `organization`, `workflow_work_item`, and `escalation_target`. Remove dummy phone fallbacks. Verify active memberships.
- **Required Verification:** Test cases resolving user IDs without active memberships or invalid destination formats.
- **Final Severity:** `P1`

---

### P1-06 — Permission enforcement and API boundaries are incomplete and bypass approved controls

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Access control must partition requests using granular target permissions (`notification:request:create:direct`, `notification:request:create:emergency`).
- **Evidence:**
  - `api/src/routes/notifications.ts` uses generic check `notification:request:create`, allowing standard callers to submit emergency webhooks and direct destinations.
- **Affected Files:**
  - `apps/api/src/routes/notifications.ts`
  - `apps/api/src/app.ts`
  - `modules/govos-core/src/rbac.ts`
- **Required Fix:** Implement granular permissions checks; route intake via `/v1/notifications/requests`. Apply database-resolved permission roles.
- **Required Verification:** RBAC integration matrix tests checking all endpoint-role combinations.
- **Final Severity:** `P1`

---

### P1-07 — The worker creates a second queue and does not enforce the approved lease/fencing protocol

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Align notification polling with the `task_execution` system utilizing 60s lease timeouts, heartbeats, and fencing.
- **Evidence:**
  - `worker.ts` updates `notification_delivery` directly, bypasses `task_execution`, lacks heartbeat tasks, and processes rows globally without tenant-fair partitioning.
- **Affected Files:**
  - `packages/infrastructure/src/notifications/worker.ts`
  - `packages/infrastructure/src/notifications/providers/registry.ts`
  - `apps/worker/src/server.ts`
- **Required Fix:** Integrate delivery jobs with `task_execution`, implementing heartbeat updates, lease owner verification, and tenant-fair claiming logic.
- **Required Verification:** Concurrency testing simulating network timeout and lease re-assignment.
- **Final Severity:** `P1`

---

### P1-08 — Provider execution, attempts, retries, and transactions are not deterministic or atomic

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Multi-statement writes must use dedicated connection clients, and retry algorithms must use randomized jitter.
- **Evidence:**
  - `registry.ts` executes `BEGIN` transactions on the general pool instead of a leased client.
  - Jitter is omitted from retry backoff calculation.
- **Affected Files:**
  - `packages/infrastructure/src/notifications/providers/registry.ts`
  - `packages/infrastructure/src/notifications/worker.ts`
- **Required Fix:** Checkout dedicated clients for transaction blocks. Apply randomized jitter to retries. Track failovers and status snapshots.
- **Required Verification:** Simulate execution failovers and check retry delay randomness.
- **Final Severity:** `P1`

---

### P1-09 — Outbound webhook SSRF and signing controls are bypassable

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Webhook URL execution requires socket-pinned HTTPS verified endpoint checks, redirect blocks, and signature nonce verification.
- **Evidence:**
  - Webhook provider accepts `http://` protocols, does not pin socket connections to validated DNS lookups, follows redirects, and lacks timestamp/nonce signatures.
- **Affected Files:**
  - `packages/infrastructure/src/notifications/ssrf-webhook.ts`
  - `packages/infrastructure/src/notifications/providers/webhook.ts`
- **Required Fix:** Enforce HTTPS-only verified webhook endpoints. Pin socket connections. Disable redirects. Implement timestamp and key-ID signatures.
- **Required Verification:** Test suite containing redirect and local DNS rebinding test cases.
- **Final Severity:** `P1`

---

### P1-10 — Provider callback authentication, replay protection, and routing are unsafe and nonfunctional

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Validate callbacks using constant-time comparisons, signature skew constraints, and generic error shapes.
- **Evidence:**
  - Callback endpoint allows a hardcoded signature fallback `mock-valid-signature`, parses non-raw payloads, and yields verbose error responses (401/404/500).
- **Affected Files:**
  - `apps/api/src/routes/notifications.ts`
- **Required Fix:** Remove mock bypasses. Compare HMAC using raw buffers in constant-time. Format failure responses generically.
- **Required Verification:** Replay and signature validation negative tests.
- **Final Severity:** `P1`

---

### P1-11 — Secret handling and PII protections violate the approved boundary

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Sensitive credentials must be referenced via secret manager IDs, and PII must be redacted from diagnostic logs.
- **Evidence:**
  - Plaintext signing secrets and configurations are stored directly in columns.
  - plaintext email and phone destinations are written to console logs.
- **Affected Files:**
  - `packages/infrastructure/src/notifications/encryption.ts`
  - `packages/infrastructure/src/notifications/providers/email.ts`
  - `packages/infrastructure/src/notifications/providers/sms.ts`
- **Required Fix:** Store credential references. Mask phone numbers, email addresses, and payload bodies from console outputs.
- **Required Verification:** Scan test run output files for target phone/email strings.
- **Final Severity:** `P1`

---

### P1-12 — Required notification capabilities and WF-1/legacy compatibility are absent

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Route legacy workflows and invitation communications through the notification intake pipeline.
- **Evidence:**
  - `SendInvitationExecutor` bypasses the notification intake path and writes directly to local test structures.
- **Affected Files:**
  - `apps/worker/src/executors/sendInvitationExecutor.ts`
  - `apps/worker/src/server.ts`
- **Required Fix:** Refactor legacy invitation executor to dispatch requests using the canonical notification service. Add compatibility telemetry metrics.
- **Required Verification:** Verify invitation delivery equivalence.
- **Final Severity:** `P1`

---

### P1-13 — Verification, rollback evidence, and production gates are not satisfied

- **Validated Disposition:** `ACCEPTED_P1`
- **Architectural Requirement:** Complete TypeScript compilation of monorepo packages, sequential cleanup, and formal evidence documents.
- **Evidence:**
  - Monorepo compilation fails on shared testing module files.
  - `docs/ecogov/WF2_EVIDENCE.md` is absent.
- **Affected Files:**
  - `packages/testing/src/notifications.test.ts`
  - `docs/ecogov/WF2_EVIDENCE.md`
- **Required Fix:** Correct compiling issues in `packages/testing`. Generate `docs/ecogov/WF2_EVIDENCE.md` based on verified test executions.
- **Required Verification:** Clean `npm run typecheck` run.
- **Final Severity:** `P1`

---

## 2. P2 Findings Validation

### P2-01 — Inbox API and lifecycle do not match the approved contract

- **Validated Disposition:** `ACCEPTED_P2`
- **Architectural Requirement:** Paginated endpoints matching `/v1/notifications/inbox`, keyset cursor pagination, and idempotent status updates.
- **Evidence:**
  - Inbox API uses non-canonical `/notifications/inbox` URL, returns static offset limits, and does not track version increments.
- **Affected Files:**
  - `apps/api/src/routes/notifications.ts`
  - `packages/database/migrations/000034_notification_platform.sql`
- **Required Fix:** Relocate routes. Implement keyset cursor parameters. Enforce unique constraints on inbox items.
- **Required Verification:** Keyset pagination testing.
- **Final Severity:** `P2`

---

### P2-02 — Data model omits required bounded operational metadata and indexes

- **Validated Disposition:** `ACCEPTED_P2`
- **Architectural Requirement:** Indexes optimizing fair-batch worker claiming, daily rate windows, and cleanup tasks.
- **Evidence:**
  - Indexing for worker claims and daily rate-limiting windows are absent from Migration 34.
- **Affected Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
- **Required Fix:** Add indexes for active template effective times, worker claim optimization, and unique constraints. Add partition cleanup scripts for rate limit logs.
- **Required Verification:** Query performance tests with loaded fixtures.
- **Final Severity:** `P2`
