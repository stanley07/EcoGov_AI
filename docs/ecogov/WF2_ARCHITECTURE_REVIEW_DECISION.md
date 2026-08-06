# WF-2 Architecture Review Decision

**Milestone**: WF-2 — GovOS Notification Platform  
**Status**: Approved with Corrections  
**Tag Baseline**: `wf-1-complete`  
**Commit Baseline**: `5c3fcb16b2511eeb37de3f8f911de8188d9752d2`  
**Date**: 2026-08-04  

---

## 1. Approved Architecture

The GovOS Notification Platform (WF-2) architecture is approved subject to the corrections detailed below. The system must adhere to the following core paradigms:
1. **Durable Transport Substrate**: `task_execution` is the sole and authoritative queue for asynchronous channel delivery. No secondary queue mechanisms (e.g., separate worker queues or memory-only queues) are permitted.
2. **Transactional Outbox Intake**: The `outbox_event` table is reused as the transactional boundaries for domain/workflow events. A dedicated background worker pulls events and enqueues notification requests idempotently.
3. **Outcome Deduplication**: At-least-once provider delivery is assumed. Duplicate prevention is enforced via tenant-scoped semantic deduplication keys stored in a new `notification_deduplication_record` table.
4. **Tenant & Organization Isolation**: Strict logical isolation is maintained through database-level composite primary/foreign keys `(tenant_id, organization_id)` and tenant-leading indexes. Under no circumstances may an actor query, view, or dispatch notifications across tenant/org boundaries.
5. **No plaintext storage of sensitive details**: Recipient email addresses and phone numbers are encrypted at rest, and only digests are used for unique constraints.

---

## 2. Required Corrections

### P0 — Architecture/Security Blockers
*None.*

### P1 — Must Revise Before Implementation
1. **Dynamic DNS Rebinding Protection**: The webhook egress service must resolve the destination IP address on *every* delivery attempt (with DNS caching disabled for that client) and block loopback, link-local, private IP ranges, or metadata IP ranges (e.g., AWS `169.254.169.254`). Hard-coding a static list at startup is insufficient because domain names can dynamically resolve to different IP addresses.
2. **Compatibility Telemetry**: The legacy compatibility adapter wrapping the invitation executor must emit a dedicated telemetry metric (`notification.compatibility.invitation.legacy_fallback_count`) whenever a legacy payload is processed, ensuring clear visibility for the deprecation and final retirement phase.

### P2 — Follow-up Improvements
1. **Sliding-Window Rate Limiting**: The table `notification_rate_limit_bucket` should use a sliding-window or token-bucket algorithm to prevent burst boundary spikes that occur with standard fixed-window resets.

---

## 3. Exact State Vocabulary

### Request Aggregate States
* `accepted`
* `resolving`
* `scheduled`
* `processing`
* `partially_delivered`
* `delivered`
* `suppressed`
* `failed`
* `dead_lettered`
* `cancelled`
* `expired`

### Channel Delivery States
* `queued`
* `scheduled`
* `leased`
* `sending`
* `provider_accepted`
* `delivered`
* `transient_failed`
* `rate_limited`
* `permanent_failed`
* `suppressed`
* `dead_lettered`
* `cancelled`
* `expired`

### Attempt States
* `started`
* `succeeded`
* `transient_failed`
* `rate_limited`
* `permanent_failed`
* `lease_lost`

*Terminal States*: `delivered`, `suppressed`, `failed`, `dead_lettered`, `cancelled`, and `expired` are terminal and cannot transition to any other state. Retries must not reactivate a terminal state. Replays always create a new request ID.

---

## 4. Exact Permission Vocabulary

### Tenant Permissions
* `notification:template:read`
* `notification:template:create`
* `notification:template:update`
* `notification:template:validate`
* `notification:template:publish`
* `notification:template:deprecate`
* `notification:policy:read`
* `notification:policy:write`
* `notification:provider:read`
* `notification:provider:manage`
* `notification:webhook:read`
* `notification:webhook:write`
* `notification:webhook:rotate-secret`
* `notification:request:create`
* `notification:request:read`
* `notification:request:cancel`
* `notification:recipient:direct`
* `notification:emergency:send`
* `notification:inbox:read`
* `notification:inbox:manage`
* `notification:audit:read`
* `notification:operations:read`
* `notification:operations:replay`

