# WF-1 Verification Checklist

Implementation verification status: completed 2026-08-04; exact command results are recorded in `WF1_EVIDENCE.md`.

## Architecture gate

- [ ] ADR accepted; database, API, security, state, version, task, SLA, escalation, rollback, and evidence plans approved.
- [ ] Existing workflow/task/outbox consumers inventoried and compatibility owners assigned.
- [ ] Permissions and platform/tenant ownership approved; no wildcard or `user:write` use.

## Pre-migration

- [ ] PostgreSQL target/version/database verified; fresh readable backup.
- [ ] Migration history/checksums clean; proposed migration highest+1 and idempotent.
- [ ] Cross-tenant/orphan/duplicate/invalid-graph/status/task-lease preflights zero or explicitly remediated.
- [ ] Row counts/checksums captured for workflow, audit, task, outbox, users, memberships, finance/licensing records.
- [ ] Apply and rollback rehearsed on a production-like restore.

## Database

- [ ] Composite tenant FKs, checks, partial unique indexes, append-only controls, CAS versions, and query plans verified.
- [ ] Backfills resumable and no records deleted; old readers/writers remain compatible.
- [ ] Migration runner apply succeeds; rerun no-op; restart recovery succeeds.

## Functional/security

- [ ] Definition CRUD/validation/publish/deprecate and immutable hash tests.
- [ ] State transition matrix, invalid transitions, cycles/limits, conditions, idempotency, and concurrency races.
- [ ] Tenant/organization isolation, exact permissions, denied audit, revoked session, platform separation.
- [ ] Human claim/release/reassign/complete, final authorization recheck, session invalidation where relevant.
- [ ] Task duplicate delivery, collision, retry, timeout, heartbeat, stale owner, worker crash/restart, dead letter/repair.
- [ ] SLA calendar/DST/pause/catch-up/warning/breach and escalation idempotency/recipient failures.
- [ ] Secret/PII/log/audit scans and payload size/depth abuse tests.

## Compatibility/performance/UI

- [ ] Legacy workflow equivalence and existing payment/licence async invariants.
- [ ] Existing full sequential suite passes unchanged plus focused WF-1 suites.
- [ ] Queue claim, inbox, event history, and deadline query plans/load targets pass.
- [ ] Operational UI keyboard, focus, labels, contrast, 360/768/1024/1440 responsive checks.

## Required gates

- [ ] Applicable TypeScript projects pass.
- [ ] Database/core/API/worker/web production builds pass.
- [ ] Final database integrity/preflight and dry-run no-op pass.
- [ ] `git diff --check`, generated/secret scan, exact staged scope, clean post-commit tree.
- [ ] Independent architecture review resolves P0/P1 before activation.
