# WF-1 SLA and Escalation Model

## SLA policy

A published policy pins target duration, calendar/time zone, start/pause/resume/stop events, warning thresholds, breach threshold, applicability condition, and escalation policy version. Durations are positive bounded business or elapsed minutes; calendar intervals are non-overlapping and DST-tested.

## Clock behavior

Clock initializes atomically on configured event. It records accumulated eligible seconds and last-start time; due/warning times are derived by the calendar service and persisted. Pause is allowed only for configured states/reason codes and audited. Suspension does not automatically pause unless policy says so. Completion/cancellation stops the clock. Database time is authoritative.

## Evaluation

The next threshold creates one durable timer. Timer fire re-locks the clock, recomputes from persisted policy/calendar, ignores stale/early duplicates, advances warning/breach state by CAS, appends an event, schedules the next threshold, and creates escalation actions. Downtime causes catch-up, not deadline loss.

## Escalation levels

Each immutable level has offset from warning/breach, action set, recipient resolver, repeat/cooldown/max-repeat rules, and stop condition. Supported initial actions: notify role/user/queue, reassign/add queue visibility, create supervisor work item, and raise operational alert. Automatic domain approval, payment confirmation, licence issuance, role grant, or punitive enforcement is prohibited.

## Recipient resolution

Resolve at execution time within tenant and organization using exact active memberships/permissions. Empty or ambiguous recipient sets fail safely to an operational dead letter and higher-level platform health alert without granting broader access.

## Idempotency and audit

Unique `(tenant_id,clock_id,policy_version,level,action_type,repeat_number)` makes effects idempotent. Notification uses existing encrypted outbox. Record IDs, policy/version, threshold, computed duration, recipient IDs, task/outbox IDs, result/failure code; no message body, contact data, or secrets.

## Metrics

Active clocks, due soon, warning/breach counts, breach duration percentiles, evaluation lag, action latency/failure, recipient-resolution failure, repeated escalation, tenant/definition/organization aggregates with authorization-safe dimensions.