### Platform Console Permissions
* `platform.notification.template.read`
* `platform.notification.template.write`
* `platform.notification.template.publish`
* `platform.notification.provider.read`
* `platform.notification.provider.manage`
* `platform.notification.operations.read`
* `platform.notification.operations.replay`
* `platform.notification.audit.read`

---

## 5. Approved Role Mappings

| Role | Allowed Permissions |
| :--- | :--- |
| **Platform Administrator** | All `platform.notification.*` permissions; zero tenant-scoped permissions. Cannot read tenant message body content. |
| **Tenant Administrator** | All tenant `notification:*` permissions except `notification:recipient:direct` and `notification:emergency:send` (which are reserved for system actors and dedicated policy override triggers respectively). |
| **Tenant Operations / Supervisor** | `notification:template:read`, `notification:policy:read`, `notification:request:read`, `notification:audit:read`, `notification:operations:read`, `notification:operations:replay`. |
| **Tenant System / API Client Actor** | `notification:template:read`, `notification:request:create`, `notification:request:read`, `notification:recipient:direct`. |
| **Tenant End User / Citizen** | `notification:inbox:read` (own only), `notification:inbox:manage` (own only). |

---

## 6. Template Ownership and Precedence Model

### Ownership Namespace
* **Platform-owned**: `platform/<semantic_key>`. Managed by platform console. Read-only to tenants. Override allowed if `allow_tenant_override=true`.
* **Application-owned**: `<application_key>/<semantic_key>`. Managed by application code, published globally. Bindable by tenants.
* **Tenant-owned**: `<tenant_id>/<application_key>/<semantic_key>`. Private to the tenant.

### Binding Resolution Precedence
When resolving the version of template to render for a semantic request:
1. **Specific Organization Binding**: Check for a `notification_template_binding` where `organization_id` matches the request context and `status='active'`.
2. **Tenant Default Binding**: If no organization binding exists, use the default active binding for the `tenant_id` where `organization_id` is null.
3. **Application/Platform Catalog Default**: If no tenant override or binding exists, fallback to the global default catalog version for that `application_key` or `platform` namespace.

---

## 7. Approved Recipient Types

* `direct_user`: Explicit `(tenant_id, user_id)` lookup. Resolves active user/membership.
* `direct_destination`: Direct email/phone destination (requires `notification:recipient:direct` permission).
* `role`: Resolves active members of the tenant/organization assigned to a specific role.
* `organization`: Resolves active members of approved roles within a target organization.
* `workflow_work_item`: Resolves the active assignee/claimant from a WF-1 work item.
* `escalation_target`: Resolves the target queue/role from a WF-1 escalation action configuration.

---

## 8. Preference Precedence

Precedence is evaluated from highest to lowest:
1. **Valid Emergency Override**: Bypasses opt-out and quiet hours (requires `notification:emergency:send` permission).
2. **Legal / Mandatory Notice**: Bypasses opt-out but respects quiet hours.
3. **Tenant / Organization Policy**: Channel restriction rules.
4. **User Opt-out / Preference**: Category/channel preferences.
5. **Quiet Hours**: Reschedules the delivery to the next allowed local timezone window.

*Absolute Suppression Wins*: Bounces, invalid destinations, or security locks bypass all overrides and terminate delivery.

---

## 9. Suppression Rules

* **Permanent Suppression**: Added automatically upon hard bounces, user spam complaints, or invalid destination formatting.
* **Temporary Suppression**: Security locks or manual administrative overrides.
* **Scope**: Evaluated prior to task execution. Blocked deliveries transition to `suppressed` with a status history audit record.

---

## 10. Quiet-Hours Rules

* Checked using IANA timezone coordinates mapped to the recipient's snapshot.
* Reschedules non-emergency tasks to the beginning of the next permitted delivery window.
* Non-delivery scheduled tasks that exceed their expiry window (`expires_at`) before quiet hours end are marked `expired`.
* Business-calendar exceptions (holidays, DST exceptions) are deferred from WF-2.

---

## 11. Provider Contract

