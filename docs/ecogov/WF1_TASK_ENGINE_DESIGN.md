# WF-1 Task Engine Design

## Decision

Standardize existing `task_execution` as the durable command-work queue; retain `outbox_event` for domain/integration event dispatch. They are complementary and must not be conflated.

## Enqueue

Within the workflow transaction, validate the pinned handler registration and payload schema, store encrypted payload or secure reference, compute payload hash, and insert deterministic `(tenant_id,task_id)` where task ID derives from instance, step execution, attempt purpose, and handler version. Re-enqueue with same hash is a no-op; different hash is a collision.

## Claim and fencing

Workers atomically claim claimable/expired rows with `FOR UPDATE SKIP LOCKED` or fenced conditional update, increment attempt, set owner, lease expiry, heartbeat, and a monotonically increasing lease token. Every heartbeat/complete/fail checks tenant, row ID, owner, token, processing status, and unexpired lease. A stale owner can never complete.

## Execution

Registry resolves exact handler version and validates decrypted input. Executor is tenant-contextual, idempotent, timeout/cancellation-aware, and returns schema-validated metadata/reference. It does not directly advance workflow state; it submits an internal idempotent completion/failure command.

## Retry/dead letter

Failure taxonomy: retryable dependency/rate/timeout; nonretryable validation/policy/not-found; cancellation; lease loss. Exponential backoff with jitter, max attempts, maximum elapsed age, and policy caps. Exhaustion produces `permanently_failed`, a workflow event, SLA impact, and optional escalation. Repair previews then requeues with a new repair command while preserving attempts/history.

## Scheduler and timers

A scheduler claims due `workflow_timer` rows with the same lease/fencing discipline and enqueues a deterministic wake/SLA task. Multiple schedulers are safe. Database time is authoritative. Recovery scans expired leases and overdue due times after restart.

## Operational controls

Per-task concurrency, tenant fairness, rate limits, graceful shutdown/lease release, health/readiness, queue depth/oldest age, processing age, retries, lease loss, permanent failures, handler-version availability. Payload/log redaction is mandatory.

## Exactly-once statement

Transport is at-least-once. Effects are exactly-once in outcome through idempotency ledgers, unique keys, CAS, transactional state/event/outbox writes, and domain-level duplicate protection. Documentation and UI must not claim exactly-once delivery.
