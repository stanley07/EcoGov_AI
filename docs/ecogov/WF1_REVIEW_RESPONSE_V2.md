# WF-1 Independent Review Response V2

## 1. Review scope and disposition standard

This response addresses the independent review of commit `2513d43b2dba4ed7dcc888b201a5e32841f53a6f`. Each numbered P0, P1, and P2 finding is classified as `ACCEPTED`, `REJECTED`, or `DEFERRED`. The review's separate rollback-safety failure is included as cross-cutting finding R-11 because it affects release authorization.

No finding is rejected or deferred. All ten numbered findings and R-11 are accepted. The implementation is therefore not approved for merge or production until the accepted findings are remediated and independently reverified.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R-01 | P0 | Timer and SLA worker loops are dead at runtime | `ACCEPTED` |
| R-02 | P0 | Escalation engine records completion without executing actions | `ACCEPTED` |
| R-03 | P0 | Legacy-adapter active-tenant query regresses existing integration tests | `ACCEPTED` |
| R-04 | P1 | AI recommendation acceptance is not one transaction | `ACCEPTED` |
| R-05 | P1 | Organization isolation is absent from instance detail/history/management paths | `ACCEPTED` |
| R-06 | P1 | Condition evaluator omits approved operators | `ACCEPTED` |
| R-07 | P1 | Definition-permission table is unused | `ACCEPTED` |
| R-08 | P2 | WF-1 tests are primarily source-string assertions | `ACCEPTED` |
| R-09 | P2 | Operations metrics leak tenant-wide organization data | `ACCEPTED` |
| R-10 | P2 | Validation failure cannot return a version to draft | `ACCEPTED` |
| R-11 | Release invariant | Migration rollback depends on an undocumented manual down procedure | `ACCEPTED` |

## 2. P0 findings

### R-01 — Timer and SLA worker loops are dead at runtime

**Disposition: `ACCEPTED`.**

The reviewer is correct because `WorkflowRuntimeWorker` defines `scheduleDue()` and `runDueTasks()` in `apps/worker/src/workflow-runtime.ts`, while the only production reference is a re-export from `apps/worker/src/app.ts`. Neither `apps/worker/src/server.ts` nor `apps/worker/src/index.ts` constructs the class, starts a bounded polling loop, or invokes either method. Consequently, persisted `workflow_timer` and `workflow_sla_clock` records have no production execution path.

Affected files:

- `apps/worker/src/workflow-runtime.ts`
- `apps/worker/src/app.ts`
- `apps/worker/src/server.ts`
- `apps/worker/src/index.ts`

Affected invariant: every durable due timer/SLA clock must eventually be claimed through the approved leased/fenced task infrastructure, subject to retry and terminal-state rules. This is required by `WF1_REMEDIATION_PLAN.md` §6 and ADR-004's approved durable task/timer model.

Minimum remediation:

- Instantiate one runtime scheduler per worker process through the existing worker startup lifecycle.
- Start a cancellable, bounded poll loop that calls `scheduleDue()` and `runDueTasks()` without overlapping ticks.
- Tie startup/shutdown to Fastify/process lifecycle hooks and await in-flight work during shutdown.
- Add operational error handling, bounded backoff, health visibility, and integration tests proving a due timer is processed without a direct test call to private implementation logic.

### R-02 — Escalation engine records completion without executing actions

**Disposition: `ACCEPTED`.**

The reviewer is correct. `apps/worker/src/workflow-runtime.ts` `processBreach()` validates the action type and inserts `workflow_escalation_action` rows directly with status `completed`. It does not reassign a work item for `reassign`, enqueue a notification/outbox record for `notify`, append the required workflow/audit event, or verify completion of an external side effect. Marking an action complete before its effect exists violates both semantics and crash recovery.

Affected files:

- `apps/worker/src/workflow-runtime.ts`
- `modules/govos-core/src/workflow-engine.ts` (published escalation snapshot and work-item command path)
- `packages/ai/src/runtime/outbox-service.ts` (existing durable outbox claim/retry implementation)
- `packages/database/migrations/000019_agent_outbox_and_tool_audit.sql` (existing outbox schema)
- `packages/database/migrations/000031_enterprise_workflow_engine.sql` (current escalation table definition)

