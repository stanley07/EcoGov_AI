# WF-2 Delivery State Machine

Status: Approved with required review changes incorporated

## Request aggregate states

Exact vocabulary:

`accepted`, `resolving`, `scheduled`, `processing`, `partially_delivered`, `delivered`, `suppressed`, `failed`, `dead_lettered`, `cancelled`, `expired`.

| From                  | Permitted transition                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| creation              | `accepted`                                                                                                        |
| `accepted`            | `resolving`, `cancelled`, `expired`                                                                               |
| `resolving`           | `scheduled`, `processing`, `suppressed`, `failed`, `dead_lettered`, `cancelled`, `expired`                        |
| `scheduled`           | `processing`, `cancelled`, `expired`                                                                              |
| `processing`          | `processing`, `partially_delivered`, `delivered`, `suppressed`, `failed`, `dead_lettered`, `cancelled`, `expired` |
| `partially_delivered` | `processing`, `delivered`, `failed`, `dead_lettered`, `cancelled`, `expired`                                      |

All other transitions are rejected. Terminal states are `delivered`, `suppressed`, `failed`, `dead_lettered`, `cancelled`, and `expired`. A terminal state cannot be reopened; an authorized replay creates a new request linked to the old request.

Request aggregation is deterministic:

- all child deliveries delivered/accepted under channel policy -> `delivered`;
- a mix of successful and non-successful terminal children -> `partially_delivered` while retryable children remain, otherwise `failed` or `dead_lettered` according to terminal children;
- all children suppressed -> `suppressed`;
- any retryable child -> `processing` or `scheduled`;
- all failed and at least one exhausted -> `dead_lettered`;
- expiry before required success -> `expired`.

## Channel delivery states

Exact vocabulary:

`queued`, `scheduled`, `leased`, `sending`, `provider_accepted`, `delivered`, `transient_failed`, `rate_limited`, `permanent_failed`, `suppressed`, `dead_lettered`, `cancelled`, `expired`.

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> scheduled
  queued --> leased
  queued --> suppressed
  queued --> cancelled
  queued --> expired
  scheduled --> leased
  scheduled --> cancelled
  scheduled --> expired
  leased --> sending
  leased --> queued: lease expired before effect
  sending --> queued: reconciliation proves provider did not accept
  sending --> provider_accepted: reconciliation proves acceptance
  sending --> delivered: reconciliation proves delivery
  sending --> dead_lettered: outcome remains ambiguous
  sending --> provider_accepted
  sending --> delivered
  sending --> transient_failed
  sending --> rate_limited
  sending --> permanent_failed
  provider_accepted --> delivered: authenticated receipt/callback
  provider_accepted --> transient_failed: provider-confirmed non-delivery
  transient_failed --> scheduled
  rate_limited --> scheduled
  transient_failed --> dead_lettered: attempts/age exhausted
  rate_limited --> dead_lettered: attempts/age exhausted
  provider_accepted --> expired: delivery confirmation window elapsed
  delivered --> [*]
  permanent_failed --> [*]
  suppressed --> [*]
  dead_lettered --> [*]
  cancelled --> [*]
  expired --> [*]
```

`provider_accepted` means the provider accepted responsibility; it is not proof of human receipt. Email/SMS routes may define accepted as the success criterion while retaining later bounce/delivery callbacks. In-app creation moves directly to `delivered`. Webhook 2xx moves directly to `delivered`.

The default confirmation window is 72 hours after provider acceptance for email and 24 hours for SMS and webhook. A published channel policy may shorten, but not silently lengthen, that bound. When the window closes without authenticated confirmation, reconciliation records the safe reason and transitions `provider_accepted -> expired`; it never resends automatically. In-app has no confirmation window because the transactional inbox write is the delivery effect.

## Attempt states and classifications

Attempt states are `started`, `succeeded`, `transient_failed`, `rate_limited`, `permanent_failed`, and `lease_lost`. `suppressed` is decided before provider invocation and creates no provider attempt. Every attempt has one terminal attempt state.

Failure classifications are exact:

- `transient`: network failure, timeout before known acceptance, provider 5xx, temporary dependency outage;
- `permanent`: invalid/undeliverable destination, provider 4xx other than 408/409/425/429 when contract says permanent, unsupported content, revoked endpoint;
- `suppressed`: preference/policy/suppression/quiet-hours terminal decision where no later schedule applies;
- `rate_limited`: local or provider quota with bounded retry time;
- `unknown`: external acceptance cannot be proven or disproven; reconcile when supported, otherwise dead-letter without automatic failover;
- `dead_lettered`: retry/age budget exhausted, unknown outcome requiring operator decision, missing provider/secret/template, or invariant failure.

## Concurrency and history

- Every mutable transition compares `version`, current state, tenant, lease owner, fencing token, and unexpired lease where applicable.
- Provider callbacks lock the delivery and use callback dedupe before advancing state.
- Stale workers and stale callbacks append a denied/superseded audit result but cannot alter current state.
- Every accepted transition appends `notification_delivery_status_history` in the same transaction with the next per-request sequence.
- Cancellation is best effort after provider invocation; it never rewrites a provider-accepted or delivered child as cancelled.

## Lease-expiry and stuck-`sending` recovery

No delivery may remain indefinitely in `leased` or `sending`.

1. A fenced recovery sweeper claims expired notification tasks in bounded, tenant-fair batches and locks the corresponding delivery.
2. If the delivery is `leased` and no provider attempt reached `started`, the stale attempt is marked `lease_lost` and the delivery returns to `queued` with the same logical delivery identity.
3. If the delivery is `sending`, the sweeper must query the pinned provider's reconciliation API using the stable provider idempotency/message identity where supported. It may not invoke `send` first.
4. Provider-confirmed non-acceptance permits `sending -> queued`; normal retry budgets, age, expiry, suppression, recipient eligibility, and full route policy are re-evaluated before another attempt.
5. Provider-confirmed acceptance or delivery permits `sending -> provider_accepted` or `sending -> delivered` and appends reconciled evidence.
6. An ambiguous or unsupported reconciliation outcome permits only `sending -> dead_lettered`. Automatic retry or failover is forbidden because it could duplicate delivery.
7. Recovery exhaustion, missing provider identity/configuration, expired request, or invariant failure also transitions to the appropriate `expired` or `dead_lettered` terminal state.

The sweeper records task ID, expired owner/fencing token, attempt ID, reconciliation result code, and history sequence without provider payloads or destinations. Stale workers cannot complete after recovery because every update checks the current fencing token and state.