Adapters must implement:
* `capabilities()`: Returns channels, regions, limits.
* `validateConfiguration()`: Validates connection references.
* `send()`: Dispatches envelope.
* `classify()`: Maps errors to `transient`, `rate_limited`, `permanent`, or `unknown`.
* `verifyCallback()`: Verifies webhook callback signatures.
* `normalizeCallback()`: Maps callbacks to canonical delivery status.
* `health()`: Reports health.

---

## 12. Failover Rules

* Failover is restricted to pre-send adapter failures or transient network failures with verified no-acceptance by the provider.
* Cross-provider fallback after `provider_accepted` or ambiguous connection drops is prohibited unless the target provider supports identical idempotency keys and guarantees deduplication.
* Attempt counts are incremented and globally capped (maximum 5 attempts).

---

## 13. Retry and Dead-Letter Rules

* Expired worker leases (60 seconds) are reclaimed after timeout. Fencing tokens protect database updates.
* Exponential backoff with full jitter, capped at 15 minutes.
* Dead letters remain in-line inside the `notification_delivery` table with status `dead_lettered`.
* Replaying dead letters does not mutate old states; it spawns a new linked request using `notification:operations:replay`.

---

## 14. Webhook Security Controls

* Only `HTTPS` allowed.
* SSRF blocks loopback, private, link-local, and cloud metadata IP ranges.
* DNS rebinding protection: re-resolve IP on every outbound dispatch.
* Request signature: HMAC-SHA256 of `version.timestamp.nonce.bodyDigest`.
* Nonce verification and timestamp skew (5 minutes max).
* Autoclose/suspend endpoints after repeated failures.

---

## 15. Worker Model

* Reuses the existing `TaskRegistry` and `task_execution` infrastructure.
* Uses 60-second task leases and 20-second heartbeats.
* Claim polling uses `FOR UPDATE SKIP LOCKED` for tenant-fair batch processing.
* Startup recovery sweeps orphan leases and stuck `resolving` states.

---

## 16. Migration Strategy

* Single database migration `000034_notification_platform.sql` only.
* Must be strictly additive, idempotent, and support a zero-op rerun and rollback rehearsal drop script.
* Prior migrations 000001–000033 must not be modified.

---

## 17. Compatibility Strategy

* Shadow dual-write compatibility for `govos.notification.invitation.send`.
* Telemetry metrics record legacy invoker hits.
* Standardized validation verifies that template parsing produces matching hashes.

---

## 18. Retention Rules

* Rendered message bodies: cryptographically erased or deleted after 30 days.
* Delivery logs, history, audit trails: maintained long-term for compliance.
* Legal holds override retention limits.

---

## 19. Approved WF-2 Scope

* Email, SMS, in-app notifications, outbound webhooks.
* Template rendering, schema validation, and lifecycle.
* Recipient resolution, opt-out preferences, and quiet hours.
* Provider routing, retry backoff, dead-letter replays, and rate limiting.
* Compatibility layer with legacy invites and development mailbox.

---

## 20. Deferred Features

* Mobile push delivery (push channel model placeholder only).
* Marketing/bulk promotional email/SMS management.
* Graphical templates builder UI.
* Multi-region active-active database replication.
* Third-party marketplace plugin registration.

---

## 21. Implementation Gates

1. Architectural and security reviews approved.
2. Migration 34 applied to staging/rehearsal, rerun applied zero.
3. Test suite execution returns 100% pass on focused tests.
4. Compatibility equivalence validated with legacy invitation tests.
5. Invariants verified at zero violations.

---

## 22. Stop Conditions

1. Breach of tenant/organization isolation (cross-tenant leakage).
2. Failure of task fencing (overlapping execution updating state).
3. Secret key exposure in audit logs or API payloads.
4. SSRF block bypass during webhook delivery.

---

## 23. Explicit Implementation Authorization

* **ADR-005 approved**: YES
* **Data model approved**: YES
* **Template/version model approved**: YES
* **Delivery state machine approved**: YES
* **Recipient-resolution model approved**: YES
* **Preference/suppression model approved**: YES
* **Provider/failover model approved**: YES
* **Retry/dead-letter model approved**: YES
* **Webhook security model approved**: YES
* **Notification permission vocabulary approved**: YES
* **Migration 000034 authorized for drafting**: YES
* **WF-2 implementation authorized**: YES
