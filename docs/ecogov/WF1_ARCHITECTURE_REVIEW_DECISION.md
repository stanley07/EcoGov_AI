# WF-1 Enterprise Workflow Engine Architecture Review Decision

Status: **Approved**

Date: 2026-08-04

## 1. Approved Architecture & Core Strategy

We approve the **Enterprise Workflow Engine (WF-1)** architecture.
* **Database Authoritative State**: Workflows execute in a single serializable PostgreSQL transaction. Running instances are permanently pinned to their immutable published version.
* **Infrastructure Reuse**: WF-1 will reuse the existing `task_execution` system for machine tasks and `outbox_event` for domain event dispatch. We prohibit building parallel queueing or lease mechanisms.
* **Concurrency**: We approve optimistic concurrency checks (`version` / CAS) on instances, step executions, and work items to prevent concurrent transitions.

---

## 2. Exact Workflow Permission Vocabulary

We approve the following granular permission taxonomy for all new WF-1 endpoints:

### Definition Plane
* `workflow:definition:read`
* `workflow:definition:create`
* `workflow:definition:update`
* `workflow:definition:validate`
* `workflow:definition:publish`

### Instance Plane
* `workflow:instance:read`
* `workflow:instance:start`
* `workflow:instance:suspend`
* `workflow:instance:resume`
* `workflow:instance:cancel`
* `workflow:instance:repair`

### Human Work Plane
* `workflow:work-item:read`
* `workflow:work-item:claim`
* `workflow:work-item:assign`
* `workflow:work-item:complete`

### SLA & Operations Plane
* `workflow:policy:read`
* `workflow:policy:write`
* `workflow:policy:publish`
* `workflow:audit:read`
* `workflow:operations:read`

New API endpoints must authorize exclusively using these permissions. The legacy `user:write` and platform-specific permissions must not be mapped.

---

## 3. Scope & Deferred Capabilities

### Approved WF-1 Scope
* Definition authoring, graph validation, and immutable publishing.
* Transaction-safe instance execution and step-state changes.
* Durable human work items with direct and role/organization queue assignments.
* Durable timers, simple elapsed-time SLA deadlines, and idempotent reminders/escalations.
* Read-only AI recommendations surfaced to human assignees.

### Approved Deferrals
* Graphical free-form workflow editor canvas.
* BPMN schema import/export.
* Parallel gateways (Fork/Join) and subworkflows.
* Unbounded workflow loops.
* Automatic in-flight instance migration to new versions.
* Calendar-aware SLA business-hours calculations.
* Direct AI state transitions (AI must never mutate workflow state directly).
* Multi-region active-active database replication.

---

## 4. Operational, Timer, and AI Boundaries

### Event Replay Decision
* Event replay is approved **only** for history tracking and auditing. Replay must never be used to drive active state machine transitions.

### Human Assignment Methods
* **Approved**: Direct user assignment, Role-based queue, and Organization-based queue.
* **Deferred**: Round-robin allocation and least-workload routing.

### SLA & Timer Rules
* SLA clock pauses are pauseable only based on explicit policy criteria (audited with reason codes).
* Timer firing is idempotent, and escalation actions must not execute automatic domain approvals (e.g., payment confirmation or licensing).

### AI Boundary
* AI agents can only offer **recommendations** to human actors. Accepting an AI recommendation must go through the standard permission and validation checks. Direct AI state mutation is forbidden.

---

## 5. Migration and Rollout Strategy

* **Migration Strategy**: Option C (Schema/index changes via migration `000031`, with controlled data-reconciliation scripts for seeding configuration data).
* **Rollout and Compatibility**: Existing workflows run unaffected. Pinned active instances will drain on their original versions. Feature flags will enable WF-1 path routing per-tenant.

---

## 6. Implementation Gates & Authorization

* Finalizing ADR-004 is **Approved**.
* Drafting migration `000031` and starting WF-1 implementation is **Authorized**.
