# WF-1 Remediation Implementation Plan V2

## 1. Scope and authorization boundary

This plan covers only findings R-01 through R-11 classified `ACCEPTED` in `WF1_REVIEW_RESPONSE_V2.md`. It does not authorize WF-2, new workflow features, calendar-aware SLA calculations, parallel gateways, subworkflows, or unrelated TypeScript/test cleanup.

No implementation, migration, commit, push, merge, tag, or deployment is authorized by this document alone.

## 2. Affected files

Expected existing files:

- `apps/worker/src/workflow-runtime.ts`
- `apps/worker/src/server.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/app.ts`
- `apps/api/src/routes/workflows.ts`
- `modules/govos-core/src/workflow-engine.ts`
- `modules/govos-core/src/workflow.ts`
- `packages/ai/src/runtime/outbox-service.ts`
- `packages/database/src/index.ts`
- `packages/database/migrations/000019_agent_outbox_and_tool_audit.sql` remains immutable
- `packages/database/migrations/000031_enterprise_workflow_engine.sql` remains immutable
- `packages/database/migrations/000033_wf1_remediation.sql` remains immutable
- `docs/ecogov/WF1_ROLLBACK_STRATEGY.md`
- `docs/ecogov/WF1_REMEDIATION_EVIDENCE.md`
- `packages/testing/src/wf1-remediation.test.ts`
- `packages/testing/src/wf1-contract.test.ts`
- `packages/testing/src/milestone2.test.ts`
- `packages/testing/src/milestone4.test.ts`
- `packages/testing/src/milestone5.test.ts`
- `apps/api/tests/workbench-projection.test.ts`

Expected new focused tests may be added under `packages/testing/src`, `apps/api/tests`, and `apps/worker/src` using repository conventions. File names must describe behavior rather than review severity.

## 3. Database changes

Migration 33 is immutable. Before drafting any successor migration, verify database identity, migration checksums, highest migration, and that the next migration number is unused.

A successor migration is required only for database guarantees that cannot safely be supplied by application code. Candidate changes, subject to preflight, are:

- escalation action lifecycle fields needed to distinguish `pending`, leased/processing, completed, retryable failure, and permanent failure;
- outbox/work-item effect references needed to prove an escalation action completed its real side effect;
- indexes or constraints supporting one active action per escalation identity;
- definition-permission version binding if the existing definition-bound table cannot express the approved mapping;
- no schema change for condition operators, organization predicates, worker startup, or recommendation transactionality unless preflight proves a missing database invariant.

Database rules:

- additive and idempotent only;
- no edits to migrations 1–33;
- tenant-composite foreign keys for every new reference;
- no completed escalation row without a durable effect reference;
- no destructive normalization;
- official runner apply, checksum, rerun no-op, disposable rollback rehearsal, and forward reapplication.

## 4. API changes

### 4.1 Organization isolation (R-05, R-09)

Create one reusable server-side organization-scope resolver/predicate. Apply it to:

- instance list and detail;
- instance events/history;
- transition with or without work item;
- suspend, resume, and cancel;
- nested work-item/timer visibility;
- operations metrics and counts.

Mutation commands must recheck membership and active organization under the same transaction/lock as the write. Inaccessible identifiers return tenant-safe 404. Exact tenant-wide authority, if retained, must be explicit and tested; generic administrator roles do not bypass scope.

### 4.2 Definition permissions (R-07)

Define bounded management/read APIs only if required by the approved administration contract. Start/read/cancel/suspend/resume/repair commands must query `workflow_definition_permission` using tenant and definition identifiers in addition to global operation permission checks. Absence fails closed where mappings are required.

### 4.3 Version validation failure (R-10)

Keep the existing validation endpoint, but make its command lifecycle explicit. A failure response includes stable 422 error codes and a bounded validation report while returning the version to draft. No general-purpose status endpoint is added.

### 4.4 AI decisions (R-04)

Request and response shapes remain backward compatible. Accept/reject retain expected instance version, organization context, and idempotency key. Concurrent losers receive stable conflict/stale results without secondary transition effects.

## 5. Core engine changes

### 5.1 Transaction-aware canonical command

Refactor transition internals so the same canonical implementation can run either in its own transaction or within a caller-owned `PoolClient`. Preserve event sequence, pinned workflow version, conditions, validators, idempotency, audit, tasks, timers, and outbox behavior.

Use this internal command for:

- normal transition API;
- AI recommendation acceptance;
- legacy adapter equivalence;
- timed transition/escalation where applicable.

### 5.2 AI recommendation atomicity (R-04)

Within one serializable transaction:

1. lock recommendation and instance;
2. assert active recommendation, tenant, organization, membership, pinned version, and expected instance version;
3. acquire/validate idempotency command;
4. execute the canonical command;
5. mark the recommendation accepted;
6. append decision event/audit;
7. commit all effects together.

Rejection uses the same lock/scope discipline but does not transition the instance. Accepted, rejected, and stale remain terminal.

### 5.3 Condition language completion (R-06)

Implement exactly:

