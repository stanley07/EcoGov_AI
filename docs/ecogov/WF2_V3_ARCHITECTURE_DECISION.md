# WF-2 V3 Architecture Decision

**Milestone**: WF-2 — GovOS Notification Platform
**Status**: Approved V3 Architecture Decision
**Tag Baseline**: `wf-1-complete`
**Commit Baseline**: `5c3fcb16b2511eeb37de3f8f911de8188d9752d2`
**Date**: 2026-08-04

---

## 1. Disposition of All Five P1 Blockers

### WF2-VAL-01: Global Template-Version Referential Integrity
* **Decision**: Approved.
* **Resolution**: Replaced the partial-null composite foreign-key structure with two mutually exclusive reference paths on `notification_template_binding` and `notification_request`:
  1. `tenant_template_version_id`: Evaluated via composite foreign key `(tenant_id, tenant_template_version_id) REFERENCES notification_template_version(tenant_id, id)`.
  2. `catalog_template_version_id`: Evaluated via single-key foreign key `catalog_template_version_id REFERENCES notification_template_version(id)` combined with a database trigger validating that the parent template is global (`tenant_id IS NULL`), ownership is `platform` or `application`, and status is `published`.
  3. A check constraint enforces that exactly one of these two columns must be non-null: `CHECK ((tenant_template_version_id IS NULL AND catalog_template_version_id IS NOT NULL) OR (tenant_template_version_id IS NOT NULL AND catalog_template_version_id IS NULL))`.

### WF2-VAL-02: Tenant Binding vs. Implicit Fallback
* **Decision**: Approved.
* **Resolution**: Tenant resolution is strictly binding-only. Direct implicit fallback to global defaults at runtime is forbidden. Catalog templates are usable by a tenant *only* if an active `notification_template_binding` maps the semantic key to the catalog version. Missing or inactive bindings fail closed immediately, returning a `WF_BINDING_MISSING` (422) error.

### WF2-VAL-03: RBAC and API Permission Vocabulary
* **Decision**: Approved.
* **Resolution**: Reconciled all API permission shorthand. The endpoint authentication middleware must require the exact canonical permission strings listed in Section 5 below. User preference routes are protected by authenticated ownership checks (`(tenant_id, user_id)`), and platform console routes are protected by `platform.notification.*` scopes.

### WF2-VAL-04: Application Catalog Template Publication Authority
* **Decision**: Approved.
* **Resolution**: "Application-owned" templates represent namespace and content provenance only. Application services cannot write to catalog tables or self-publish. Drafts are proposed via platform APIs, and only actors possessing `platform.notification.template.publish` can publish validated versions.

### WF2-VAL-05: Provider Callback Tenant/Secret Ownership
* **Decision**: Approved.
* **Resolution**: Replaced the provider-key callback route with unique, opaque, tenant-safe callback endpoint URLs: `POST /internal/notifications/provider-callbacks/:callbackEndpointId`. This opaque ID resolves to a single tenant/provider endpoint context, enabling signature checks and message deduplication under a pre-selected tenant scope.

---

## 2. Exact Approved Template Ownership Model

* **Platform-owned**: `platform/<semantic_key>`. Managed via platform console. Read-only to tenants. Override allowed if `allow_tenant_override=true`.
* **Application-owned**: `<application_key>/<semantic_key>`. Namespace/provenance only, published globally by platform admins. Bindable by tenants.
* **Tenant-owned**: `<tenant_id>/<application_key>/<semantic_key>`. Private to the tenant.
* **Organization Overrides**: Bindings can optionally include an `organization_id` to override tenant-default bindings.

---

## 3. Exact Database FK Model

To prevent cross-tenant data leakage, all child tables must utilize composite foreign keys containing `tenant_id`:
* `notification_recipient(tenant_id, request_id)` references `notification_request(tenant_id, id)`
* `notification_delivery(tenant_id, request_id)` references `notification_request(tenant_id, id)`
* `notification_delivery_attempt(tenant_id, delivery_id)` references `notification_delivery(tenant_id, id)`
* `notification_inbox_item(tenant_id, delivery_id)` references `notification_delivery(tenant_id, id)`
* `notification_delivery_status_history(tenant_id, request_id)` references `notification_request(tenant_id, id)`

`notification_template_binding` and `notification_request` must declare the dual reference columns:
* `tenant_template_version_id` UUID with composite foreign key `(tenant_id, tenant_template_version_id)` referencing `notification_template_version(tenant_id, id)`.
* `catalog_template_version_id` UUID referencing `notification_template_version(id)` guarded by trigger.
* `CHECK ((tenant_template_version_id IS NULL AND catalog_template_version_id IS NOT NULL) OR (tenant_template_version_id IS NOT NULL AND catalog_template_version_id IS NULL))`.

