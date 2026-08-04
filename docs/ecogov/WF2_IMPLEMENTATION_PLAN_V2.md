# WF-2 Notification Platform Implementation Plan V2

**Milestone**: WF-2 — GovOS Notification Platform
**Status**: Revised Implementation Plan
**Tag Baseline**: `wf-1-complete`
**Commit Baseline**: `5c3fcb16b2511eeb37de3f8f911de8188d9752d2`
**Date**: 2026-08-04

---

## 1. Objective & Revised Scope

Implement the ADR-005 notification platform additively in Migration 34, incorporating all security, multi-tenancy, and crash recovery corrections identified in the V1 review response (`WF2_REVIEW_RESPONSE.md`).

All approved IAM and WF-1 invariants are preserved. The development mailbox remains development-only, and legacy invitations continue to run under compatibility adapters.

---

## 2. Re-evaluated Inventory & Reuse Matrix

| Area                     | Decision              | Boundary & Changes                                                                                                                       |
| :----------------------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox_event`           | **REUSE**             | Domain events in, lifecycle events out. No changes to base schema.                                                                       |
| `task_execution`         | **REUSE / EXTEND**    | Delivery task queue. Uses 60-second lease and fencing tokens.                                                                            |
| `TaskRegistry`           | **EXTEND**            | Register versioned notification executors with input schemas.                                                                            |
| IAM/Session Guards       | **REUSE**             | Authenticates active membership, tenant context, and exact permissions.                                                                  |
| Development Mailbox      | **ADAPT**             | Ported behind the provider contract (non-production only).                                                                               |
| Invitation Compatibility | **ADAPT / DEPRECATE** | Reuses legacy task payload, but publishes telemetry metric `notification.compatibility.invitation.legacy_fallback_count` to track usage. |
| **Outbox & Timers**      | **ADAPT**             | Intake consumer translates approved events into requests.                                                                                |
| **Database Schemas**     | **NEW (REVISED)**     | Additive schemas in Migration 34. Incorporates composite keys for tenant isolation and lineage fields.                                   |
| **Webhook Client**       | **NEW (REVISED)**     | SSRF-safe outbound webhook engine resolving DNS on every retry.                                                                          |

---

## 3. Database Schema Modifications (Migration 34)

Migration 34 (`000034_notification_platform.sql`) will implement the revised schema, enforcing strict multi-tenancy isolation and audit trails:

1. **Composite Foreign Keys**:
   To prevent cross-tenant reference leaks at the database level, all child tables must use composite foreign keys referencing their tenant-qualified parents:
   - `notification_recipient(tenant_id, request_id)` references `notification_request(tenant_id, id)`
   - `notification_delivery(tenant_id, request_id)` references `notification_request(tenant_id, id)`
   - `notification_delivery_attempt(tenant_id, delivery_id)` references `notification_delivery(tenant_id, id)`
   - `notification_inbox_item(tenant_id, delivery_id)` references `notification_delivery(tenant_id, id)`
   - `notification_delivery_status_history(tenant_id, request_id)` references `notification_request(tenant_id, id)`
2. **Replay Audit Trail**:
   Add nullable `parent_request_id` to `notification_request` with a composite `(tenant_id,parent_request_id) REFERENCES notification_request(tenant_id,id)` foreign key. When a dead letter is replayed, the new request sets it to the immediate source request, preserves root/depth ancestry, creates new correlation/idempotency identities, and audits both parent and child.
3. **Template Version Isolation**:
   Add a nullable `tenant_id` column to `notification_template_version` that matches the parent template's `tenant_id`. `notification_template_binding` must reference `notification_template_version(tenant_id, id)` composite key.
4. **Rate Limit Buckets**:
   - Stored in `notification_rate_limit_bucket`.
   - Use token-bucket or sliding-window semantics, never fixed-window boundary resets.
   - Partition the rate limit table by day, retain transient buckets for 7 days by default, and use a bounded leased cleanup/partition-creation task to prevent ephemeral user/destination indexes from bloating the database.

---

## 4. State Machine & Recovery Adjustments

The delivery state machine is modified to support crash recovery of stuck tasks:

- **Stuck Task Recovery**:
  Add `sending --> queued` and `sending --> dead_lettered` to the permitted transitions list in the database check constraints and triggers.
  - If a task lease expires while in `sending` state, the recovery sweeper attempts provider reconciliation.
  - If the provider confirms non-delivery, transition `sending --> queued`.
  - If the outcome is ambiguous, transition `sending --> dead_lettered` to prevent duplicate sends.

---

## 5. Webhook SSRF & DNS Rebinding Protections

The webhook outbound client must implement the following safety sequence on _every_ HTTP attempt (including retries):

1. **Disable DNS Caching**: Disable local client-side DNS caching for webhook dispatch clients.
2. **Resolve Hostname**: Resolve the target hostname to an IP address just prior to socket connection.
3. **IP Range Check**: Assert the IP does not fall into private, loopback, link-local, or cloud metadata subnets (e.g. `10.0.0.0/8`, `127.0.0.0/8`, `169.254.169.254/32`).
4. **Connection Pinning**: Bind the socket connection directly to the resolved and verified IP address to prevent a DNS rebinding switch between validation and execution.

---

## 6. API Enhancements

Expose the following revised contracts:

- **Keyset Pagination**:
  Enforce keyset pagination using `(created_at, id)` cursor variables on high-volume endpoints:
  - `GET /v1/notifications/requests`
  - `GET /v1/notifications/deliveries`
  - `GET /v1/notifications/dead-letters`
  - `GET /v1/notifications/inbox`
    Offset pagination (`limit`/`offset`) is reserved only for low-volume catalogs (like `/templates`).
- **Audit Lineage**:
  Expose `parentRequestId` in request detail and list endpoints.
- **Binding Rotation Validation**:
  `PUT /template-bindings/:semanticKey` must check that `template_version.template_id` matches the template associated with the `semanticKey` before performing rotation.

---

## 7. Implementation Phases

- **Phase 1: Database & Migrations**: Draft Migration 34 with composite FKs, triggers, and parent lineage. Verify zero-op rerun and rollback rehearsal.
- **Phase 2: Core Routing & Deduplication**: Implement template bindings, resolver, and the `notification_deduplication_record` service.
- **Phase 3: Webhook Client & Sanitization**: Build outbound webhook client with DNS rebinding guards and HTML validators.
- **Phase 4: Worker Engine**: Implement the task claim loops with 60-second leases, fencing check, and stuck `sending` recovery rules.
- **Phase 5: Legacy Compatibility Mode**: Activate the invitation shim and emit the `notification.compatibility.invitation.legacy_fallback_count` metric.
- **Phase 6: Integration Tests**: Execute cross-tenant penetration tests, concurrency lock tests, and rollback drills.

---

## 8. Rollout & Rollback Strategy

1. **Draining States**: Provider routes can be set to `draining` to let existing accepted delivery operations complete while routing new traffic to backup providers.
2. **Feature Flags**: Flags are granular per tenant, channel, webhook endpoint, and outbox event mapping.
3. **Database Rollback**: Downgrade keeps Migration 34 intact in production to prevent data loss. The application binaries are rolled back while keeping the database additions idle.

---

## 9. Remaining Accepted Review Requirements

All findings in `WF2_REVIEW_RESPONSE.md`, including P2/P3 findings, are implementation requirements:

- Recipient caches contain candidate IDs only. IAM user/membership/role/organization mutations issue immediate tenant-qualified invalidation, while transactional PostgreSQL validation at resolution and immediately before delivery remains mandatory whenever freshness cannot be proven.
- Requests, deliveries, dead letters, and inbox use `(created_at DESC,id DESC)` keyset pagination with opaque filter-bound cursors; offset is forbidden on those endpoints.
- Daily `notification_rate_limit_bucket` partitions retain transient rows for 7 days by default, use active-window indexes, and are created/dropped by a bounded leased maintenance task. Non-PII aggregate metrics have separate retention.
- Template binding rotation locks the candidate and proves its parent template owns the exact `(application_key,semantic_key)` before atomic default rotation.
- Provider confirmation expires after 72 hours for email and 24 hours for SMS/webhook. Expiry never causes automatic resend.
- Replay sets a same-tenant composite `parent_request_id`, preserves root/depth ancestry, creates new correlation/idempotency identities, and audits both parent and child.
- Every failover attempt reruns residency, classification, tenant/org policy, provider/sender/secret/security eligibility, limits, expiry, recipient eligibility, and suppression.
- Expired `sending` leases are always reconciled under fencing: confirmed non-acceptance may requeue, confirmed acceptance/delivery advances, and ambiguity dead-letters.
