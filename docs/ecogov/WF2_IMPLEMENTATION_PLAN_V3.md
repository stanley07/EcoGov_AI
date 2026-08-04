# WF-2 Notification Platform Implementation Plan V3

**Milestone:** WF-2 — GovOS Notification Platform
**Status:** Approved implementation plan
**Baseline:** tag `wf-1-complete` (`5c3fcb16b2511eeb37de3f8f911de8188d9752d2`)
**Date:** 2026-08-04

## 1. Purpose and authority

This plan is the minimum correction to the approved WF-2 package for the accepted P1 findings in `WF2_ARCHITECTURE_VALIDATION_RESPONSE.md`. It does not authorize implementation. After approval, the authoritative ADR, database, API, security, template, verification, and evidence documents must be conformed to this plan before Migration 34 or production code is written.

All unaffected scope, deferrals, lifecycles, worker behavior, provider rules, rollout, rollback, testing, and evidence requirements in the approved WF-2 package remain mandatory.

## 2. Corrected architecture decisions

### 2.1 Template reference model

Retain `notification_template` and `notification_template_version`. Replace the partial-null composite reference with explicit exclusive reference paths.

`notification_template_binding` and `notification_request` each contain:

- nullable `tenant_template_version_id`;
- nullable `catalog_template_version_id`;
- a check requiring exactly one to be non-null.

Tenant reference:

```text
(tenant_id, tenant_template_version_id)
  -> notification_template_version(tenant_id, id)
```

Catalog reference:

```text
catalog_template_version_id
  -> notification_template_version(id)
```

A restricted constraint trigger validates catalog references at insert/update: the version and parent template are global, ownership is exactly `platform` or `application`, lifecycle is `published`, and `(application_key, semantic_key)` matches the binding/request. The trigger locks the candidate version during binding rotation and request acceptance. Tenant-owned versions use only the composite tenant path. Partial-null composite FKs are forbidden.

Published content remains immutable. Request evidence pins the binding ID/version, selected reference kind, version ID, content hash, locale, route hash, and rendered-content hash.

### 2.2 Binding-only tenant resolution

Canonical resolution is:

1. active exact organization binding;
2. active tenant-default binding;
3. fail closed.

There is no runtime direct fallback to a global catalog default. Platform/application catalog versions are usable only through an active tenant-local binding. Provisioning may create reviewed default bindings idempotently. Binding uniqueness, lifecycle, effective dates, organization ownership, semantic identity, and candidate publication state are checked atomically.

### 2.3 Exact authorization contract

The approved role mappings in `WF2_ARCHITECTURE_REVIEW_DECISION.md` are authoritative. Migration 34 seeds only the exact approved permissions and mappings; it creates no shorthand or alias permissions.

The API specification must replace every shorthand:

| Shorthand/context | Exact contract |
| --- | --- |
| template `read` | `notification:template:read` |
| template/version `update` | `notification:template:update` |
| binding `publish` | `notification:template:publish` |
| policy read/write | `notification:policy:read` or `notification:policy:write` by method |
| webhook write | `notification:webhook:write` |
| inbox `read` | `notification:inbox:read` plus current-user ownership |
| inbox `manage` | `notification:inbox:manage` plus current-user ownership |
| request read | `notification:request:read` plus organization scope |

Self-service preference endpoints require an authenticated active tenant user, current session/membership, and strict `(tenant_id, user_id)` ownership. They do not imply a new permission. Platform endpoints use their exact `platform.notification.*` permission and the approved platform role mapping.

### 2.4 Application catalog authority

Application ownership identifies namespace and content provenance. Application producers may submit drafts only through a versioned, audited platform catalog command with idempotency and expected version. Publication requires `platform.notification.template.publish`, successful validation for the exact content hash, and an authorized human/service actor. Application runtime code cannot publish, set tenant defaults, or write catalog tables directly.

### 2.5 Provider callback endpoint ownership

