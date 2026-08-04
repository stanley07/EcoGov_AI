# WF-1 Rollback Strategy

## Verified rehearsal (2026-08-04)

`govos_wf1_verification` was created as a dedicated disposable database, migrated from empty through the final WF-1 schema (`000032`), exercised through publish/start/claim/transition, dropped, recreated, and forward-migrated again. The database was removed after verification. Production rollback remains feature-disable/drain-first: do not destructively remove WF-1 rows created after enablement.

## Principles

Rollback prioritizes stopping new work and preserving evidence. Never delete workflow history, tasks, outbox events, or domain/financial records to simulate rollback. Schema contraction is last and only after old binaries are proven compatible and new data is drained/exported.

## Before activation

Fresh verified backup; migration rehearsal; feature flags default off by tenant/definition; old services remain deployable; dual-compatible expand schema; immutable inventory/counts; handler-version availability check.

## Runtime rollback levels

1. Disable new WF-1 starts for affected definition/tenant.
2. Pause schedulers/claims for affected handler without killing leased work; allow heartbeat/graceful completion or lease expiry.
3. Route new starts back to legacy compatibility path where equivalence is approved.
4. Suspend affected WF-1 instances at a safe boundary; do not mutate pinned versions.
5. Roll back application binaries while retaining additive schema.
6. Restore database only for catastrophic migration corruption, with owner approval and reconciliation of externally delivered side effects.

## In-flight instances

Classify: not started, waiting/human, machine processing, side-effect completed, terminal. Resume with same version/handler after correction whenever possible. Compensation is an explicit audited domain command; never reverse payments, licences, notifications, or enforcement through generic SQL.

## Migration rollback

Preferred rollback is forward-disable with additive columns/tables retained. A later reviewed contraction may drop objects only when: no instance/task/policy references; legacy compatibility confirmed; counts exported; backup readable; no external side-effect linkage; dry run and owner approval complete. Migration down scripts are not executed automatically in production.

## Verification after rollback

No new starts; leases/timers stable; legacy path operational; tenant/cross-org integrity zero; event/audit counts preserved; outbox/task duplicates absent; financial/licensing invariants preserved; focused and full regression/builds pass; incident/evidence records exact commands, times, flags, counts, and residual limitations without secrets.