- value nodes: `literal`, `var`;
- boolean nodes: `exists`, `not`, `all`, `any`;
- comparison nodes: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`.

Retain 16 KiB, depth 8, node 128, and list 50 bounds. Enforce approved variable roots, missing sentinel, no coercion, finite numbers, homogeneous membership lists, and no executable constructs. Publication and runtime call the same validator/evaluator.

### 5.4 Legacy compatibility (R-03)

Retain active-tenant enforcement. Make it an explicit adapter dependency and update mocked clients. Confirm legacy calls preserve expected version/idempotency where available and create equivalent audit/event/task/timer artifacts. Do not special-case tests by bypassing the guard.

## 6. Worker changes

### 6.1 Production runtime lifecycle (R-01)

- Instantiate `WorkflowRuntimeWorker` from the production worker startup path.
- Start a non-overlapping loop after database readiness.
- Poll in bounded batches; use existing 60-second lease and monotonic fencing.
- Use bounded idle/error backoff with jitter.
- Expose last-success/error and backlog state through existing readiness/operations mechanisms without leaking payloads.
- Abort polling and await in-flight work on graceful shutdown.
- Prevent duplicate loop startup in tests, hot reload, and multi-hook initialization.

### 6.2 Escalation effects (R-02)

For each escalation action:

- insert/reuse a pending idempotent action;
- lock and fence the action task;
- revalidate active tenant, organization, membership, role/queue, and unresolved work item;
- for `notify`, atomically enqueue the approved notification outbox event;
- for `reassign`, execute the canonical work-item reassignment command with expected work-item version;
- append immutable workflow/audit evidence;
- mark completed only after the durable effect exists;
- classify retryable/permanent errors and never broaden recipients when a queue is empty.

Resolved/terminal work cancels remaining escalation levels. Levels remain deterministically ordered and bounded to ten.

## 7. Testing changes

### 7.1 Runtime worker integration

Add real PostgreSQL tests proving:

- production startup creates exactly one loop;
- a due timer is scheduled and fired;
- reminder and breach clocks update;
- a stale fence cannot commit;
- lease expiry recovers after simulated crash;
- duplicate scheduling/firing is harmless;
- graceful shutdown stops new polling and awaits in-flight work.

### 7.2 Escalation behavior

Test actual notification outbox creation and actual work-item reassignment, idempotent replay, bounded level order, inactive recipients, empty/misconfigured queues, terminal work cancellation, and transaction rollback.

### 7.3 Legacy regression/equivalence

Update the four affected suites to model active-tenant validation. Add active and inactive tenant cases plus canonical/legacy equivalence for human, machine, timed, rejection, cancellation, duplicate, concurrent, and rollback paths.

### 7.4 AI lifecycle

Use competing database transactions to prove one accept/reject winner, expected-version enforcement, crash/rollback atomicity, accepted terminal state, stale rejection, and no direct state mutation outside the normal command.

### 7.5 Organization and metrics isolation

For two organizations in one tenant, test every instance detail/history/mutation/transition path, work-item omission, nested projections, operations counts, tenant-wide exact authority, and tenant-safe not-found behavior.

### 7.6 Conditions and versions

Test every approved operator at publication and runtime, all type mismatches, missing variables, bounds, forbidden paths, and deterministic ordering. Test validation success, recorded failure back to draft, edit after failure, stale expected version, and concurrent validation/publication.

### 7.7 Definition permissions

Test mapped/unmapped definitions, cross-definition access, start/read/cancel/suspend/resume/repair, delegated administrators, and mapping management authorization.

Static string tests may remain as supplementary migration checks but cannot be cited as behavioral proof.

## 8. Verification strategy

Verification order:

1. Assert `127.0.0.1:5433/govos_db` before mutation.
2. Verify migration history/checksums and next migration availability.
3. Run the pre-change sequential baseline and record totals.
4. Apply any approved successor migration with the official runner.
5. Verify checksum and official rerun no-op.
6. Run focused condition/version tests.
7. Run focused organization/permission/metrics tests.
8. Run focused AI concurrency tests.
9. Run legacy equivalence/regression tests.
10. Run worker/timer/SLA/escalation integration and crash-recovery tests.
11. Run the complete sequential suite with zero skipped WF-1 behavioral cases.
12. Run root and required workspace TypeScript checks; do not describe pre-existing failures as a pass.
13. Run production builds for API, worker, web, and affected packages.
14. Run final SQL invariants for statuses, defaults, event ordering, scope joins, timer/action identities, leases/fences, recommendation states, and triggers.
15. Run secret and generated-file scans over the exact staged diff.
16. Manually exercise definition/version, two-organization instance/task paths, timer/SLA/escalation visibility, and AI accept/reject in the UI/API.
17. Update review response/evidence with commands, totals, timestamps, and exact file references.

Release gate: zero open P0/P1 findings, explicit disposition for P2, clean working tree, and independent approval.

## 9. Rollback strategy

### 9.1 Application rollback

Prefer forward-compatible application rollback while retaining additive schema. Before approval, prove the prior application can coexist with canonical status constraints or provide a compatibility release that can. Existing WF-1 instances remain pinned and processable; disabling new creation must not stop worker processing of existing records.

### 9.2 Database rollback rehearsal

On a disposable restored database:

1. assert server identity and migration checksum;
2. snapshot counts and canonical-only values;
3. stop worker polling and drain leases;
4. run the versioned rollback rehearsal tool;
5. fail closed if canonical statuses/actions/permissions cannot be represented by the prior schema;
6. verify constraints, triggers, data, and prior application compatibility;
7. forward-reapply with the official runner;
8. verify checksum and all invariants again.

Production downgrade is prohibited when post-enable data would be lost or misrepresented. In that case the approved rollback is application disablement plus forward repair, documented explicitly for operators.

### 9.3 Worker rollback

Shutdown hooks stop polling, allow current fenced tasks to finish or leases to expire, and never clear another owner's lease. Pending timers/actions remain durable for a repaired worker. Notification/reassignment idempotency prevents repeat effects after restart.

## 10. Required evidence update

The next implementation must update `WF1_REMEDIATION_EVIDENCE.md` and create a V2 review mapping that links R-01 through R-11 to:

- exact code/migration changes;
- focused behavioral tests;
- full-suite totals;
- TypeScript/build results;
- rollback/reapply evidence;
- final invariant SQL;
- manual acceptance evidence;
- clean staged and working-tree scans.

Implementation must stop after verification and independent review handoff. It must not merge, tag, deploy, or begin WF-2.