Replace the provider-key callback route with:

```text
POST /internal/notifications/provider-callbacks/:callbackEndpointId
```

`callbackEndpointId` resolves by a unique indexed opaque identifier to one tenant, provider, route/endpoint, active state, accepted signature algorithm, current verification-key reference, bounded previous-key overlap, and replay policy. The identifier is routing metadata, not a secret.

Processing order is exact:

1. bound method/content-type/body-size checks;
2. endpoint lookup and active/key-window validation;
3. timestamp/skew and raw-body signature verification in constant time;
4. nonce/callback dedupe reservation under tenant scope;
5. parse/normalize through the pinned provider adapter version;
6. tenant-qualified delivery lookup and compare-and-set transition;
7. immutable callback/history/audit evidence;
8. generic response.

No payload field chooses tenant, endpoint, secret, or adapter. Callback and provider-message uniqueness is tenant/provider qualified.

## 3. Document changes required before implementation

| Document | Required change |
| --- | --- |
| `adr/ADR-005-notification-platform.md` | Retain binding-only consumption; add dual reference paths and callback endpoint ownership |
| `WF2_ARCHITECTURE_REVIEW_DECISION.md` | Remove direct global fallback; clarify application proposal/platform publication; adopt callback endpoint ID |
| `WF2_DATABASE_MODEL.md` | Replace nullable composite template reference; add exact checks/FKs/triggers/indexes and callback endpoint entity/keys |
| `WF2_API_SPECIFICATION.md` | Replace all permission shorthand; replace callback route and processing contract |
| `WF2_SECURITY_MODEL.md` | Make approved role mappings authoritative; add callback preselection and no-secret-scanning rule |
| `WF2_TEMPLATE_VERSIONING.md` | State binding-only resolution and dual-path pinned evidence |
| `WF2_PROVIDER_MODEL.md` | Add callback endpoint context and tenant-qualified callback/message identities |
| `WF2_VERIFICATION_CHECKLIST.md` | Add tests in section 7 below |
| `WF2_EVIDENCE_PLAN.md` | Require evidence for all five corrected contracts |
| `WF2_IMPLEMENTATION_PLAN.md` / V2 | Conform Migration 34, APIs, and authority rules to this V3 correction |

## 4. Database implementation changes after approval

Migration remains `000034_notification_platform.sql`, additive and idempotent after migration 33. In addition to the existing approved model, it must:

- implement the dual template-version reference paths and exact-one checks;
- add composite tenant FKs for tenant versions and single-key catalog FKs;
- install restricted constraint triggers for catalog ownership/publication/semantic identity;
- prevent tenant versions in catalog columns and global versions in tenant columns;
- add `notification_provider_callback_endpoint` with tenant-qualified route/provider ownership, opaque unique endpoint ID, adapter version, active state, key references/versions, overlap expiry, replay/skew bounds, and optimistic version;
- scope callback/provider-message unique identities by tenant and provider;
- seed the exact approved permission-role mappings idempotently;
- add supporting indexes for active binding resolution, candidate-version locking, callback endpoint lookup, replay-window cleanup, and delivery correlation.

No existing migration is edited. Preflight must prove migration 34 is unused and validate deployed PostgreSQL support for every selected constraint/index feature.

## 5. API and service changes after approval

- Template resolution accepts only tenant-local binding IDs selected under tenant/org predicates.
- Provisioning/default-binding commands are explicit, authorized, versioned, idempotent, and audited.
- Catalog draft submission and publication are separate commands and permissions.
- Endpoint middleware names only canonical permissions; no alias resolver is introduced.
- Callback intake resolves endpoint context before signature verification and state lookup.
- Error responses remain generic and indistinguishable for unknown endpoint, inactive endpoint, invalid signature, expired key, replay, foreign delivery, or foreign provider message.

## 6. Worker and concurrency changes after approval

