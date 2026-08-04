# WF-1 Database Model

Status: Implemented by authorized additive migration `000031`

## Evolution rules

- Additive migration, fully idempotent and tenant-composite throughout.
- No destructive rewrite of existing instances, steps, audits, tasks, or outbox rows.
- Backfill in bounded, restartable phases; add constraints `NOT VALID`, verify, then validate.
- UUID primary keys; UTC timestamps; positive integer `version`; explicit checks; `ON DELETE RESTRICT` for authoritative records.

## Existing tables retained and evolved

### `workflow_definition`

Add `key` (stable normalized identifier), `scope` (`tenant|system_template`), `status` (`active|archived`), `version`, `created_by`, `updated_by`. Unique `(tenant_id,key)`; names remain display values.

### `workflow_version`

Expand status to `draft|validating|published|deprecated|withdrawn`; add semantic version fields, `definition_schema_version`, canonical `configuration`, `configuration_hash NOT NULL` at publish, validation report, `published_from_version_id`, and row `version`. Only draft is mutable. One published default version per definition; deprecated versions remain executable by pinned instances.

### `workflow_step_definition`

Add stable `step_key`, handler/task name and version, input/output schema references, assignment policy ID, SLA policy ID, retry policy, permission requirements, redaction policy, and row version. Unique `(tenant_id,version_id,step_key)`.

### `workflow_transition`

Add stable `transition_key`, guarded condition AST, condition schema version, is-default, and row version. Enforce one default per source step and deterministic priority/order.

### `workflow_instance`

Add `definition_id`, `business_key`, `correlation_id`, `idempotency_key`, `version`, `started_by`, `started_at`, `completed_at`, `cancelled_at`, `suspended_at`, `terminal_outcome`, redacted context, context hash, and expanded status `pending|running|waiting|suspended|completed|cancelled|failed`. Unique `(tenant_id,definition_id,idempotency_key)` when provided and optionally `(tenant_id,definition_id,business_key)` for configured singleton workflows.

### `workflow_step_execution`

Add `execution_number`, `version`, `available_at`, `started_at`, `due_at`, `claimed_at`, `claimed_by`, `outcome_code`, `input_hash`, `output_reference`, `failure_code`, `retry_count`, `max_attempts`, `task_execution_id`, and statuses `created|ready|claimed|running|waiting|completed|failed|cancelled|skipped|dead_lettered`. Unique `(tenant_id,workflow_instance_id,step_definition_id,execution_number)`.

### `workflow_audit`

Retain for compatibility but write new events to `workflow_event`; later expose a union projection. Never delete or update audit/event rows.

## New tables

| Table | Purpose and principal columns |
| --- | --- |
| `workflow_event` | Ordered append-only event: tenant, instance, `sequence_number`, event type, actor type/ID, command ID, correlation/request IDs, resource IDs, redacted metadata, created_at. Unique `(tenant_id,instance_id,sequence_number)` and `(tenant_id,command_id,event_type)` where appropriate. |
| `workflow_command` | Idempotency ledger: tenant, command ID/key, instance, command type, request hash, actor, status, response reference/hash, timestamps. Unique `(tenant_id,idempotency_key)`; same key/different hash is 409. |
| `workflow_assignment_policy` | Versioned role/permission/organization strategy for a human step. |
| `workflow_work_item` | Human assignment/claim: tenant, org, instance, step execution, assignee user/role/queue, status, version, claim/due/completion timestamps. One current work item per execution. |
| `workflow_timer` | Durable wake-up: timer type, instance/step, due_at, status, lease owner/expiry, dedup key, fired_at. |
| `workflow_calendar` | Tenant calendar identity/time zone/status/version. |
| `workflow_calendar_window` | Weekly working intervals; validated non-overlap. |
| `workflow_calendar_exception` | Holiday/closure/override intervals. |
| `workflow_sla_policy` | Versioned target duration, calendar, start/pause/stop events, warning thresholds, breach behavior. |
| `workflow_sla_clock` | Per instance/step clock: policy version, state, accumulated duration, warning/due/breached timestamps, version. |
| `workflow_escalation_policy` | Ordered levels and trigger offsets; immutable when published. |
| `workflow_escalation_action` | Idempotent action execution with status, target IDs, task/outbox IDs, attempt/error metadata. |
| `workflow_definition_permission` | Exact definition/command permission mapping; tenant-bound permission FK. |

## Integrity constraints

- Every child carries `tenant_id`; every relationship uses `(tenant_id,id)` composite FKs.
- Step and transition version IDs must match both endpoint steps; enforce via composite keys/FKs, not application-only checks.
- An instance's `definition_id` must match its pinned version's definition.
- Work item organization must match the target membership scope where assigned.
- Terminal timestamps/statuses, leases, retry bounds, deadlines, and event sequences have check constraints.
- Partial unique indexes prevent multiple current assignments, timers, SLA clocks, active default versions, and action duplicates.
- Append-only triggers/privilege controls prohibit update/delete on events and completed commands outside an approved retention/archive process.

## Query indexes

Claimable tasks/timers by `(status,available_at/due_at)`; human inbox by `(tenant_id,organization_id,assignee,status,due_at)`; instance lookup by entity/business key; events by instance/sequence; overdue clocks by next evaluation time; definition/version status; operational partial indexes for active states only.

## Migration preflight

Highest migration/checksums; invalid workflow graphs; multiple entry/defaults; cross-tenant references; duplicate business/idempotency keys; orphan definitions/steps/transitions; status distributions; active task leases; null hashes; workflow/audit row counts; table/index name collisions. Any unexpected result blocks migration drafting/apply.
