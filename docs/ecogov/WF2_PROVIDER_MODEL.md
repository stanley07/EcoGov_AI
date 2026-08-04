# WF-2 Provider Model

Status: Proposed for independent review

## Provider contract

Every adapter is registered by exact `(provider_key, adapter_version, channel)` and implements:

```text
capabilities() -> channel, max sizes, supported content, idempotency, callbacks, regions
validateConfiguration(secretReference, senderProfile) -> redacted result
send(deliveryEnvelope, executionContext) -> ProviderResult
classify(errorOrResponse) -> transient | rate_limited | permanent | unknown
verifyCallback(headers, rawBody, endpointContext) -> VerifiedCallback
normalizeCallback(verifiedCallback) -> delivery status event
health() -> available | degraded | unavailable (no secret disclosure)
```

`deliveryEnvelope` contains a tenant ID, delivery ID, provider idempotency identity, approved sender profile, protected destination/content references, expiry, and correlation ID. `executionContext` contains task ID, attempt, lease owner, fencing token, timeout, and cancellation signal. Adapters cannot select tenants, templates, recipients, routes, or retry policy.

## Routing

1. Resolve an active tenant/organization channel policy.
2. Pin the active provider-route version/hash onto the delivery.
3. Filter route entries by channel, data classification, residency, provider health, sender verification, and active secret reference.
4. Choose the lowest ordered eligible provider.
5. Record provider and route position before invocation.
6. Apply the adapter classifier to the outcome; core policy, not the adapter, decides retry/failover.

Empty or misconfigured routes fail closed to `dead_lettered` with an operational alert. No fallback to a global provider occurs unless the published tenant route explicitly includes it.

## Failover rules

- Failover is allowed for deterministic pre-send configuration unavailability and transient failures where the adapter proves the provider did not accept the message.
- Rate limiting may fail over only when the route explicitly permits quota failover and doing so does not violate sender, residency, classification, or tenant policy.
- After `provider_accepted`, timeout with unknown outcome, or an ambiguous connection reset, automatic cross-provider failover is forbidden unless the original provider supports the same stable idempotency key and its contract guarantees duplicate suppression. Otherwise the delivery is operationally dead-lettered for reconcile/replay.
- Permanent destination/content failures do not fail over.
- Each route entry is attempted at most once per logical attempt cycle; total attempts and elapsed age remain globally bounded.
- Provider health is a routing input, never authority to bypass tenant policy.

## Channel-specific rules

- Email: verified sender/domain; header injection prevention; bounded subject/body/attachments; unsubscribe only for optional categories; bounce/complaint callbacks update suppression.
- SMS: E.164 destinations; sender registration; segment bound and cost guard; STOP/opt-out signals create suppression where applicable.
- In-app: no external provider; transactional inbox projection is the adapter effect; same tenant/user only.
- Webhook: verified HTTPS endpoint, signed timestamped body, SSRF-safe resolution, strict timeout/body bounds, 2xx success only.
- Push: reserved provider capability only; no WF-2 implementation or active route.

## Secrets and configuration

- Provider credentials, webhook signing keys, and sender secrets live in the approved secret manager/encrypted configuration store. Database rows contain opaque secret references and key versions only.
- Secret reads occur only in worker/provider processes with least privilege; API responses and health checks never reveal secret values.
- Rotation supports a bounded overlap for callback verification and a single active outbound key. Rotation and test sends require exact permission, recent authentication/MFA where approved, reason, idempotency, and audit.
- Provider test sends use dedicated verified destinations and are clearly marked; they never use arbitrary production recipients.

## Provider operational metrics

Emit bounded labels for attempts, accepted/delivered rates, classified failures, rate limits, latency, callback lag, lease loss, route failover, unknown outcomes, cost/segment counts, and health. Never label metrics with raw tenant names, destinations, subjects, bodies, URLs, provider responses, or secrets.
