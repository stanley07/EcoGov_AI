# WF-2 Pre-Implementation Architecture Validation Response

**Milestone:** WF-2 — GovOS Notification PlatformReplace all
**Review type:** Governed Phase 1 independent architecture validation
**Baseline:** tag `wf-1-complete` (`5c3fcb16b2511eeb37de3f8f911de8188d9752d2`)
**Date:** 2026-08-04
**Decision:** **STOP — NOT READY FOR IMPLEMENTATION**

## Executive decision

The approved package has strong lifecycle, recovery, privacy, and tenant-isolation intent, but five P1 contradictions remain at executable contract boundaries. Migration 34 and production code must not be created until these points are approved. No P0 finding was identified.

This response does not reopen accepted WF-2 scope. It selects the minimum deterministic corrections needed to make the existing design implementable and testable.

## Finding summary

| ID | Severity | Area | Disposition |
| --- | --- | --- | --- |
| WF2-VAL-01 | P1 | Global template-version referential integrity | ACCEPTED |
| WF2-VAL-02 | P1 | Tenant binding versus implicit global fallback | ACCEPTED |
| WF2-VAL-03 | P1 | Exact RBAC grants and API permission vocabulary | ACCEPTED |
| WF2-VAL-04 | P1 | Application-owned template publication authority | ACCEPTED |
| WF2-VAL-05 | P1 | Provider callback tenant/secret ownership | ACCEPTED |

## WF2-VAL-01 — Global template-version referential integrity

**Why this is P1**

`WF2_DATABASE_MODEL.md` defines global catalog versions with a nullable tenant qualifier and requires tenant bindings to reference `(template_version_tenant_id, template_version_id)` using `MATCH FULL` and `UNIQUE NULLS NOT DISTINCT`. A global version necessarily produces the partial-null child key `(NULL, <version-id>)`. PostgreSQL `MATCH FULL` rejects a composite reference when only some referencing columns are null. Switching to `MATCH SIMPLE` would skip the foreign-key check when any component is null and would therefore permit an unverified global version reference. The approved form is not implementable without either rejecting valid global bindings or weakening referential integrity.

**Affected documents**

- `docs/ecogov/WF2_DATABASE_MODEL.md` — entity table and composite-FK matrix
- `docs/ecogov/WF2_IMPLEMENTATION_PLAN.md` — Migration 34 tenant-qualified FK requirement
- `docs/ecogov/WF2_IMPLEMENTATION_PLAN_V2.md` — template-version isolation change
- `docs/ecogov/WF2_TEMPLATE_VERSIONING.md` — global and tenant ownership model

**Invariant affected**

Every accepted request must pin a real, published template version from an authorized ownership scope, and a tenant-owned version must never be referenced across tenants.

**Minimum correction**

Keep the approved template/version tables, but use two explicit reference paths in bindings and requests:

- `tenant_template_version_id`, protected by `(tenant_id, tenant_template_version_id) -> notification_template_version(tenant_id, id)`;
- `catalog_template_version_id`, protected by a normal FK to the version primary key plus a restricted constraint trigger proving `tenant_id IS NULL`, ownership is `platform` or `application`, the version is published, and its parent owns the exact `(application_key, semantic_key)`;
- an exact-one-of check permits one reference path and rejects both/neither;
- immutable request evidence records the selected path and binding ID/version.

The same dual-path contract applies wherever an accepted request pins a template version. No partial-null composite FK is permitted.

## WF2-VAL-02 — Tenant binding versus implicit global fallback

**Why this is P1**

ADR-005 says a tenant delivery may consume a platform/application catalog template only through an active tenant-local binding. `WF2_ARCHITECTURE_REVIEW_DECISION.md` instead allows direct fallback to a global catalog default when no tenant binding exists. These rules can resolve different content for the same request and make tenant authorization, default rotation, and evidence non-deterministic.

**Affected documents**

- `docs/ecogov/adr/ADR-005-notification-platform.md` — Decision 17
- `docs/ecogov/WF2_ARCHITECTURE_REVIEW_DECISION.md` — section 6 binding precedence
- `docs/ecogov/WF2_TEMPLATE_VERSIONING.md` — resolution and pinning
- `docs/ecogov/WF2_DATABASE_MODEL.md` — `notification_template_binding`

**Invariant affected**

Tenant delivery content must always be selected by an explicit tenant/organization authorization record and be reproducible from pinned evidence.

**Minimum correction**

ADR-005 remains authoritative: resolution is exact organization binding, then tenant default binding, then fail closed. There is no direct catalog fallback. Tenant provisioning/migration may seed reviewed tenant-local bindings to catalog defaults idempotently; that seeding is explicit evidence, not runtime fallback. Missing, inactive, ambiguous, draft, or deprecated bindings reject acceptance with a safe configuration error.

## WF2-VAL-03 — Exact RBAC grants and API permission vocabulary

**Why this is P1**