Affected invariant: escalation actions are idempotent commands whose database state reflects the actual action lifecycle; reassignments must use normal organization/RBAC/version rules, and notifications must use the durable outbox. `WF1_REMEDIATION_PLAN.md` §6 explicitly requires outbox/idempotency before a source record is marked fired.

Minimum remediation:

- Create actions as `pending`, not `completed`.
- Execute `reassign` through the canonical work-item assignment command with organization eligibility and optimistic concurrency.
- Execute `notify` by atomically writing the approved outbox event with the escalation idempotency identity.
- Mark an action `completed` only after its transactional effect/outbox enqueue succeeds.
- Append immutable workflow and audit events, and retain retryable/permanent failure classification.

### R-03 — Legacy-adapter active-tenant query regresses existing integration tests

**Disposition: `ACCEPTED`.**

The reviewer is correct. `modules/govos-core/src/workflow.ts` now wraps legacy transitions with `EnterpriseWorkflowEngine.runLegacyAdapter()`. That method in `modules/govos-core/src/workflow-engine.ts` issues an additional active-tenant query before legacy transition SQL. Existing mocked clients in `packages/testing/src/milestone2.test.ts`, `packages/testing/src/milestone4.test.ts`, `packages/testing/src/milestone5.test.ts`, and `apps/api/tests/workbench-projection.test.ts` do not model that query and return no tenant row, producing `WF_TENANT_INACTIVE`/403 failures. The review independently reproduced seven failures.

Affected files:

- `modules/govos-core/src/workflow.ts`
- `modules/govos-core/src/workflow-engine.ts`
- `packages/testing/src/milestone2.test.ts`
- `packages/testing/src/milestone4.test.ts`
- `packages/testing/src/milestone5.test.ts`
- `apps/api/tests/workbench-projection.test.ts`

Affected invariant: backward compatibility must preserve existing facility-registration, complaint, and AI-review workflow behavior while retaining active-tenant enforcement. `WF1_REMEDIATION_PLAN.md` §7 prohibits weakening tenant context but also requires legacy/canonical equivalence.

Minimum remediation:

- Preserve the active-tenant check in production.
- Make tenant validation an explicit dependency or shared canonical guard whose contract is represented in test clients.
- Update all affected mocks/fixtures to return an active same-tenant record for the guard and add inactive-tenant negative cases.
- Add real-database legacy/canonical equivalence tests so mocks cannot conceal query-order or transaction differences.

## 3. P1 findings

### R-04 — AI recommendation acceptance is not transactionally encapsulated

**Disposition: `ACCEPTED`.**

The reviewer is correct. In `EnterpriseWorkflowEngine.decideRecommendation()` the accepted path first reads recommendation/instance/membership using the pool, then calls `transition()` (which opens its own transaction and marks active recommendations stale), and finally performs a separate update from `stale` to `accepted`. Concurrent decisions can observe the same active recommendation, and a crash after transition commit leaves the recommendation stale despite the transition succeeding.

Affected files:

- `modules/govos-core/src/workflow-engine.ts`
- `apps/api/src/routes/workflows.ts`

Affected invariant: recommendation decision and the normal canonical command must have one atomic outcome under locks and expected instance version. `WF1_REMEDIATION_PLAN.md` §10 requires acceptance/rejection to lock the recommendation and instance, have one concurrent winner, and use the normal command path.

Minimum remediation:

- Refactor the canonical transition implementation into a transaction-aware internal command accepting an existing `PoolClient`.
- In one serializable transaction, lock recommendation and instance, verify active/scope/version, execute the normal transition command, and mark only that recommendation accepted.
- Do not use `stale` as an intermediate accepted state.
- Ensure rollback removes all transition, event, task, timer, audit, outbox, and recommendation changes.

### R-05 — Organization isolation is absent from instance detail, history, management, and work-item-less transition

**Disposition: `ACCEPTED`.**

The reviewer is correct. `apps/api/src/routes/workflows.ts` scopes instance detail and event history only by tenant and instance ID. Suspend/resume/cancel update by tenant, ID, version, and state without active organization membership. The transition endpoint calls the engine without organization context, and the engine checks organization membership only when `workItemId` is supplied. Omitting it bypasses organization scope.

