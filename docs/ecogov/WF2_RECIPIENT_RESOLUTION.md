# WF-2 Recipient Resolution

Status: Proposed for independent review

## Exact selector vocabulary

`direct_user`, `direct_destination`, `role`, `organization`, `workflow_work_item`, `escalation_target`.

Every selector includes `tenant_id`; all except an explicitly tenant-wide mandatory selector include an `organization_id`. The caller may request a selector but cannot supply resolved membership, permission, or contact evidence.

## Common algorithm

1. Authenticate producer/service identity and active tenant.
2. Authorize the notification semantic key, selector type, classification, and organization.
3. Resolve the source resource with tenant-leading predicates and active organization.
4. Resolve only active users, active memberships, active approved roles, and verified destinations.
5. Apply tenant/org policy, legal flags, user preferences, quiet hours, suppression, and channel availability.
6. Enforce per-request and per-tenant fan-out bounds.
7. Deduplicate users and destination digests deterministically.
8. Persist immutable recipient/destination snapshots and decision reason codes in the request transaction.
9. If a required selector resolves empty or ambiguously, fail closed; do not broaden to a tenant-wide or platform audience.

## Selector rules

### Direct user

Resolve `(tenant_id,user_id)` plus active tenant, user, membership, organization, and channel destination. A tenant-wide user may be used only by an explicitly tenant-scoped producer permission. The same user ID in another tenant cannot be inferred or selected.

### Direct email or phone destination

Allowed only to service identities/actors with `notification:recipient:direct` and a semantic policy permitting external destinations. Normalize before digesting (lowercase/trim email; E.164 phone), validate and verify as required, store encrypted/reference form, and audit only digest/mask. It never creates an account or membership.

### Role

Role ID must belong to the tenant and be in the template/policy allowlist. Resolve active memberships in the requested active organization. Role names and UI aliases are not authority; `subcontractor` remains a UI alias for `environmental_consultant`. Tenant-wide role fan-out requires explicit policy and stricter quota.

### Organization

Organization broadcast resolves only approved audience roles/categories within one active organization. “All members” is not implicit. The policy defines eligible roles and maximum fan-out. Archived/inactive organizations resolve empty.

### Workflow work item

Resolve the tenant/org-scoped active `workflow_work_item` and pinned instance. Recipient order is active assignee, active claimant when policy permits, then the explicitly assigned queue policy. Closed/cancelled work items do not resolve unless the event is an approved completion notice. The notification platform does not change assignment.

### Escalation target

Consume the immutable WF-1 escalation action/policy snapshot. Resolve the exact role/user/queue at execution time within the active tenant/organization, matching WF-1 recipient rules. Empty or invalid resolution dead-letters and raises an operational alert; it never grants broader queue visibility.

## Resolution timing

- Immediate requests resolve within acceptance before any delivery task is enqueued.
- Future scheduled role/organization requests may declare `resolution_mode='at_schedule'`; the selector and policy version are pinned, then resolved once when the schedule becomes due.
- Workflow assignment/SLA/escalation recipients resolve at event intake using the event’s pinned tenant/org/resource IDs and applicable WF-1 snapshot.
- Replays reuse the original recipient snapshot by default. Re-resolution requires a new explicit request/reason and produces new evidence.

## Preference decision matrix

From highest to lowest precedence:

1. Valid emergency override: may bypass quiet hours and optional user opt-out only where law/tenant policy permits.
2. Legal/mandatory notice: bypasses optional opt-out but uses required channel/destination rules and records the statutory/policy code.
3. Tenant/organization policy: channel enablement, mandatory channels, classification, quiet hours, limits.
4. User preference: explicit deny/allow then category/channel inheritance.
5. Quiet hours: reschedule to next permitted instant; if request expires first, suppress/expire according to policy.

Suppression for invalid destination, complaint/bounce, security hold, legal prohibition, or tenant closure always wins. Emergency override cannot bypass tenant isolation, inactive identity, invalid destination, suppression mandated by law/security, provider security, or rate/fan-out safety caps.

## Privacy

Recipient reads expose IDs, selector/result codes, masked destinations, and channel availability only. Only the delivery adapter may decrypt a destination just in time. Snapshot retention is classification-specific and supports cryptographic erasure without deleting immutable delivery evidence.
