# WF-2 Retry and Dead-Letter Model

Status: Approved with required review changes incorporated

## Retry policy

- Transport is at-least-once; effects are deduplicated at the request, delivery, task, and provider boundaries.
- Default maximum is 5 provider attempts, 24-hour maximum elapsed age, and 60-second task lease. Channel policy may lower these bounds; raising them requires reviewed provider policy.
- Backoff is exponential with full jitter, capped at 15 minutes, and respects a bounded provider `Retry-After` when valid.
- Retry scheduling uses database time. A retry creates a new append-only attempt but retains one delivery identity.
- Lease loss is not itself a provider retry if the external outcome is unknown; it follows unknown-outcome reconciliation rules.
- A delivery in `sending` at lease expiry is never left untouched and is never blindly retried. The recovery sweeper reconciles it and transitions it to `queued`, `provider_accepted`, `delivered`, `expired`, or `dead_lettered` under the exact state-machine rules.

## Classification table

| Class           | Examples                                                                                                                  | Action                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `transient`     | DNS/connect failure before send, timeout with proven no acceptance, provider 5xx, temporary dependency                    | retry same provider or approved failover within budget                                    |
| `rate_limited`  | local bucket empty, provider 429/quota                                                                                    | schedule at bounded reset; fail over only if published route permits                      |
| `permanent`     | invalid destination, rejected sender/content, revoked endpoint, schema failure                                            | terminal `permanent_failed`; no automatic failover                                        |
| `suppressed`    | opt-out, quiet-hours terminal policy, bounce/complaint list, inactive recipient, channel prohibited                       | no provider attempt; terminal `suppressed` or future `scheduled` for quiet hours          |
| `unknown`       | connection lost after submission, lease lost during provider call, unverifiable response                                  | reconcile with provider when supported; otherwise dead-letter to avoid duplicate delivery |
| `dead_lettered` | attempts/age exhausted, missing immutable dependency, misconfigured route/secret, invariant violation, unresolved unknown | terminal operational queue; manual preview/replay only                                    |

Provider adapters return normalized evidence; they do not choose retry policy. Unrecognized errors classify as `unknown`, never transient by default.

Before retrying through a different provider, the failover engine reruns the complete eligibility pipeline for that candidate: residency, classification, tenant policy, organization policy, channel/sender/endpoint ownership, secret/key status, provider capabilities/health, security restrictions, rate/cost limits, request expiry, recipient eligibility, and suppression. A retry classification authorizes reconsideration only; it never authorizes policy bypass.

## Idempotency and deduplication

- API request identity: `(tenant_id, producer_namespace, idempotency_key)` plus canonical request hash. Same hash replays the original response; different hash returns 409.
- Semantic dedupe identity: hash of tenant, semantic key, source type/ID/event version, recipient selector identity, channel purpose, and caller-provided occurrence. Window and payload hash are recorded in `notification_deduplication_record`.
- Delivery identity: tenant, request, resolved recipient, channel, destination digest, and template version.
- Task identity: `notification.delivery:<tenant_id>:<delivery_id>:<logical_attempt>` with payload hash collision detection.
- Provider identity: stable delivery identity when provider supports it; never regenerated merely because a worker lease changes.
- Webhook callback identity: provider/callback ID or timestamp/nonce/body digest with bounded replay window.
- `outbox_event.deduplication_key` includes tenant, producer, aggregate/event version, and semantic notification mapping.

## Dead-letter operations

Dead-letter records are delivery rows plus immutable attempts/history; no duplicate shadow queue is created. Operations expose redacted reason, provider/route IDs, attempts, age, source IDs, and remediation eligibility.

Replay requires `notification:operations:replay`, recent authentication/MFA where policy requires, reason, expected version, and idempotency key. It performs a dry-run preview of current template/provider/recipient dependencies. Approval creates a new linked notification request; it never changes the old terminal state or deletes attempts. High-classification, mandatory, emergency, and bulk-like replays may require dual control.

Every replay sets the new request's `parent_request_id` to the immediate source request using a same-tenant composite foreign key. A replay chain preserves every ancestor; API responses expose `parentRequestId`, `rootRequestId`, and bounded `replayDepth`. The new request receives its own request/correlation/idempotency identities and stores the originating replay command ID plus the parent's correlation ID. The replay transaction appends redacted audit/history entries to both parent and child with actor, reason code, parent/child IDs, preview hash, and correlation IDs. Creation-only lineage, a maximum depth of 20, and same-tenant locking prevent cycles and runaway replay chains.

## Crash recovery

- Claim uses bounded `FOR UPDATE SKIP LOCKED`/fenced update.
- Every heartbeat/complete/fail verifies tenant, task ID, owner, fencing token, processing state, and unexpired lease.
- Expired pre-send leases return to claimable state.
- Expired `sending` leases run provider reconciliation before any retry. Confirmed non-acceptance returns to `queued` if budgets/policy still permit; confirmed acceptance/delivery advances accordingly; ambiguous or unsupported reconciliation dead-letters.
- Startup scans expired leases, overdue schedules, stuck `resolving` requests, callbacks awaiting match, and provider-accepted deliveries awaiting confirmation.

Recovery is itself leased/fenced and bounded. Reconciliation retries use a separate bounded recovery budget and never extend the delivery's maximum elapsed age. There is therefore no non-terminal `sending` path without a due recovery action.

## Alerts and metrics

Alert on dead-letter growth, oldest age, unknown outcomes, callback verification failures, recipient-resolution failures, secret/route misconfiguration, sustained provider rate limiting, lease loss, and tenant fairness starvation. Alerts carry IDs/codes/counts only.