---

## 4. Exact Binding and Fallback Algorithm

When a notification request is received:
1. Extract the active `tenant_id` and `organization_id` from the authenticated caller context.
2. Query `notification_template_binding`:
   * First, search for an active binding where `tenant_id = :tenantId AND organization_id = :organizationId AND semantic_key = :semanticKey AND status = 'active' AND effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())`.
   * If none is found, search for the tenant-default binding where `tenant_id = :tenantId AND organization_id IS NULL AND semantic_key = :semanticKey AND status = 'active' AND effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())`.
3. If no binding matches, fail closed and throw a `WF_BINDING_MISSING` (422) error.
4. Extract the pinned `template_version_id` from the resolved binding and record it under the appropriate path (`tenant_template_version_id` or `catalog_template_version_id`) on the `notification_request` record.

---

## 5. Exact Permission Vocabulary

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

## 6. Exact Role Mappings

| Role | Allowed Permissions |
| :--- | :--- |
| **Platform Administrator** | All `platform.notification.*` permissions; zero tenant-scoped permissions. Cannot read tenant message body content. |
| **Tenant Administrator** | All tenant `notification:*` permissions except `notification:recipient:direct` and `notification:emergency:send` (which are reserved for system actors and dedicated policy override triggers respectively). |
| **Tenant Operations / Supervisor** | `notification:template:read`, `notification:policy:read`, `notification:request:read`, `notification:audit:read`, `notification:operations:read`, `notification:operations:replay`. |
| **Tenant System / API Client Actor** | `notification:template:read`, `notification:request:create`, `notification:request:read`, `notification:recipient:direct`. |
| **Tenant End User / Citizen** | `notification:inbox:read` (own only), `notification:inbox:manage` (own only). |

---

## 7. Exact Application Publication Authority

* Application catalog drafts are proposed via `/v1/platform-admin/templates` by registered application identities.
* Publishing is restricted to platform actors possessing the `platform.notification.template.publish` permission.
* Application runtime services have zero direct write access to template tables.
* Separation of duties is enforced: platform administrators publish templates globally; tenant administrators map these templates to local bindings.

---

## 8. Exact Callback-Routing and Key-Ownership Model

* **URL Pattern**: `POST /internal/notifications/provider-callbacks/:callbackEndpointId`
* **Route Lookup**: The `callbackEndpointId` is matched against `notification_provider_callback_endpoint` via unique index to retrieve: `tenant_id`, `provider_key`, `active_status`, `signature_algorithm`, and `verification_key_reference`.
* **Processing Sequence**:
  1. Verify the HTTP headers, request size limits, and active endpoint status.
  2. Verify the raw body signature using the active key reference in constant time.
  3. Deduplicate callbacks under the tenant scope using the request nonce.
  4. Query the target delivery using `(tenant_id, provider_key, provider_message_id)` and transition status via compare-and-set.
  5. Log the callback receipt in `notification_provider_callback` and append to `notification_delivery_status_history`.
  6. Return a generic 200 response regardless of matching delivery status.

---

## 9. Required Document Corrections

Conform all 10 authoritative WF-2 documents to the decisions made in this V3 decision document prior to starting implementation.

---

## 10. Migration-000034 Drafting Rules

* Migration 34 is strictly additive and must be applied after Migration 33 is verified as active.
* Implement composite foreign keys `(tenant_id, parent_id)` on all child tables.
* Implement the dual template-version reference columns and `CHECK` constraint.
* Define triggers to enforce status immutability on published template versions, status history, and audits.
* Rollback drops WF-2 tables in reverse dependency order on a disposable database; it is forward-disable and data-preserving in production.

---

## 11. Implementation Gates

1. V3 Architecture Decision approved.
2. Staging/Rehearsal Migration 34 applied cleanly; rerun applied zero.
3. Automated integration, security, and compatibility suites pass 100%.
4. Final database invariants check returns zero violations.

---

## 12. Stop Conditions

1. Tenant boundary leak (cross-tenant database reads/writes).
2. Webhook SSRF validation or DNS rebinding bypass.
3. Double delivery detection during concurrent worker claim tests.
4. Fencing token or lease collision.

---

## 13. Explicit Authorization

WF-2 implementation is approved and authorized to proceed to drafting Migration 000034 and the V3 implementation plan.

---

- WF-2 V3 architecture approved: YES
- Template ownership model approved: YES
- Database FK model approved: YES
- Binding/fallback model approved: YES
- Permission vocabulary approved: YES
- Application publication authority approved: YES
- Provider callback routing approved: YES
- Migration 000034 authorized for drafting: YES
- WF-2 implementation authorized: YES
