# WF-1 Remediation V2 Evidence

Date: 2026-08-04

Branch: `codex/implementation`

Approved baseline: `0d74727a3c92af788af4db42e5d4878c25226aae`

## Migration evidence

- Connection preflight: `127.0.0.1:5433/govos_db`.
- Official migration runner applied migrations 27 through 33 after reconciling the local development PostgreSQL service.
- Highest migration: `33` (`000033_wf1_remediation.sql`).
- Migration 33 checksum: `93181d75a4a62eabba7d1f9b27652ec93c10b01df5053428c94f842540ca9b95`.
- Checksum verification: no mismatches across migrations 1 through 33.
- Immediate official-runner rerun: zero migrations applied.
- Disposable-database rollback rehearsal: database created, all 33 migrations applied, WF-1 lifecycle exercised, database dropped.
- Forward reapplication: all 33 migrations reapplied successfully to a new disposable database.
- Existing migrations, including migration 33, were not modified by this implementation.

## Remediation verification

- Focused remediation/API compatibility suite: 42 tests passed, 0 failed across five files in the final focused run.
- Earlier complete focused remediation selection: 55 tests passed, 0 failed.
- Strict file-isolated sequential baseline: 395 of 397 tests passed. The two failures are confined to `iam-cross-tenant-remediation.test.ts`; that historical IAM test expects a specific 14-row pre-remediation production decision set that is absent from this reconciled development database. The tests do not exercise WF-1 code, and no out-of-scope production fixture data was synthesized.
- Disposable real-database WF-1 verification passed:
  - lifecycle events: 4;
  - commands: 5;
  - cancelled timers: 2;
  - fired timers: 2;
  - completed escalation actions: 2;
  - workflow outbox events: 2;
  - cross-organization transition: denied;
  - concurrent AI acceptance winners: exactly 1;
  - accepted recommendation state: `accepted`;
  - resulting instance state: `completed`.

## TypeScript and production builds

- WF-1 affected workspaces (`@govos/core`, `@govos/api`, and `@govos/worker`): TypeScript passed.
- Production builds passed for `@govos/core`, `@govos/ecogov`, `@govos/configuration`, `@govos/domain`, `@govos/observability`, `@govos/infrastructure`, `@govos/ai`, `@govos/database`, `@govos/api`, `@govos/worker`, and `@govos/web`.
- The root composite TypeScript command remains non-clean because of pre-existing, out-of-scope errors in historical testing fixtures and IAM scripts (unused declarations, fixture nullability, testing `rootDir`/`include`, CommonJS `import.meta`, and `.ts` import configuration). No WF-1 production workspace reported a TypeScript error.

## Database invariants

Final `scripts/wf1-invariants.mjs` result:

| Invariant                         | Result |
| --------------------------------- | -----: |
| Orphan workflow versions          |      0 |
| Instances without pinned versions |      0 |
| Cross-tenant workflow references  |      0 |
| Cross-organization work items     |      0 |
| Duplicate active work items       |      0 |
| Duplicate timer actions           |      0 |
| Event sequence violations         |      0 |
| Stale timer leases                |      0 |
| Platform permission mappings      |      0 |

## Security and isolation evidence

- Transition conditions accept only `literal`, `var`, `exists`, `not`, `all`, `any`, `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, and `in`.
- Publication and runtime share the same 16 KiB, depth-8, node-128, list-50 validator.
- Variable traversal uses own properties only and rejects `__proto__`, `prototype`, and `constructor` path segments.
- Unknown operators, aliases, extra node fields, incompatible comparisons, heterogeneous lists, missing variables, and executable payload shapes are rejected or fail closed.
- Instance, event, work-item, queue, and operations queries require active same-tenant organization membership and preserve definition-level RBAC.
- Timer/SLA work uses bounded batches, 60-second leases, monotonic fencing, bounded retries, deterministic reminder-before-breach execution, stable idempotency identities, crash recovery, bounded escalation chains, and active-recipient filtering.
- AI recommendation acceptance runs through the normal transition command transaction with expected-version checks; accept/reject are terminal and concurrent acceptance has a single winner.
- Focused secret scan of changed source, tests, scripts, and documentation found no embedded secret assignment.
- Generated-file scan found no generated IAM files or tracked TypeScript build-info changes after cleanup. Ignored production build output was not staged.

## Compatibility and rollback

- Legacy entry points retain active-tenant enforcement through the explicit `EnterpriseWorkflowEngine` adapter dependency and use the canonical step status lifecycle.
- Existing mocked callers were updated to model the active-tenant guard; no test-only production bypass was added.
- The canonical engine preserves version pinning, idempotent commands, append-only event ordering, work-item/timer/SLA creation, and optimistic concurrency.
- Rollback is operational rather than destructive: stop WF-1 worker polling, restore the prior application commit, allow leased tasks to expire, and retain migration 33 because it is additive and backward-compatible. The disposable database rehearsal proves clean rebuild and forward reapplication.

## Manual UI acceptance

- The production web bundle built successfully.
- An in-app browser acceptance attempt was made against the local production preview. The preview was healthy on the host, but the browser sandbox could not reach the host loopback address, so interactive visual acceptance could not be completed in this environment.
- WF-1 remediation changes are API, engine, worker, migration-verification, and test changes; no web source file changed.

## Final architecture checklist

- Published definition content remains immutable while lifecycle/default rotation remains permitted.
- Canonical step lifecycle is enforced.
- The authoritative bounded V2 condition AST is implemented without aliases or executable extensions.
- Tenant, organization, RBAC, audit, event-ordering, version-pinning, idempotency, and optimistic-concurrency invariants remain enforced.
- Timer, SLA, escalation, legacy compatibility, and AI recommendation remediation is present and database-backed verification passes.
- No migration was edited or newly introduced beyond the already approved migration 33.
- No merge, tag, or deployment was performed.
