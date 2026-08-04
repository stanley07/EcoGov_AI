# WF-1 Remediation Plan

## 1. Purpose, authorization boundary, and gates

This document is the implementation authorization plan for the independently reviewed WF-1 remediation. It supersedes the earlier draft plan. It does not authorize implementation by itself.

No migration `000033`, application source change, database mutation, commit, or push may occur until this plan is approved. Implementation must stop for an ADR-004 architecture or security blocker; environment failures must be diagnosed and safely remediated instead of being treated as architecture blockers.

Implementation gates are:

1. Re-run migration preflight against exactly `127.0.0.1:5433/govos_db`; prove highest applied migration is `30`, checksums are valid, and `31`, `32`, and `33` have the expected repository/deployment disposition at that time.
2. Re-run the complete baseline suite sequentially against that database and classify every failure as regression or environment/configuration failure.
3. Re-run the inventories in this plan immediately before designing `000033`. Any unclassified reader, writer, status value, schema object, or caller blocks migration authoring.
4. Obtain approval for this plan and for the resulting exact `000033` schema delta before mutation.
5. Implement in small, reviewable slices; verify each invariant before proceeding.

## 2. `workflow_step_execution.status` inventory and canonical lifecycle

### 2.1 Current evidence

The repository and deployed development database were inspected read-only. The current database constraint permits `pending`, `processing`, `completed`, and `failed`. The deployed value inventory at planning time is:

| Deployed value | Count |
| --- | ---: |
| `completed` | 1 |

No deployed `pending` or `processing` row was observed. This is evidence about the inspected database, not permission to omit migration-time checks.

The complete known production reader/writer inventory is:

| Location | Operation | Current behavior | Required remediation |
| --- | --- | --- | --- |
| `modules/govos-core/src/workflow.ts` | writer | creates initial and successor executions as `pending` | create them as `ready` after creation metadata is durable |
| `modules/govos-core/src/workflow.ts` | reader/writer | requires `pending`; completes `pending`/`processing` | remove direct lifecycle writes by routing through the canonical command service |
| `modules/govos-core/src/workflow-engine.ts` `startInstance` | writer | creates initial execution as `pending` | create `created`, then atomically activate to `ready`, `running`, or `waiting` according to step type |
| `modules/govos-core/src/workflow-engine.ts` `transition` | reader/writer | selects `pending`/`processing`, writes `completed`, creates successor `pending` | enforce the transition table below with expected instance version and row locking |
| `apps/api/src/routes/registration.ts` | reader | finds active execution with `pending` | use the canonical active-state predicate and organization scope |
| `apps/api/src/routes/complaint.ts` | reader | fallback finds `pending` | use the canonical active-state predicate and organization scope |
| `apps/api/src/routes/workbench.ts` | reader | projects status without filtering | map and display every canonical state; never infer authorization from projection data |
| worker review flows | indirect writer | invoke legacy transition entry point | route through the compatibility adapter and canonical command service |
| testing mocks and fixtures | reader/writer model | encode legacy state behavior | update fixtures and add lifecycle/invariant tests; do not preserve legacy values for mock convenience |

Before `000033` is authored, `rg`, database dependency queries, triggers/functions, views, generated SQL, tests, and worker entry points will be re-inventoried. The migration preflight will group all live values and abort on any value not listed here.

### 2.2 Exact canonical lifecycle

The only canonical values will be:

`created`, `ready`, `claimed`, `running`, `waiting`, `completed`, `failed`, `cancelled`, `skipped`, `dead_lettered`.

Permitted transitions are exactly:

| From | Permitted destination | Meaning/guard |
| --- | --- | --- |
| `created` | `ready`, `running`, `waiting`, `cancelled`, `skipped` | activation after all start side effects are durable |
| `ready` | `claimed`, `running`, `waiting`, `cancelled`, `skipped` | human claim, machine start, timer/external wait, or authorized termination |
| `claimed` | `running`, `ready`, `cancelled` | begin work, authorized release/reassignment, or cancellation |
| `running` | `waiting`, `completed`, `failed`, `ready`, `cancelled` | suspend, succeed, fail, bounded retry, or cancellation |
| `waiting` | `ready`, `running`, `completed`, `failed`, `cancelled` | signal/timer resumes or resolves the execution |
| `failed` | `ready`, `dead_lettered` | retry only when classified retryable and within budget; otherwise terminal |
| `completed` | none | terminal |
| `cancelled` | none | terminal |
| `skipped` | none | terminal |
| `dead_lettered` | none | terminal |

