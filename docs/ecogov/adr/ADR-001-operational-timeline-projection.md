# ADR-001: GovOS Operational Timeline Service

## Status
Approved (Revised EMIS-1A Gate Closure)

## Context
EcoGov AI v2.0 and future GovOS applications require a standard universal operational timeline that displays historical events across multiple domains (e.g., facilities, audits, inspections, incidents, permits, property tax assessments, demand notices).

Rather than writing application-specific timeline builders, we are establishing the **GovOS Operational Timeline Service** as a first-class GovOS platform service (alongside the Workflow Engine, AI Runtime, Notifications, Audit, and Reporting services) residing in GovOS Core. EcoGov AI and all future GovOS domain products (e.g., Property Tax, Health, Education, Land) consume this core service.

### Analysis of Existing Source Table Deficiencies

1. **`authz_audit_log`**: Strictly limited to security authorization and RBAC auditing events (granting, checking, or denying accesses). It lacks domain-level aggregate IDs, summaries, and polymorphic details.
2. **`workflow_instance`**: Contains only the current active state of running workflows (e.g. status, parent tenant). It does not maintain chronological history or logs of past transitions.
3. **`workflow_step_execution` & `workflow_audit`**: Bound strictly to step executions within a workflow instance. They cannot capture actions outside a formal workflow (e.g., manual compliance audits, external uploads, or un-routed citizen report triages).
4. **`task_execution`**: Serves as the queue execution state for background workers. It tracks worker heartbeats, lock times, and retry counts, but lacks user-facing event descriptions or aggregate contexts.
5. **`ai_execution` & `ai_execution_event`**: Locked to Vertex AI execution runs, prompts, tool calls, and tokens. They contain highly verbose system details rather than redacted environmental summaries.

---

## Decisions

### 1. Unified Platform Service
The operational timeline is implemented as a core platform service. Every GovOS domain object (e.g., Facility, Permit, Inspection, Incident, Property, Invoice) will automatically receive a default "History" tab powered by `OperationalTimelineService.query()`, eliminating duplicate auditing code.

### 2. Consistency Model: Outbox-Driven Projection
We will use an **outbox-driven consistency model** utilizing the existing platform database structures:
* **Outbox Infrastructure**: We will use the canonical `outbox_event` table to record source domain events transactionally.
* **Worker Processing**: Background workers reading `outbox_event` will project events into the timeline via `OperationalTimelineService`.
* **Delivery Semantics**: At-least-once event delivery is guaranteed.
* **Duplicate Rejection**: Rejection is enforced at the database level by a unique index on `(tenant_id, event_key)`.
* **Ordering**: Ordering is strictly preserved by sorting outbox messages by sequence `id` per aggregate group.
* **Lag & Dead-Letter Handling**: If a projection fails, the outbox record status is updated to `'failed'` in the `outbox_event` table, and the failure is logged in the `task_execution` table as `'permanently_failed'` for administrative visibility.
* **No Write-on-Read**: Reading the timeline (`GET`) is strictly read-only and will never trigger mutations. Historical backfills will be managed via one-time migration scripts or a dedicated worker backfill command.

### 3. Aggregate Identity vs. Source Event Identity
To maintain precise tracking and lineage, we separate the logical identity levels:
* **Aggregate ID (`aggregate_id`)**: The ID of the aggregate root representing the primary subject (e.g., a Facility `F1` or a Permit `P88`).
* **Source ID (`source_id`)**: The ID of the specific target domain entity (e.g., a specific `facility_registration` `R10`).
* **Source Event ID (`source_event_id`)**: The ID of the specific transactional trigger that generated this event (e.g., a specific `workflow_transition` `T54` or `ai_execution` `A102`).

### 4. Rebuild and Replay Strategy
The timeline table is disposable. The system will support rebuilding the timeline from authoritative source tables (workflow logs, AI attempts, facility registries) by executing:
* `rebuildAggregateTimeline(tenantId, aggregateType, aggregateId)`
* `rebuildTenantTimeline(tenantId)`
* `verifyTimelineProjection(tenantId)` (re-runs count verification against source records)

#### Trigger Bypass Policy
To prevent normal application code from modifying timeline records, the table has an append-only trigger. To support rebuild/replay maintenance operations:
1. The trigger function checks if the custom session parameter `ecogov.timeline_maintenance` is set to `'on'` **AND** verifies that the active database role possesses database owner or designated maintenance administrator privileges.
2. Authorized rebuild/backfill procedures must run under the designated maintenance role (or via a `SECURITY DEFINER` maintenance procedure owned by the database schema owner) and set `SET LOCAL ecogov.timeline_maintenance = 'on';` inside the transaction.

### 5. Event Identity & Keys
The `event_key` uniqueness constraint enforces a strict generation format based on immutable source-event identifiers:
```text
event_key = <source-type>:<source-event-id>:<source-event-type>:<projection-version>
```
If a source entity has no separate event record, it must include its concurrency version:
```text
event_key = <source-type>:<source-id>:<source-event-type>:v<source-version>
```

### 6. Event Immutability Rule
Timeline events are treated as public API contracts. **Once published, timeline event names and schemas are immutable and must never be renamed or structurally modified.** If a lifecycle step changes, a new event type must be introduced.

### 7. Event-Time Semantics
The timeline preserves three distinct timestamps:
* `occurred_at`: When the event occurred at source (copied from source).
* `created_at`: The insertion time of the projection record.
* `projected_at`: When the outbox worker processed the event.

Timeline ordering is determined by `source_occurred_at DESC, id DESC`.

### 8. Actor Model
We support a polymorphic actor model representing all operational entities:
* `user`: Authenticated ministry staff (`actor_user_id` points to `user_account`).
* `subcontractor`: Licensed subcontractors (`actor_subcontractor_id` points to `subcontractor_profile`).
* `ai`: Automated AI review agents.
* `system`: Cron tasks or backend workflows.
* `integration`: External partner systems or API keys.
* `external`: Public citizens or unauthenticated applicants.

### 9. Redaction Allowlist Policy
Timeline events use event-specific allowlists to filter metadata before insertion.
The timeline must **never** copy credentials, tokens, storage keys, unrestricted officer notes, personal contact details, or raw AI provider payloads.

---

## 5. GovOS Timeline Service API Contract

The core platform service defines a stable interface that all applications implement. It includes subscription methods to support real-time dashboards via WebSockets or Server-Sent Events:

```typescript
interface OperationalTimelineService {
  /**
   * Appends an event to the transactional outbox table
   */
  append(event: TimelineEventInput): Promise<void>;

  /**
   * Projects a dispatched outbox event into the timeline table
   */
  project(outboxEventId: string): Promise<void>;

  /**
   * Rebuilds the timeline projection from authoritative sources
   */
  rebuild(options: RebuildOptions): Promise<void>;

  /**
   * Queries the timeline with cursor-based pagination
   */
  query(filter: TimelineQueryFilter): Promise<TimelineCursorResult>;

  /**
   * Generates a localized textual summary from raw event metadata
   */
  summarize(event: TimelineEventRecord): string;

  /**
   * Registers a callback to watch for matching live events
   */
  watch(filter: TimelineQueryFilter, callback: (event: TimelineEventRecord) => void): () => void;
}
```

## Consequences
- High-performance cross-cutting queries.
- Clean separation of concerns between business execution and timeline reads.
- Rebuildable read-model layout with complete audit control.
- Reusable timeline capability across all GovOS domain products.