Existing approved 60-second leases, 20-second heartbeats, fencing, recovery, and retry rules remain unchanged. Callback processing uses compare-and-set delivery transitions and cannot enqueue a send.

Locking rules are explicit:

- binding rotation locks binding, candidate version, then current version in stable ID order;
- request acceptance locks binding then selected version before writing request evidence;
- callback handling reserves dedupe first, then locks the tenant-qualified delivery;
- provider callbacks never lock template/binding rows;
- worker task claiming remains a short task-only transaction; delivery processing does not hold a task row lock while acquiring notification domain locks;
- any task completion/failure update is fenced and follows notification-domain mutation, avoiding task-to-delivery versus delivery-to-task inversion.

## 7. Testing changes after approval

Add focused tests proving:

1. tenant binding to same-tenant version succeeds; cross-tenant version fails at the database boundary;
2. tenant binding to a published global catalog version succeeds through the catalog path;
3. partial-null, both-set, neither-set, tenant-in-catalog, and global-in-tenant references fail;
4. catalog draft/deprecated/semantic-mismatch references fail under concurrency;
5. missing tenant binding fails closed and never resolves a global default implicitly;
6. provisioning seeds an explicit binding idempotently and atomic rotation has one default;
7. every endpoint requires the exact documented permission; every shorthand/legacy umbrella/wildcard is rejected;
8. approved role positive/negative matrix, including platform/tenant separation and direct/emergency exclusions;
9. application producer can submit but cannot publish; platform publisher can publish only a validated exact hash;
10. callback endpoint IDs select exactly one tenant/key/adapter without parsing tenant authority from the body;
11. foreign delivery/message IDs, invalid signatures, expired overlap keys, replayed nonces, guessed IDs, and cross-tenant callback races cause no mutation and indistinguishable responses;
12. callback-versus-worker/recovery races have one legal terminal outcome and ordered history;
13. lock-order stress tests show no task/delivery, binding/version, or callback/delivery deadlock.

All existing WF-2 verification gates remain required, including migration apply/no-op/rollback/reapply, focused and full sequential suites, every workspace TypeScript/build, invariant SQL, security/privacy/generated-file scans, manual UI acceptance, and evidence.

## 8. Verification and evidence additions

Final invariant SQL must return zero for:

- invalid dual-path template references;
- tenant/catalog scope mismatch;
- accepted requests without one pinned authorized binding/version path;
- requests resolved by an implicit catalog fallback;
- non-canonical permission seeds or mappings outside the approved role matrix;
- application-runtime publication authority;
- callback endpoints without one tenant/provider/key context;
- callback/message dedupe identities lacking tenant/provider qualification;
- callback history whose endpoint tenant differs from delivery tenant.

Evidence must include constraint definitions, trigger definitions, permission manifests, endpoint route inventory, negative isolation results, callback replay/race results, and lock-order stress totals.

## 9. Rollout and rollback

The existing non-destructive rollback strategy remains authoritative. Additional controls:

- Migration 34 ships dark with no callbacks or template bindings active.
- Explicit tenant bindings are seeded and verified before request intake is enabled.
- Callback URLs are registered only after endpoint ownership and current verification key pass a challenge/health check.
- Rollback disables callback endpoint routing and request intake; it does not restore provider-key-only callbacks or direct global fallback.
- Old callback URLs return the same generic response and never attempt multi-tenant key discovery.
- Migration 34 data remains in production on application rollback; disposable-database rollback drops the new callback and template-reference objects in reverse dependency order, then forward reapplies and revalidates.

## 10. Approval gate

Implementation may resume only after independent approval confirms:

- the dual reference model is the exact Migration 34 contract;
- binding-only tenant resolution is authoritative;
- role mappings and endpoint permissions are exact;
- platform publication authority is unambiguous;
- callback endpoint ownership is deterministic and tenant-safe.

Until that approval, do not create Migration 34, modify production source, mutate the database, commit, or push.