`WF2_ARCHITECTURE_REVIEW_DECISION.md` approves exact role mappings, while `WF2_SECURITY_MODEL.md` says mappings require a later permission-manifest review. `WF2_API_SPECIFICATION.md` also uses non-canonical shorthand such as `read`, `update`, `publish`, `policy read/write`, `webhook write`, and `manage`. Implementers cannot safely determine whether these are aliases, conjunctions, or distinct grants. Silent expansion would violate ADR-003.

**Affected documents**

- `docs/ecogov/WF2_ARCHITECTURE_REVIEW_DECISION.md` — sections 4 and 5
- `docs/ecogov/WF2_SECURITY_MODEL.md` — exact permission vocabulary and role-mapping statement
- `docs/ecogov/WF2_API_SPECIFICATION.md` — endpoint permission tables
- `docs/ecogov/WF2_VERIFICATION_CHECKLIST.md` — IAM/API gate

**Invariant affected**

Every command and protected read must require an exact approved permission; no wildcard, alias, role-name inference, legacy umbrella permission, or platform/tenant authority crossover is allowed.

**Minimum correction**

Treat the role table in `WF2_ARCHITECTURE_REVIEW_DECISION.md` as approved and remove the contradictory deferred-mapping statement. Replace every API shorthand with a canonical permission string from the approved vocabulary. Self-service preference operations are explicitly authenticated ownership checks, not implicit permissions. Platform catalog/provider endpoints use only exact `platform.notification.*` permissions and never tenant grants.

## WF2-VAL-04 — Application-owned template publication authority

**Why this is P1**

`WF2_TEMPLATE_VERSIONING.md` says an application owner proposes content and a platform notification publisher publishes it. `WF2_ARCHITECTURE_REVIEW_DECISION.md` says application-owned templates are managed by application code and published globally. The latter can be read as runtime self-publication and conflicts with the platform publication control.

**Affected documents**

- `docs/ecogov/WF2_TEMPLATE_VERSIONING.md` — ownership model
- `docs/ecogov/WF2_ARCHITECTURE_REVIEW_DECISION.md` — section 6 ownership namespace
- `docs/ecogov/WF2_API_SPECIFICATION.md` — platform/application catalog boundary
- `docs/ecogov/WF2_SECURITY_MODEL.md` — platform permission vocabulary

**Invariant affected**

Globally consumable immutable content must have one auditable publication authority and cannot be activated by application runtime code or direct database writes.

**Minimum correction**

Application ownership is namespace/content provenance only. An approved application producer may create or submit a draft through the platform catalog command boundary. Only an actor with `platform.notification.template.publish` may transition the validated version to `published`. Application runtime identities cannot publish, rotate tenant bindings, or write template tables directly.

## WF2-VAL-05 — Provider callback tenant/secret ownership

**Why this is P1**

The callback API is `/internal/notifications/providers/:providerKey/callback`, but signatures and callback ownership may be tenant-route/key specific. A provider key alone cannot deterministically select one tenant endpoint and verification-key version. Trusting a payload tenant ID, trying secrets across tenants, or correlating a provider message ID globally would create tenant-disclosure, timing, replay, and misattribution risk.

**Affected documents**

- `docs/ecogov/WF2_API_SPECIFICATION.md` — webhook receiver boundary
- `docs/ecogov/WF2_PROVIDER_MODEL.md` — callback contract and secret rotation
- `docs/ecogov/WF2_DATABASE_MODEL.md` — provider callback, route, and key-reference entities
- `docs/ecogov/WF2_SECURITY_MODEL.md` — webhook signing/replay and tenant isolation

**Invariant affected**

A callback must be authenticated and replay-checked under exactly one preselected tenant/provider endpoint before any delivery lookup or state mutation.

**Minimum correction**

Use `/internal/notifications/provider-callbacks/:callbackEndpointId`, where `callbackEndpointId` is an opaque, non-secret, unguessable identifier for one active tenant/provider route and verification-key set. Resolve that row first with a bounded indexed lookup, then verify the raw body before parsing authoritative fields. Scope callback identity and provider message correlation by `(tenant_id, provider_key, callback_id/message_id)`. Unknown, inactive, mismatched, expired-key, or invalid-signature requests return the same generic response and perform no mutation.

## Reviewed areas without a P0/P1 finding

The following designs are sufficiently defined to retain unchanged once the blockers above are corrected: delivery states and fenced `sending` recovery; retry classification and ambiguous-outcome handling; replay lineage/depth; recipient selector vocabulary and transactional revalidation; preference precedence and non-bypassable suppression; provider failover eligibility; outbound webhook DNS rebinding controls; keyset pagination; rate-limit algorithm and retention; legacy invitation compatibility telemetry; rollout and non-destructive rollback.

## Governance outcome

- Production code written: **No**
- Migration created: **No**
- Database mutated: **No**
- Tests/builds run: **Not applicable; implementation gate was not entered**
- Commit/push: **No**
- Required next action: approve the corrections in `WF2_IMPLEMENTATION_PLAN_V3.md`, then amend the affected authoritative package documents before implementation resumes.
