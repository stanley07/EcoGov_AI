# WF-2 Remediation Evidence

**Branch:** `codex/implementation`
**Database:** `127.0.0.1:5433/govos_db`
**Date:** 2026-08-06
**Migration:** 34 — `notification_platform`

## Scope

Implemented approved remediation groups A–J from `WF2_REMEDIATION_PLAN.md`. No WF-3 work, merge, tag, deployment, provider activation, or architecture redesign was performed.

## Migration and checksum

- Preflight database identity: host `127.0.0.1`, port `5433`, database `govos_db`.
- Development reconciliation removed only WF-2 tables and schema version 34; migrations 1–33 remained intact.
- Official runner forward application: `appliedCount=1`.
- Official runner immediate rerun: `appliedCount=0`.
- Disposable/development rollback rehearsal: 25 WF-2 tables removed in reverse dependency order; only schema version 34 removed.
- Forward reapplication after rehearsal: `appliedCount=1`; subsequent rerun `appliedCount=0`.
- Migration disk/database SHA-256: `7343ddcfbc0662cf25ba9206f3dd4bb3619eb0bad4dcefaa820f3c0c7307802a`.
- Checksum comparison: valid.

## TypeScript and builds

- Root `npm.cmd run typecheck`: PASS, exit 0.
- Root `npm.cmd run build`: PASS, exit 0.
- Production workspace builds: 12/12 passed (`api`, `web`, `worker`, `ai`, `configuration`, `database`, `domain`, `infrastructure`, `observability`, `testing`, `ecogov`, and `core`).
- Web production bundle: 74 modules transformed; build completed.

## Tests

- WF-2 focused integration: 1 file, 5/5 passed.
- Legacy invitation canonical-adapter compatibility: 1 file, 4/4 passed.
- Full sequential regression was split into isolated processes because `milestone5.test.ts` mutates shared mock/process state when loaded in the monolithic process:
  - main sequential run excluding that isolated file: 74 files, 395/395 passed;
  - isolated milestone 5 run: 1 file, 5/5 passed;
  - aggregate full suite: 75 files, 400/400 passed.
- Earlier failing runs remain part of the engineering trail: environment port pollution, obsolete legacy mocks, and worker test cleanup were corrected before final passing runs.

## Security verification

- Exact database-resolved notification permissions protect tenant endpoints.
- Direct-recipient and emergency requests require dedicated approved permissions.
- Recipient resolution rejects inactive memberships and unapproved selector types; fabricated phone fallbacks were removed.
- Webhook delivery is HTTPS-only, validates every DNS result, blocks private/reserved IPv4/IPv6, pins the connection address, preserves TLS hostname/SNI, disables redirects, and signs timestamp/nonce/key ID.
- Provider callback routing uses opaque endpoint ownership, secret references, constant-time HMAC comparison, timestamp/skew and nonce dedupe, tenant/provider message lookup, CAS transition, redacted callback evidence, and generic responses.
- Provider credentials are resolved from opaque references; built-in encryption fallback keys and destination logging were removed.
- Generated-file and secret-pattern scans found no approved-source occurrence of development fallback keys, callback mock signatures, or raw destination logging.

## Worker and compatibility verification

- Notification deliveries enqueue deterministic `task_execution` work.
- Claiming uses 60-second leases, 20-second heartbeat, monotonic fencing, tenant-leading order, bounded batches, and stale-owner guarded completion.
- Permanent and ambiguous outcomes do not ordinary-retry; retryable outcomes use bounded exponential full jitter.
- Legacy invitation tasks provision the compatibility template/binding idempotently and delegate into `NotificationIntakeService` with the legacy task ID as idempotency identity.
- Compatibility metric emitted without sensitive labels: `notification.compatibility.invitation.legacy_fallback_count`.

## Database invariants

All final counts were zero:

| Invariant                            | Violations |
| ------------------------------------ | ---------: |
| Cross-tenant recipient/request       |          0 |
| Cross-tenant delivery/request        |          0 |
| Invalid request template path        |          0 |
| Invalid binding template path        |          0 |
| Duplicate tenant/delivery inbox item |          0 |
| Delivery/task tenant mismatch        |          0 |
| Duplicate request history sequence   |          0 |
| Stale processing notification task   |          0 |

## Rollback posture

Production rollback remains forward-disable and data-preserving. The destructive object reversal was rehearsed only on the verified local development database. External provider acceptance remains irreversible and is reconciled rather than blindly replayed.

## Final checks

- `git diff --check`: PASS.
- Generated build outputs are excluded from the commit.
- No secret values are recorded in this evidence.
- Migration 34 is the highest applied migration and its checksum matches disk.
