# ADR-005 — GovOS Notification Platform

- Status: Accepted
- Milestone: WF-2
- Baseline: `wf-1-complete` (`5c3fcb16b2511eeb37de3f8f911de8188d9752d2`)
- Date: 2026-08-04

## Context

GovOS currently sends invitation notifications through an encrypted `task_execution` payload and supports an explicitly enabled, protected development mailbox. Domain and workflow code also publishes durable `outbox_event` rows, including WF-1 SLA reminders and escalations. These facilities provide durable transport primitives but not a canonical notification aggregate, governed templates, recipient resolution, preferences, provider routing, delivery history, inbox, webhook security, or operational replay.

WF-2 must provide one reusable notification platform without creating a second task queue, weakening IAM/WF-1 boundaries, or treating provider acceptance as exactly-once delivery.

## Normative references

- `GOVOS_ENGINEERING_IMPLEMENTATION_FRAMEWORK_v1.0.md`
- ADR-002 tenant-context identity and platform-login separation
- ADR-003 exact tenant RBAC, protected roles, and no implicit permission expansion
- approved IAM Gate 3 permission manifest, Gate 4 identity/session controls, and Gate 5 organization delegation
- ADR-004 workflow transaction, version pinning, tenant/organization, task, outbox, audit, and compatibility decisions
- approved WF-1 API, security, task, SLA/escalation, state, versioning, remediation, rollback, and verification documents at `wf-1-complete`
- approved NOTIFY-1 development-mailbox plan and evidence

If a WF-2 implementation detail conflicts with one of these invariants, implementation stops for an ADR amendment; WF-2 does not silently override it.

## Decision

1. PostgreSQL is authoritative for notification definitions, requests, recipient snapshots, channel deliveries, attempts, status history, preferences, suppression, rate-limit state, webhook endpoints, and audit references.
2. `outbox_event` remains the transactional fact/integration outbox. A notification intake consumer translates approved versioned event types into notification requests. Outbox is not the delivery queue.
3. `task_execution` remains the durable delivery work queue. Each channel delivery uses deterministic tenant-qualified task identity, the existing lease/fencing discipline, bounded retries, heartbeats, crash recovery, and permanent-failure handling.
4. Transport is at-least-once. Outcome-level duplicate prevention is provided by request idempotency, immutable recipient snapshots, per-channel deduplication identities, provider idempotency keys where supported, and terminal-state compare-and-set updates. WF-2 never claims exactly-once external delivery.
5. Templates may be platform-owned, application-owned, or tenant-owned. All are versioned. Published versions and their content, schema, security classification, channel renderings, and hashes are immutable. Changes require a new draft version. Tenant overrides are explicit bindings, never in-place edits of platform/application versions.
6. Email, SMS, in-app, and webhook are implemented channels. `push` is a reserved channel value and contract extension point, but mobile push delivery is deferred.
7. Recipient selectors are resolved at request acceptance or scheduled execution according to policy, then frozen as tenant/organization-scoped recipient snapshots before delivery. Workers never broaden an empty or invalid selector.
8. A delivery request is an aggregate; each resolved recipient/channel pair is a channel delivery. Attempts are append-only children. Status history is append-only and ordered per request. Provider callbacks may advance delivery status but cannot rewrite attempt history.
9. Provider routing is channel-specific, tenant-aware, allowlisted, health-aware, and policy-pinned. Failover is permitted only for compatible providers and only after a classified pre-acceptance failure or explicit unknown-outcome policy. No automatic failover follows a provider acceptance when duplicate delivery is possible.
10. Preference precedence is: emergency override authorized by policy; legal/mandatory delivery obligations; tenant policy; user opt-out; quiet hours. Mandatory notices may bypass opt-out but not invalid destinations, legal suppression, tenant isolation, or channel security. Emergency override is separately permissioned, reasoned, idempotent, and audited.
11. Contact destinations are minimized and protected. Raw addresses, phone numbers, message bodies, credentials, signing secrets, and tokens are excluded from logs, metrics, audit context, URLs, task results, and ordinary administrative reads.
12. Webhook endpoints are tenant-owned and optionally organization-bound. They require verified ownership, HTTPS, SSRF protections, encrypted secret references, signed timestamped payloads, replay protection, bounded retries, and secret rotation overlap.
13. The development mailbox remains development-only, explicit, encrypted at rest, platform-MFA protected, and non-production. It becomes a provider adapter behind the canonical provider contract while retaining its existing safe API and invitation compatibility.
14. WF-1 integrations use versioned notification event contracts for assignments, SLA reminders, breaches/escalations, and completion. Notification failure never rolls back an already committed workflow transition.
15. WF-2 begins with additive migration `000034_notification_platform.sql`. Migration 33 and all earlier migrations remain unchanged.

## Ownership and isolation

- Tenant-owned rows always carry `tenant_id`; organization-scoped rows also carry `organization_id` with tenant-safe composite foreign keys.
- Platform/application catalog templates are global catalog resources with a constrained ownership discriminator and separate platform authorization. A tenant delivery may consume them only through an active tenant-local template binding.
- Tenant actors cannot mutate platform/application templates or provider-global configuration. Platform actors cannot impersonate tenant actors or read tenant message content through platform operations.
- Every resource lookup begins with authenticated tenant context. Out-of-scope tenant/organization resources return generic `404`.

## Alternatives rejected

- Direct provider calls from API/workflow transactions: breaks durability, recovery, and latency boundaries.
- Reusing `outbox_event` as the complete delivery ledger: conflates domain facts with mutable retry/provider state.
- A single JSON notification table: weak lifecycle, recipient, attempt, and isolation invariants.
- Mutable published templates: destroys reproducibility and audit evidence.
- Resolve roles/organizations inside provider workers: risks membership drift, over-broad delivery, and non-deterministic replay.
- Unconditional provider failover: can duplicate messages after ambiguous provider acceptance.
- External notification SaaS as the system of record: weakens tenant control, auditability, provider portability, and local development behavior.

## Consequences

Positive consequences are deterministic retries, reproducible rendering, tenant-safe recipient snapshots, channel/provider portability, auditable suppression and preferences, a durable inbox, and clean WF-1 integration. Costs are additive schema, a notification intake worker, channel delivery executors, callback handling, provider credential operations, retention controls, and operational dashboards.

## Review gates

ADR approval precedes migration drafting. Database, API, security/privacy, provider, and operations review precede implementation. Provider activation and tenant rollout are separate feature-flagged approvals. No legacy invitation producer is retired until equivalence tests pass.

## Explicit deferrals

Marketing campaigns, bulk promotional messaging, mobile push implementation, complex visual template builders, cross-region active-active delivery, and third-party marketplace notification plugins are deferred. Push remains only a reserved contract extension point.
