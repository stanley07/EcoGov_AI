# WF-2 Remediation Plan

This document outlines the sequential, grouped remediation tasks required to bring the GovOS Notification Platform (WF-2) to production readiness. The tasks are ordered by architectural and database dependency to ensure a clean build and verify correctness at each stage.

---

## Group A: Schema and Migration Correctness

- **Exact Files:**
  - `packages/database/migrations/000034_notification_platform.sql`
- **Exact Change:**
  - Restructure DDL statements using `IF NOT EXISTS` for tables, indexes, and triggers to guarantee migration idempotency.
  - Implement V3 composite key relationships, including `(tenant_id, parent_request_id)` for parent requests, route entries, and callback records to enforce strict tenant isolation.
  - Define composite index keys on `notification_delivery` optimization fields (tenant, state, and due date).
- **Tests:**
  - Database migration idempotency check tests (running apply -> apply again -> rollback -> reapply).
- **Migration Requirement:**
  - Modify `000034_notification_platform.sql` (prior to release merge).
- **Completion Criteria:** Migration applies without error on subsequent dry runs, and the database schema matches the V3 architecture specification.

---

## Group B: Domain and State-Machine Correctness

- **Exact Files:**
  - `packages/infrastructure/src/notifications/intake.ts`
  - `packages/database/migrations/000034_notification_platform.sql`
- **Exact Change:**
  - Implement a template catalog trigger to guard global version bindings.
  - Require published version status and active date windows during binding lookup in `intake.ts`.
  - Implement transactional locking on bindings and version rows to protect against race conditions.
  - Enforce complete immutability on template versions and template renderings.
- **Tests:**
  - Intake binding resolution tests for drafts, expired templates, and concurrent version updates.
- **Migration Requirement:** Trigger modification in `000034_notification_platform.sql`.
- **Completion Criteria:** Any attempt to bind draft/expired templates or modify published renderings results in transactional rollback.

---

## Group C: Permissions and Isolation

- **Exact Files:**
  - `apps/api/src/routes/notifications.ts`
  - `modules/govos-core/src/rbac.ts`
  - `packages/infrastructure/src/notifications/intake.ts`
- **Exact Change:**
  - Configure route handlers to require granular target permissions (`notification:request:create:direct`, `notification:request:create:emergency`).
  - Eliminate hardcoded static role checks. Resolve roles dynamically from the database definitions.
  - Fail closed when resolving user recipient destinations for users without active tenant memberships.
- **Tests:**
  - Negative access matrix verification tests for unauthorized roles and cross-tenant resource requests.
- **Migration Requirement:** None.
- **Completion Criteria:** Non-admin/unauthorized calls return status code `403 Forbidden` or `401 Unauthorized` without executing intake logic.

---

## Group D: Provider, Webhook and Callback Security

- **Exact Files:**
  - `packages/infrastructure/src/notifications/providers/webhook.ts`
  - `packages/infrastructure/src/notifications/ssrf-webhook.ts`
  - `apps/api/src/routes/notifications.ts`
- **Exact Change:**
  - Enforce HTTPS-only protocol targets for webhook deliveries.
  - Pin fetch request sockets to resolved and validated DNS IPs; block redirect targets.
  - Implement timestamp, nonce, and key-ID signatures on webhook payloads.
  - Re-align callback routes to compare HMAC signatures in constant-time using raw body bytes; return generic safe errors.
- **Tests:**
  - Webhook SSRF validation, DNS-rebinding, redirect bypass, and invalid signature verification tests.
- **Migration Requirement:** None.
- **Completion Criteria:** All SSRF webhook targets and bad callback signatures fail verification and do not perform delivery side-effects.

---

## Group E: Worker, Retry, Reconciliation and Dead Letters

- **Exact Files:**
  - `packages/infrastructure/src/notifications/worker.ts`
  - `packages/infrastructure/src/notifications/providers/registry.ts`
- **Exact Change:**
  - Route delivery execution queues through the shared `task_execution` system.
  - Enforce standard 60-second task leases, 20-second heartbeats, and fencing checks.
  - Add randomized jitter to exponential retry backoff intervals.
  - Track failovers and lock states; do not retry permanent failures.
- **Tests:**
  - Worker concurrency tests checking heartbeat failures, lease loss, and double-delivery prevention.
- **Migration Requirement:** None.
- **Completion Criteria:** Concurrent workers safely coordinate via database leases; expired workers lose locks and fail state commits.

---

## Group F: API and Inbox Correctness

- **Exact Files:**
  - `apps/api/src/routes/notifications.ts`
  - `packages/database/migrations/000034_notification_platform.sql`
  - `packages/infrastructure/src/notifications/providers/in-app.ts`
- **Exact Change:**
  - Expose inbox endpoints under `/v1/notifications/inbox` using keyset cursor pagination parameters.
  - Add unique constraint index on `(tenant_id, delivery_id)` in the inbox table.
  - Sanitise and classification-filter inbox bodies before persisting in `in-app.ts`.
- **Tests:**
  - Keyset pagination and duplicate inbox insertion negative tests.
- **Migration Requirement:** Unique constraint addition in `000034_notification_platform.sql`.
- **Completion Criteria:** Inbox retrieval returns paginated items without duplicates.

---

## Group G: Legacy Compatibility

- **Exact Files:**
  - `apps/worker/src/executors/sendInvitationExecutor.ts`
  - `apps/worker/src/server.ts`
- **Exact Change:**
  - Refactor legacy invitation pathways to invoke the canonical notification intake pipeline.
  - Add compatibility monitoring telemetry (`notification.compatibility.invitation.legacy_fallback_count`).
- **Tests:**
  - Invitation delivery equivalence tests.
- **Migration Requirement:** None.
- **Completion Criteria:** Invitation actions generate standard platform request and delivery ledger records.

---

## Group H: TypeScript and Build Repair

- **Exact Files:**
  - `packages/testing/tsconfig.json`
  - `packages/testing/src/` (remedying compile errors)
- **Exact Change:**
  - Correct unused variables and strict null issues in testing modules.
  - Reconcile `import.meta` and type emission properties for script builds in the testing bundle.
- **Tests:**
  - Verify full project compilation.
- **Migration Requirement:** None.
- **Completion Criteria:** Running `npm run typecheck` completes with exit code `0`.

---

## Group I: Runtime Tests and Full Regression

- **Exact Files:**
  - `packages/testing/src/notifications.test.ts`
- **Exact Change:**
  - Expand test coverage to verify cross-tenant boundaries, permission matrices, worker fencing, heartbeats, and webhooks.
  - Restructure testing hooks to restore triggers inside `finally` blocks to guarantee database consistency.
- **Tests:**
  - Sequential running of the complete test suite.
- **Migration Requirement:** None.
- **Completion Criteria:** Every unit and integration test passes cleanly.

---

## Group J: Evidence, Rollback and Final Invariants

- **Exact Files:**
  - `docs/ecogov/WF2_EVIDENCE.md`
  - `docs/ecogov/WF2_IMPLEMENTATION_RESPONSE.md`
- **Exact Change:**
  - Execute a formal migration rollback dry run.
  - Collect exact execution logs, code shapes, and checksums.
  - Package execution output inside `WF2_EVIDENCE.md`.
- **Tests:**
  - Database invariant validation queries.
- **Migration Requirement:** None.
- **Completion Criteria:** Evidence document is authored and checked into `docs/ecogov/`.