All other changes are rejected. `created` and `running` are deliberately retained as real runtime states. Legacy `pending` maps once to `ready`; legacy `processing` maps once to `running`. They will not remain in the final constraint or application vocabulary. Migration `000033` must re-check counts under lock, perform only these evidence-backed mappings, reject unknown values, replace the constraint, and add transition enforcement without silently normalizing data. The application must use one shared active-state predicate: `created`, `ready`, `claimed`, `running`, or `waiting`.

## 3. Workflow-version lifecycle and default rotation

The only version statuses are `draft`, `validating`, `published`, and `deprecated`. Commands, not arbitrary row updates, own lifecycle changes.

Permitted transitions are:

- `draft -> validating`, after optimistic-version and ownership checks.
- `validating -> published`, only after the full publication validator succeeds.
- `validating -> draft`, only as the validator's recorded failure result; it may not mutate the draft contents during the same command.
- `published -> deprecated`, with immutable published content.

Every other transition is rejected, including `deprecated -> published`, `published -> draft`, direct status assignment, and skipping validation. Structural content is editable only in `draft`; validating, published, and deprecated snapshots are immutable.

`is_default = true` is permitted only for a published version. Publishing with default rotation is one transaction that locks the definition and its published versions, checks the expected aggregate/version token, publishes the candidate, clears the prior default, and sets the candidate default. A partial unique index remains the final guarantee of at most one default per definition. A draft, validating, or deprecated version can never be default. Deprecating the current default requires a replacement published version to be selected and rotated in the same transaction; if none exists, the command is rejected. Starting an instance requires exactly one published default and fails closed on zero or multiple matches.

## 4. Organization isolation for every work-item operation

Every query starts with tenant scope and then organization scope. The normal rule is: the actor has an active membership in the work item's active organization, both belong to the same tenant, and the actor holds the operation-specific permission. A deliberately tenant-scoped authority may cross organizations only when the exact tenant-wide permission is granted; ordinary role membership or a generic administrator label is insufficient.

| Operation | Required enforcement |
| --- | --- |
| list | tenant + allowed organization predicate in SQL; pagination/count use the identical predicate |
| detail | tenant + organization + permission; inaccessible IDs return a tenant-safe not-found response |
| claim | recheck organization membership, queue eligibility, status, assignee, and expected version under lock |
| accept | same scope checks plus current assignee/eligible claimant and expected version |
| assign | target user has active same-tenant, same-organization membership and satisfies policy |
| reassign | revalidate actor authority and both old/new assignee organization eligibility under lock |
| complete | revalidate organization, assignee/claim, active execution, permission, and expected instance version |
| cancel | organization-scoped cancellation permission and active-state/version check |
| queue visibility | direct-user, role, and organization queue predicates are conjunctive; no tenant-wide fallback |
| history | scope the work item before loading events; event joins must retain tenant and organization predicates |

The service must not reveal cross-organization existence through errors, counts, queue totals, history, or timing-dependent secondary lookups. Mutation authorization is repeated inside the transaction immediately before the write.

## 5. Publication-time transition-condition validation

Conditions are data-only typed JSON ASTs. Publication rejects a version unless every transition condition meets all rules below:

