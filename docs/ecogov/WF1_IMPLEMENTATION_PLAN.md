# WF-1 Enterprise Workflow Engine Implementation Plan

Status: Implemented on `codex/implementation`; ADR-004 accepted 2026-08-04

## Objectives

- Govern definition authoring, validation, publication, deprecation, and cloning.
- Execute deterministic tenant-bound workflow instances across human, service, agent, notification, validation, command, timer, and branch steps.
- Provide assignments, claims, due dates, SLA clocks, escalation, cancellation, suspension, retry, replay, and operational inspection.
- Preserve existing registration, complaint, AI, notification, payment, licence, task, outbox, audit, IAM, and platform behavior.

## Current-state findings

- Migration 000003 provides the core definition/runtime schema and tenant-composite foreign keys.
- `validateWorkflowGraph` enforces one entry, terminal reachability, and no terminal outgoing edge, but not transition determinism, cycles, schemas, permissions, timers, or task registrations.
- `createWorkflowInstance` pins a version; `transitionWorkflowInstance` performs a basic CAS on pending/processing status but has no aggregate version, command idempotency, event sequence, assignment, or condition evaluator.
- `task_execution` supports tenant-scoped IDs, leases, heartbeats, exponential retry, encrypted payloads, and terminal failure. Claiming is fragmented in worker code.
- `outbox_event` provides deduplication and leased dispatch for domain events.
- `workflow_audit.details` is unconstrained JSON and lacks actor, sequence, correlation, and denial metadata.
- No first-class definition API, runtime command API, human inbox, SLA calendar, timer scheduler, escalation policy, or repair console exists.

## In scope

Architecture/domain types, additive migration, core engine services, compatibility facade, definition/runtime/admin APIs, worker task coordinator, timer/SLA evaluator, escalation processor, operational UI/API, exact permissions, audit, metrics, focused tests, rollout and rollback evidence.

## Out of scope

Visual drag-and-drop designer, arbitrary user code/scripts, BPMN import/export, cross-tenant workflows, distributed transactions, compensation DSL beyond explicit compensation steps, automatic migration of in-flight instances, replacing payment/licence outbox flows, and Gate-specific EMIS module redesigns.

## Staged delivery gates

1. Architecture approval: ADR and all WF-1 specifications accepted.
2. Schema gate: read-only preflight, migration design/rehearsal, backup/rollback approval.
3. Definition plane: schemas, validator, draft/publish/deprecate APIs; no runtime activation.
4. Runtime kernel: commands, CAS, events, compatibility adapter, no tenant enabled by default.
5. Task/timer plane: central lease service, scheduler, retries, dead letter, restart recovery.
6. SLA/escalation plane: calendars, clocks, policy evaluator, notifications/assignments.
7. Pilot: one non-financial workflow shadow-compared with legacy behavior.
8. Controlled activation: per-tenant/per-workflow feature flag; no global cutover.
9. Legacy retirement: only after equivalence, drain, rollback-window, and owner approval.

Implementation note: WF-1 ships feature-dark at the permission boundary. Existing workflow callers continue through the compatibility services; new canonical `/v1/workflows` routes require exact WF-1 permissions and never infer platform authority.

## Architectural impact

- Database: additive tables/columns/indexes described in `WF1_DATABASE_MODEL.md`; anticipated migration 000031 only after approval.
- API/UI: administrative definition and operations surfaces plus human work inbox; detailed contract in `WF1_API_SPECIFICATION.md`.
- Core: aggregate command service, publisher validator, deterministic condition evaluator, assignment service, SLA service.
- Worker: common claim/heartbeat/complete/fail library and typed executors; no raw route callbacks.
- Observability: queue depth/age, lease loss, retries, deadline breaches, escalation latency, stuck instances, command conflicts.

## Testing strategy

Unit tests for graph/state/conditions/calendars/backoff; database constraints and concurrency integration; API authorization/isolation/idempotency; worker lease/restart/duplicate delivery; SLA and escalation time-controlled tests; legacy equivalence; failure injection; performance and accessibility; complete sequential regression.

## Acceptance criteria

- Published definitions are immutable, hash-verifiable, tenant-safe, deterministic, and fully validated.
- Concurrent/replayed commands produce one transition and one set of side effects.
- Human work cannot be claimed/completed outside authorized tenant/organization/role scope.
- Task loss, worker restart, stale owners, retries, and dead-letter repair are proven.
- SLA deadlines and escalation actions are deterministic and exactly-once in effect.
- Existing workflows remain operational behind compatibility paths; financial issuance remains asynchronous.
- All verification gates and evidence are complete before activation.
