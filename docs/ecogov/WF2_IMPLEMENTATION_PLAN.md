# WF-2 Notification Platform Implementation Plan

Status: Approved architecture plan with required review changes incorporated

## Objective

Implement the ADR-005 notification platform additively after migration 33, preserving all approved IAM and WF-1 invariants and backward compatibility with the encrypted invitation task and protected development mailbox.

## Scope

Email, SMS, in-app, webhook, template/version governance, recipient resolution, preferences, suppression, quiet hours, delivery/request state, attempts, retries/dead letters, provider routing/failover, rate limiting, inbox, administration/operations APIs, WF-1 integration, compatibility adapter, audit, privacy, rollout, and evidence.

Out of scope: marketing campaigns, bulk promotional messaging, mobile push implementation, complex visual template builders, cross-region active-active delivery, third-party marketplace plugins, inbound conversational SMS/email, and provider billing reconciliation beyond bounded usage metrics.

## Authoritative baseline inventory

Inventory is from tag `wf-1-complete` (`5c3fcb16b2511eeb37de3f8f911de8188d9752d2`), not ambient generated output.

| Current component    | Evidence at baseline                                                                                           | Finding                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction outbox   | migration 19 `outbox_event`; `packages/ai/src/runtime/outbox-service.ts`                                       | Durable lease/heartbeat and global dedupe exist; event states only `pending/processing/completed/failed`; not a notification ledger                           |
| Task queue           | migration 3 `task_execution`, migration 11 encrypted payload, migration 33 fencing token; worker claim helpers | Correct reusable work substrate; existing generic worker uses 5-minute leases while WF-1 runtime uses 60 seconds; WF-2 must use the fenced 60-second contract |
| Task registry        | `modules/govos-core/src/task-framework.ts`                                                                     | Exact name/version and Zod input schema; extend for versioned channel executors/output schema/capabilities                                                    |
| Invitation producer  | `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/tenant-iam.ts`, platform bootstrap                | Enqueues deterministic encrypted `govos.notification.invitation.send`; no canonical request/delivery row                                                      |
| Invitation executor  | `apps/worker/src/executors/sendInvitationExecutor.ts`                                                          | Decrypts in worker; validates invitation fields; development adapter or masked no-op production path                                                          |
| Development mailbox  | `packages/infrastructure/src/development-mailbox.ts`; protected platform routes                                | Explicit development-only AES-GCM filesystem provider, idempotent file creation, safe list/view/open lifecycle                                                |
| Provider abstraction | development mailbox and executor boundary only                                                                 | No channel-neutral provider contract, production provider, routing, failover, callbacks, or secret-reference model                                            |
| IAM                  | ADR-002/003, Gate 3 manifest, Gate 4 identity/session, Gate 5 organization delegation                          | Tenant-context identity, exact permissions, active membership/session, protected roles, organization delegation are authoritative                             |
| WF-1                 | ADR-004, migration 31–33, workflow runtime                                                                     | Pinned versions, commands/events, explicit org-scoped work, SLA/escalation, leased/fenced tasks, and notification outbox events exist                         |
| Operational health   | platform operational-health route                                                                              | Outbox counts/age exist; no notification request/provider/dead-letter dashboard                                                                               |
| Audit                | `authz_audit_log`, platform audit, workflow audit/event                                                        | Reuse authorization/origin audit; add redacted ordered notification evidence                                                                                  |
| Idempotency          | `idempotency_record`, task unique `(tenant_id,task_id)`, outbox dedupe                                         | Reuse command replay/task uniqueness; add semantic notification dedupe scoped to tenant                                                                       |

## REUSE / EXTEND / ADAPT / NEW