- Maximum UTF-8 serialized size: 16 KiB per condition; maximum depth: 8; maximum AST nodes: 128; maximum list literal length: 50.
- Approved nodes/operators only: `literal`, `var`, `exists`, `not`, `all`, `any`, `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, and `in`.
- Approved variable roots only: `variables.<safe-segment...>`, `instance.entityType`, `instance.organizationId`, `instance.status`, and `step.output.<safe-segment...>`. Empty segments, array-index traversal, `__proto__`, `prototype`, and `constructor` are rejected.
- Values have deterministic types: boolean, finite number, string, null, or an explicitly tagged ISO-8601 instant. There is no implicit string/number/date coercion. Ordering operators require identical compatible types; `in` requires a bounded homogeneous literal list.
- A missing path produces a distinct `missing` sentinel. Only `exists` may consume it positively; all comparison and membership operations involving it evaluate `false` and record a non-sensitive reason code.
- Runtime evaluation is pure, deterministic, bounded, and uses the published snapshot. No `eval`, function construction, SQL, shell, dynamic import, template execution, object-method dispatch, code references, or executable/serialized payloads are allowed.

Publication also rejects ambiguous equal-priority transitions that can simultaneously match unless the definition declares a deterministic, validated order. Focused tests cover every operator, boundary, type mismatch, missing variable, forbidden path/payload, and ambiguous transition.

## 6. Timer, SLA, and escalation processing

Timer processing will reuse the existing leased and fenced `task_execution` infrastructure; it will not introduce an unfenced competing worker protocol.

1. A scheduler selects at most 100 due, unresolved timers/clocks per batch using tenant predicates and `FOR UPDATE SKIP LOCKED`, then enqueues deterministic task executions.
2. Executors acquire a 60-second lease with a monotonically increasing fencing token and heartbeat every 20 seconds. Every consequential update checks both task identity and current fence; a stale worker cannot commit.
3. Retry classification is explicit: serialization/deadlock, temporary connection, and retryable provider failures are transient; invalid policy, missing authorization target, terminal instance, forbidden recipient, and malformed payload are permanent. Transient failures use capped exponential backoff with jitter and a maximum of 5 attempts; exhausted/permanent work becomes `dead_lettered` and emits an operational event.
4. Idempotency identities are stable: `wf.timer:{tenantId}:{timerId}:{action}`, `{slaClockId}:reminder:{threshold}`, `{slaClockId}:breach`, and `{slaClockId}:escalation:{level}:{action}`. Database uniqueness enforces one reminder per threshold, one breach, and one action per escalation level even after retries.
5. Crash recovery occurs through lease expiry. The next worker receives a higher fence, reloads authoritative state, and safely retries. Side effects use an outbox/idempotency key before the source record is marked fired.
6. Escalation levels are bounded at publication and runtime to 10, cannot cycle, and stop when the work item/execution/instance is resolved or terminal.
7. Recipients must belong to the same active tenant and organization, have active membership, satisfy the published role/assignment rule, and remain eligible at dispatch time. Suspended tenants, inactive organizations, and inactive users are excluded.
8. Empty or misconfigured queues fail closed. The worker must not widen to another organization, role, or tenant. It records a permanent policy failure, an auditable event, and an operational alert/dead letter.

Tests will exercise competing workers, lease expiry, stale fencing, crash before/after outbox commit, duplicate delivery, retry exhaustion, inactive recipients, empty queues, escalation bounds, and resolved-work cancellation.

## 7. Legacy compatibility adapter

There will be one canonical command service for start, transition, claim/assignment, completion, rejection, cancellation, and timed actions. Legacy entry points become translation adapters only; they may not write workflow state directly.

For every legacy call, the adapter must:

1. Resolve and preserve tenant context, organization context, actor/service identity, and exact permission requirements.
2. Resolve the canonical instance and published version, require the caller's expected instance version, and reject stale calls.
3. Preserve a supplied idempotency key or derive a stable key from the legacy correlation identity, command kind, execution, and outcome; absence of a stable identity is a validation error, not permission to disable idempotency.
4. Translate the legacy outcome/payload into the typed canonical command and run the same publication-snapshotted condition evaluator.
5. Invoke the normal command transaction so audit records, workflow events, commands, successor executions, work items, tasks, timers, SLA clocks, and outbox records are created identically.
6. Translate canonical results/errors back to the documented legacy response without weakening authorization or hiding concurrency conflicts.

Equivalence tests execute the legacy and canonical entry points from equivalent fixtures and compare committed state and emitted artifacts for human, machine, timed, rejection, cancellation, duplicate, concurrent, and transaction-rollback paths. A rollback must leave no partial audit/event/task/timer/outbox state.

## 8. Schema-object reconciliation

The following classification is authoritative for planning. No table will be created solely to reproduce an obsolete document name.

| Alleged object | Classification | Final disposition |
| --- | --- | --- |
| `workflow_assignment_policy` | `IMPLEMENTED_UNDER_ANOTHER_NAME` | validated immutable `workflow_step_definition.assignment`, included in the publication hash and copied into runtime assignment/work-item context |
| `workflow_calendar` | `DEFERRED_BY_ADR004` | calendar-aware SLA is outside accepted WF-1; UTC elapsed time only |
| `workflow_calendar_window` | `DEFERRED_BY_ADR004` | no business-hours window model in WF-1 |
| `workflow_calendar_exception` | `DEFERRED_BY_ADR004` | no holiday/exception model in WF-1 |
| `workflow_sla_policy` | `IMPLEMENTED_UNDER_ANOTHER_NAME` | validated `workflow_step_definition.sla`, immutably snapshotted in `workflow_sla_clock.policy_snapshot` |
| `workflow_escalation_policy` | `IMPLEMENTED_UNDER_ANOTHER_NAME` | bounded validated escalation chain inside the published SLA configuration and immutable clock snapshot; no independent mutable policy table |
| `workflow_definition_permission` | `REQUIRED_BY_ACCEPTED_WF1` | add a queryable, definition/version-bound permission mapping only if the final preflight confirms no equivalent object; it must cover start and definition-level commands that step/transition permissions cannot represent |

The pre-`000033` design record must prove the last row's exact schema and queries or reclassify it, with evidence, as `IMPLEMENTED_UNDER_ANOTHER_NAME`. It may not be silently omitted. Inline assignment/SLA/escalation structures require schemas, bounds, publication validation, hashing, and immutable runtime snapshots; JSON storage is not permission for arbitrary payloads.

## 9. Test-isolation remediation

Before any destructive integration-test setup, a shared helper must assert `inet_server_addr() = '127.0.0.1'`, `inet_server_port() = 5433`, and `current_database() = 'govos_db'`; unexpected or unresolved values abort mutation. Connection settings are supplied explicitly to each test process so stale environment variables and cached runner configuration cannot redirect it.

Destructive integration tests will use isolated schemas/databases where the application supports search-path isolation. Tests that cannot be isolated will run sequentially in a dedicated database lane. Any trigger, role, session setting, feature flag, or constraint altered by a test is captured first and restored in `finally`/`afterEach`, followed by an assertion that the original state is restored. Disabling a global trigger on the shared schema is prohibited. A post-test invariant detects disabled triggers and leaked settings.

Verification includes the root TypeScript check plus every required workspace TypeScript check, not only packages touched by the patch. Generated `tsbuildinfo`, compiled JavaScript/declarations, coverage, logs, and test scratch files must not enter the commit.

## 10. AI recommendation lifecycle and concurrency

Recommendations are actionable only while `active`. Lookup and mutation require the same tenant and organization as the instance plus the operation-specific permission. Acceptance/rejection locks the recommendation and instance, requires the caller's expected instance version, and requires `recommendation.instance_version` to equal the current instance version.

`accepted`, `rejected`, and `stale` are terminal recommendation states. A version mismatch, inactive/terminal instance, invalidated recommendation, or no-longer-permitted transition atomically marks an active recommendation `stale` and rejects execution. Concurrent accept/reject attempts have one winner; all later attempts return the stored terminal result or a conflict without another workflow mutation.

Acceptance never applies a recommendation directly. It submits the corresponding canonical command through the normal permission, idempotency, condition, expected-version, audit/event, task/timer, and outbox path. Rejection records the reason and audit/event without changing workflow state.

## 11. Implementation sequence

After approval:

1. Capture preflight evidence, baseline results, final dependency/value inventory, and the exact `000033` delta.
2. Implement migration `000033` with guarded status mapping, constraints/indexes/triggers required by this plan, and a reversible down path that first proves downgrade safety.
3. Implement the canonical lifecycle and version/publication command boundaries.
4. Add condition publication validation and the deterministic evaluator.
5. enforce work-item organization isolation for all ten operation classes.
6. Add fenced timer/SLA/escalation scheduling and execution.
7. Replace legacy direct writes with the compatibility adapter.
8. Add AI recommendation commands and concurrency controls.
9. Remediate test isolation and complete evidence documentation.

Each slice must keep the suite runnable and must not weaken an invariant temporarily. No merge, tag, or deployment is authorized.

## 12. Required verification and approval evidence

The implementation is not complete until all of the following are recorded with commands, timestamps, database identity, and results:

1. Migration preflight: exact host/port/database, server identity, highest migration, checksum validation, and proof `000033` is unused before application.
2. Apply/checksum: apply through `000033` once and validate every checksum.
3. Rerun no-op: apply again and prove no schema/data change.
4. Rollback rehearsal: restore a disposable verified copy, roll `000033` back, and prove downgrade invariants or documented fail-closed guards.
5. Forward reapplication: reapply `000033` and reproduce checksums/invariants.
6. Focused tests for every independent-review finding and every rule in sections 2–10, including negative authorization and concurrency cases.
7. Complete integration suite sequentially against `127.0.0.1:5433/govos_db` after safe isolation setup.
8. Root and required workspace TypeScript checks, then all required production builds.
9. Final invariant SQL covering status domains/transitions, one published default, no non-published defaults, tenant/organization joins, duplicate timers/reminders/breaches/escalations, active leases/fences, terminal recommendations, and enabled triggers.
10. Secret scan and generated/untracked artifact scan over the exact staged diff.
11. Manual UI acceptance for work queues, detail/history, claim/assign/reassign/complete/cancel, version publication/default rotation, condition errors, timer/escalation visibility, and AI accept/reject/stale behavior under at least two organizations.
12. Create `docs/ecogov/WF1_REVIEW_RESPONSE.md`, mapping every independent-review finding to `fixed`, `deferred by ADR-004`, `implemented under another name`, or `obsolete`, with code/migration/test/evidence references and no unmapped finding.

Final delivery requires implementation, verification evidence, a reviewed commit, and push to `origin/codex/implementation`. It must not merge, tag, or deploy.
