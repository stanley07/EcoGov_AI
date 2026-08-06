# WF-2 Rollback Strategy

Status: Approved with required review changes incorporated

## Principle

Rollback is feature deactivation and application rollback, not destructive deletion of delivery/audit evidence. Migration 34 is additive and remains applied unless a separately approved pre-production disposable-database reversal is executed.

## Preconditions

- Feature flags are independently controllable for request intake, each event mapping, each channel/provider, inbox projection, callbacks, tenant UI, and legacy adapter cutover.
- Legacy invitation path remains deployable until equivalence and stabilization gates pass.
- Provider routes can be placed in `draining` without deleting credentials/history.
- Every rollout records the prior application commit, template/binding/route versions, enabled tenants/event mappings, and queue watermark.

## Rollback levels

### 1. Provider/channel rollback

Disable new routing to the provider; mark route/provider `draining`; stop new claims for that route; let known accepted operations reconcile; requeue proven pre-send transient work to an approved fallback; dead-letter ambiguous outcomes. Do not blindly resend.

### 2. Tenant/event-mapping rollback

Disable the tenant/channel or exact outbox-event mapping. Existing requests remain queryable and drain under their pinned policy unless security requires cancellation. Unconsumed outbox facts remain durable for later replay. WF-1/domain transactions remain committed.

### 3. Worker rollback

Stop polling, await in-flight tasks within shutdown bound, stop heartbeats, and allow leases to expire. Deploy prior compatible worker. Stale fencing tokens prevent the old worker from completing after takeover. Inspect unknown outcomes before replay.

### 4. Application rollback

Disable WF-2 routes/UI/intake and deploy the prior application commit. Reactivate the legacy invitation adapter only if its compatibility contract and schema remain available. Migration 34 tables remain intact and unread by the old application.

### 5. Migration rehearsal rollback

Only on a disposable/pre-production database: stop consumers, export redacted counts/checksums, drop migration-34 objects in reverse dependency order using a reviewed script, remove schema-migration row, run baseline verification, then forward reapply 34. Production downgrade does not drop notification data.

## Queue disposition

- `queued/scheduled/transient_failed/rate_limited`: pause, then resume with same deterministic identities.
- `leased/sending`: allow lease/reconciliation; never duplicate via immediate fallback.
- An expired `sending` row is reconciled under fencing: confirmed non-acceptance may return to `queued`, confirmed acceptance/delivery advances, and ambiguity moves to `dead_lettered`; rollback never leaves it stranded.
- `provider_accepted`: await callback/reconcile or expire by pinned policy.
- terminal deliveries/history/attempts: immutable.
- dead letters: remain for authorized preview/replay after recovery.

## Secret and webhook rollback

Disabling an endpoint/provider revokes outbound use but preserves encrypted references and audit. If compromise is suspected, rotate/revoke in the secret manager, expire callback overlap, disable endpoint, and reject old-key callbacks. Never restore an exposed secret from database or logs.

## Validation after rollback

Confirm prior app health, no new WF-2 intake, no active duplicate workers, expired leases recoverable, workflow/domain commands unaffected, invitation compatibility operational where enabled, no cross-tenant/org references, no unexpected provider calls, callbacks fail closed, and evidence/audit remain readable to authorized operators.

## Irreversible boundary

An external provider acceptance or delivery cannot be rolled back. Corrective action is a new explicitly authorized notification, suppression, or operational incident process—not history mutation.