| Area                                                                              | Decision                      | Boundary                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `outbox_event`                                                                    | REUSE                         | Domain/workflow facts in, lifecycle facts out; do not store provider attempts here        |
| `task_execution` and fencing                                                      | REUSE/EXTEND                  | Delivery queue and lease mechanics; no second queue                                       |
| `TaskRegistry`                                                                    | EXTEND                        | Exact notification executor versions and bounded schemas                                  |
| IAM/session/org guards                                                            | REUSE                         | Exact new permissions; no role-name/wildcard/legacy umbrella authorization                |
| Audit/correlation                                                                 | REUSE/EXTEND                  | Existing authz/platform/workflow audit plus ordered notification history                  |
| Development mailbox                                                               | ADAPT                         | Implement canonical provider interface without weakening environment/MFA/encryption gates |
| Invitation producer/executor                                                      | ADAPT                         | Legacy task type delegates to canonical request/delivery; equivalence before retirement   |
| WF-1 reminder/escalation outbox                                                   | ADAPT                         | Versioned intake mapping to canonical semantic templates/recipients                       |
| Templates, recipients, requests, deliveries, attempts, preferences, inbox, routes | NEW                           | Exact entities in `WF2_DATABASE_MODEL.md`                                                 |
| Production email/SMS/webhook adapters                                             | NEW                           | Provider contract and secret references; activate separately                              |
| Push                                                                              | NEW contract reservation only | No implementation/route in WF-2                                                           |

## Architecture and invariants

- ADR-005 and the specialized WF-2 documents are authoritative together.
- APIs authorize commands; provider calls occur only in leased workers.
- Request acceptance atomically pins template/policy, resolves or schedules bounded recipients, records idempotency/dedupe, appends history/audit, and enqueues tasks/outbox.
- Published templates/routes are immutable; new versions/default rotation are atomic.
- Every request/delivery/recipient/inbox query starts with tenant and organization scope.
- Notification failure cannot roll back committed workflow/domain state.
- At-least-once transport and outcome-level duplicate prevention are stated accurately.
- No `sending` row can remain without a due fenced recovery action; reconciliation determines retry or dead-letter eligibility.
- Replay ancestry uses same-tenant `parent_request_id`, new correlation/idempotency identities, bounded depth, and dual parent/child audit.
- Every failover reruns the complete tenant/organization/residency/security/provider eligibility pipeline.
- Recipient caches hold candidates only; IAM invalidation is immediate and final database eligibility checks are transactional.

## Database changes

Draft one additive, idempotent migration only after approval:

`000034_notification_platform.sql`

It creates the exact entities, constraints, restricted immutability/history triggers, indexes, permissions, tenant-safe composite keys, and compatibility columns defined in `WF2_DATABASE_MODEL.md`. It may narrowly extend existing tables only after preflight proves deployed shapes and every extension is used. It must not edit migrations 1–33, create unused push/campaign tables, store secrets, or rewrite existing notification tasks in place.

Migration sequence:

1. assert server/database identity and highest migration 33/checksums;
2. inventory deployed state/status values, constraints, duplicate candidates, and FK/index names;
3. create new tables/constraints/indexes without activating consumers;
4. seed exact permission names without mappings beyond an approved role manifest;
5. seed platform/application template metadata and tenant bindings idempotently;
6. install compatibility mapping for invitation and WF-1 event types;
7. verify no existing task/outbox row mutation;
8. official runner rerun must apply zero.

Migration 34 uses tenant-qualified composite foreign keys for every child relationship listed in `WF2_DATABASE_MODEL.md`, adds replay lineage, enforces binding semantic-key integrity, and partitions transient rate-limit buckets daily with bounded retention/cleanup. It adds no single-column tenant-child shortcut.

## Proposed code boundaries

Final filenames may be adjusted during implementation review, but ownership must remain:

- `modules/govos-core/src/notifications/`: domain contracts, state transitions, template validator/renderer, recipient/policy resolver, idempotency and command service.
- `packages/infrastructure/src/notifications/`: provider interfaces/adapters, secret-reference client, webhook signing/SSRF utilities, rate limiter; adapt `development-mailbox.ts`.
- `apps/api/src/routes/notifications.ts`: tenant APIs only.
- `apps/api/src/routes/platform-admin/notifications.ts`: separate platform catalog/provider operations.
- `apps/worker/src/notification-runtime.ts`: intake/scheduler/delivery/callback reconciliation lifecycle.
- Existing invitation producers/executor: thin compatibility adapters only.
- `apps/web/src/notifications/`: user inbox and authorized admin/operations surfaces.
- `packages/testing/src/wf2-*.test.ts`: database/integration/security/equivalence/worker tests.

No provider adapter may import API route code or workflow internals. Core does not import vendor SDKs.

## API and UI changes

Implement only `WF2_API_SPECIFICATION.md`. Add inbox navigation, preference controls, tenant template/policy/provider/webhook administration, and authorized operations dashboards. UI is never authorization authority and never receives raw provider secrets/destination ciphertext. Accessibility requires keyboard operation, labels, focus states, status text independent of color, reduced motion, and screen-reader-live updates for inbox actions.

## Worker model

1. Outbox intake claims approved versioned event types and calls the canonical request service idempotently.
2. Scheduler materializes scheduled recipient resolution/deliveries and deterministic tasks in bounded tenant-fair batches.
3. Delivery workers claim `task_execution` with 60-second lease, monotonic fencing, 20-second heartbeat, bounded batch/concurrency, graceful shutdown, timeout/cancellation, and startup recovery.
4. Worker re-resolves tenant/resource/delivery state, decrypts just-in-time, invokes one pinned provider route entry, records append-only attempt, transitions delivery/history, and schedules retry/failover under policy.
5. Callback intake verifies raw-body signatures/replay, appends callback receipt, and advances matched delivery by CAS.
6. Dead-letter reconciliation and replay remain administrative commands, never background state rewrites.

The recovery sweeper treats an expired `sending` lease as a reconciliation command, not a send command: confirmed non-acceptance may requeue after all eligibility/budget checks; confirmed acceptance/delivery advances state; ambiguity dead-letters. Confirmation expiry defaults are 72 hours for email and 24 hours for SMS/webhook.

Worker readiness exposes last successful poll, oldest due item, in-flight count, lease loss, dead letters, provider health, callback lag, and stopping state without payloads.

## WF-1 integration

Register exact event mappings for assignment, SLA reminder, SLA breach/escalation, and completion. Each mapping specifies schema version, semantic template key, selector, channels, mandatory classification, dedupe identity, and variable projection. Consume tenant/org/workflow/event/work-item/escalation IDs only; resolve current active recipients under WF-1 rules. Preserve workflow event ordering and version pinning. Notification lifecycle events reference workflow IDs but never mutate workflow state directly.

## Compatibility plan

- Retain `govos.notification.invitation.send` and its encrypted payload contract during dual-write/shadow validation.
- Every processed legacy invitation payload increments the bounded-label metric `notification.compatibility.invitation.legacy_fallback_count`; this metric contains no tenant, destination, or token label and is the retirement gate.
- The adapter creates/replays a canonical notification request using the legacy task ID as producer idempotency identity, then canonical delivery performs the effect.
- Preserve worker-side decryption, activation-token secrecy, masked logs, max-attempt behavior, and development mailbox ID/lifecycle.
- Equivalence tests cover invitation create/resend/revoke/expired, duplicate, concurrent claim, retry, permanent failure, development delivery/open, production-disabled development provider, rollback, and restart recovery.
- Existing outbox event producers remain unchanged initially. Per-event mappings activate by allowlist; unrecognized events retain current dispatch behavior.

## Implementation phases