Affected files:

- `apps/api/src/routes/workflows.ts`
- `modules/govos-core/src/workflow-engine.ts`

Affected invariant: all instance/work-item reads and mutations must enforce same-tenant and allowed-organization scope and must return tenant-safe not-found for inaccessible IDs. This follows ADR-004's organization isolation decision and `WF1_REMEDIATION_PLAN.md` §4.

Minimum remediation:

- Centralize an organization-scope predicate/service for instance reads and mutations.
- Apply it to instance list, detail, events/history, transition, suspend, resume, cancel, and nested work-item/timer projections.
- Pass actor organization scope to canonical engine commands and repeat authorization under the mutation lock.
- Permit tenant-wide access only through the explicitly approved exact tenant-wide permission, never generic administrator status.
- Add two-organization positive and negative integration tests for every endpoint.

### R-06 — Condition evaluator omits approved operators

**Disposition: `ACCEPTED`.**

The reviewer is correct. `validateTransitionCondition()` admits only `equals`, `eq`, `all`, `any`, and `not`. The approved plan requires `literal`, `var`, `exists`, `not`, `all`, `any`, `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, and `in`. Runtime evaluation likewise implements equality and boolean composition only.

Affected files:

- `modules/govos-core/src/workflow-engine.ts`
- `packages/testing/src/wf1-remediation.test.ts`

Affected invariant: publication and runtime use the same deterministic, bounded, typed condition language, with no implicit coercion and an explicit missing-variable policy. See `WF1_REMEDIATION_PLAN.md` §5.

Minimum remediation:

- Implement and validate `literal`, `var`, `exists`, `neq`, `lt`, `lte`, `gt`, `gte`, and `in` in addition to the existing operators.
- Enforce identical compatible types, finite numeric values, homogeneous bounded membership lists, and the distinct missing sentinel.
- Retain current depth/node/byte/path bounds and executable-payload prohibitions.
- Add exhaustive publication and runtime tests for every operator and invalid type/path/boundary.

### R-07 — `workflow_definition_permission` is unused

**Disposition: `ACCEPTED`.**

The reviewer is correct. Migration `packages/database/migrations/000033_wf1_remediation.sql` creates `workflow_definition_permission`, but application searches show no read or write outside the migration. Definition and instance endpoints use only global workflow permissions. This contradicts the plan's classification of the object as `REQUIRED_BY_ACCEPTED_WF1`.

Affected files:

- `packages/database/migrations/000033_wf1_remediation.sql`
- `apps/api/src/routes/workflows.ts`
- `modules/govos-core/src/workflow-engine.ts`
- definition/version administration UI/API tests as applicable

Affected invariant: start and definition-level commands must satisfy both the global operation permission and the definition-bound permission mapping where configured. The authority is `WF1_REMEDIATION_PLAN.md` §8.

Minimum remediation:

- Define the exact mapping-management API/command and authorization rules.
- Query the mapping for start/read/cancel/suspend/resume/repair using tenant and definition predicates.
- Fail closed when a required mapping is absent; do not interpret absence as wildcard access.
- Include mappings in definition/version publication evidence where version binding is required.
- Add cross-definition and delegated-administrator tests.

## 4. P2 findings

### R-08 — WF-1 remediation tests use source-string assertions instead of runtime integration

**Disposition: `ACCEPTED`.**

The reviewer is correct. `packages/testing/src/wf1-remediation.test.ts` and `wf1-contract.test.ts` predominantly read source/migration files and assert substrings. They establish presence, not behavior. They do not prove database triggers, concurrent command outcomes, organization isolation, worker polling, fencing, crash recovery, escalation effects, or AI atomicity.

Affected files:

- `packages/testing/src/wf1-remediation.test.ts`
- `packages/testing/src/wf1-contract.test.ts`
- new focused integration test files under `packages/testing/src` and `apps/worker`

Affected invariant: evidence must demonstrate each independent-review finding through executable behavioral tests. `WF1_REMEDIATION_PLAN.md` §12 requires focused negative authorization, concurrency, worker, and migration tests.

Minimum remediation:

- Retain limited static migration contract tests only where appropriate.
- Add real PostgreSQL tests for version/step triggers, conditions, organization access, recommendation concurrency, legacy equivalence, and rollback.
- Add worker integration tests that start the production polling lifecycle and observe reminder, breach, notification, and reassignment results.
- Use isolated schemas/databases or the sequential destructive-test lane with database identity assertions.

### R-09 — Tenant-wide operations metrics leak other organizations' data

**Disposition: `ACCEPTED`.**

The reviewer is correct. `GET /v1/workflows/operations` in `apps/api/src/routes/workflows.ts` aggregates by tenant only. An actor holding `workflow:operations:read` through an organization-scoped membership can see counts belonging to other organizations.

Affected files:

- `apps/api/src/routes/workflows.ts`
- operations API tests and any consuming UI

Affected invariant: counts, queue totals, and operational projections must use the same organization predicate as resource lists and must not disclose cross-organization existence. See `WF1_REMEDIATION_PLAN.md` §4.

Minimum remediation:

- Scope every subquery to organizations in which the actor has active membership.
- Add a separately authorized tenant-wide mode only if an exact approved tenant-wide permission exists.
- Ensure counts and drill-down lists use identical predicates.
- Add two-organization leakage tests.

### R-10 — Validation failure cannot return a version to draft

**Disposition: `ACCEPTED`.**

The reviewer is correct. `validateVersion()` validates the configuration before updating status, so a thrown validation error leaves a version in `draft`; however, once a version is successfully placed in `validating`, there is no command to record a later publication-validation failure and execute the approved `validating -> draft` transition. `replaceDraft()` also accepts only status `draft`, leaving such a version non-editable.

Affected files:

- `modules/govos-core/src/workflow-engine.ts`
- `apps/api/src/routes/workflows.ts`
- workflow version API tests

Affected invariant: version transitions are command-owned and exactly include `validating -> draft` as the recorded validation-failure path. See `WF1_REMEDIATION_PLAN.md` §3.

Minimum remediation:

- Make validation a command that records `validating` and its report deterministically.
- On validation/publication validation failure, atomically store a bounded failure report and return the version to `draft`.
- Reject arbitrary client-driven rollback and retain optimistic concurrency.
- Add success, failure, stale-version, and concurrent validation tests.

## 5. Cross-cutting release finding

### R-11 — Rollback safety depends on a manual, undocumented down procedure

**Disposition: `ACCEPTED`.**

The reviewer is correct that the official migration runner has no downgrade operation and migration 33 contains only forward SQL. The evidence document reports a manual rollback rehearsal, but the executable procedure is not versioned as an approved rollback artifact. Reverting application code while the canonical constraints remain can break legacy writers; removing constraints without guarded data checks can also be unsafe.

Affected files:

- `packages/database/src/index.ts`
- `packages/database/migrations/000033_wf1_remediation.sql`
- `docs/ecogov/WF1_ROLLBACK_STRATEGY.md`
- `docs/ecogov/WF1_REMEDIATION_EVIDENCE.md`
- existing `scripts/wf1-rollback-verification.mjs`, subject to verification and approval

Affected invariant: rollback must be reproducible, identity-checked, fail closed on post-enable data, and preserve processability of existing WF-1 instances. See ADR-004 rollback decisions and `WF1_REMEDIATION_PLAN.md` §12.

Minimum remediation:

- Version a supported, identity-asserting rollback rehearsal tool or formally document forward-fix-only rollback where destructive downgrade is unsafe.
- Add preconditions for canonical-only statuses, permissions, and records before any downgrade.
- Test application rollback compatibility against the retained schema and schema rollback against a disposable restored database.
- Record exact operator steps and recovery/forward-reapply behavior.

## 6. Approval consequence

Commit `2513d43b2dba4ed7dcc888b201a5e32841f53a6f` remains `NOT APPROVED`. WF-2 must not begin. A remediation implementation must address R-01 through R-11, execute the verification defined in `WF1_REMEDIATION_IMPLEMENTATION_PLAN_V2.md`, and receive a new independent review.