0. Architecture approval and baseline inventory freeze.
1. Migration 34 schema/permissions with consumers disabled.
2. Core state/template/recipient/idempotency services and unit/property tests.
3. In-app provider and inbox; development mailbox adapter; invitation compatibility shadow mode.
4. Worker intake/scheduler/delivery/recovery and operations health.
5. Webhook endpoints/signing/callbacks and one production email provider; SMS provider activation only after credential/data-residency review.
6. WF-1 event mappings and equivalence tests.
7. Tenant admin/inbox UI and accessibility acceptance.
8. Canary rollout, independent review, corrections, regression, approval. Push/mobile/campaign work does not enter these phases.

## Rollout plan

1. **Dark schema:** apply migration 34 with every WF-2 consumer and route disabled; verify invariants and operational queries.
2. **Shadow intake:** translate only disposable/approved invitation events into canonical requests without external effects; compare template, recipient, task, and dedupe evidence to legacy behavior.
3. **Development and in-app:** activate the canonical development-mailbox adapter and in-app channel for test tenants; prove restart, replay, privacy, and inbox behavior.
4. **Email canary:** activate one reviewed production email route for allowlisted tenants/semantic keys with strict volume caps, then observe acceptance, callback, retry, suppression, and dead-letter thresholds through a full retention window.
5. **WF-1 canary:** enable assignment, reminder, escalation, and completion mappings one at a time for allowlisted workflow definitions/tenants. Workflow remains authoritative and unaffected by notification failure.
6. **Webhook then SMS:** activate verified webhook tenants and SMS only after separate credential, sender, residency, cost, opt-out, and provider-readiness approval.
7. **General availability:** expand flags gradually by tenant/channel/semantic key; retire the legacy invitation effect only after equivalence, stability, and rollback drills pass.

Each stage has an owner, start/end watermark, traffic ceiling, error/dead-letter/duplicate/privacy thresholds, and automatic intake stop. Crossing a threshold invokes `WF2_ROLLBACK_STRATEGY.md`; it never triggers blind resend or provider fallback after an ambiguous outcome.

## Testing strategy

Unit/property tests: lifecycle transition tables, template bounds/injection, deterministic rendering, preference precedence, dedupe hashes, provider classifier/failover, backoff/jitter bounds, quiet hours/DST, URL/SSRF/signature/replay.

Database/concurrency tests: migration apply/no-op/rollback/reapply, FKs/checks/immutability, default rotation, request idempotency collision, recipient snapshot isolation, delivery single-winner claims, fencing, callback/task races, ordered history, rate-bucket atomicity, dead-letter replay.

Integration/equivalence tests: every selector/channel, cross-tenant/org denial, inactive memberships, empty queues, opt-out/mandatory/emergency cases, invitation legacy paths, WF-1 assignment/SLA/escalation/completion, provider pre-acceptance failover/ambiguous outcome, development mailbox, restart recovery.

System/UI tests: inbox lifecycle, admin permissions, dashboard redaction, webhook verification/rotation, accessibility, production configuration fail-closed.

Performance/security tests additionally cover keyset pagination for requests/deliveries/dead letters/inbox, token-bucket/sliding-window boundary behavior, daily rate-bucket partition creation/drop, immediate IAM cache invalidation plus database fallback, semantic-key binding mismatch, full failover policy re-evaluation, replay chains/correlation/audit, legacy fallback telemetry, and 72/24-hour confirmation expiry.

## Acceptance criteria

- All exact contracts in the WF-2 package implemented without undocumented aliases/states/permissions.
- Migration 34 additive/idempotent/checksum-safe; rollback rehearsal and forward reapply pass.
- No tenant/org, IAM, audit, workflow ordering/version, idempotency, or secret invariant regresses.
- Legacy invitation and approved WF-1 mappings pass equivalence.
- Focused and full sequential tests, all workspace TypeScript, production builds, invariant SQL, security/privacy scans, and manual UI acceptance pass.
- Evidence and independent review are complete before merge/tag/provider rollout.

## Known deferrals

Marketing/bulk promotion, mobile push delivery, visual builders, cross-region active-active, marketplace plugins, arbitrary tenant code/helpers, provider-side template ownership, and automatic ambiguous-outcome failover.
