# WF-2 Security Model

Status: Approved with required review changes incorporated

## Trust boundaries

Browser/API client, tenant API, notification command service, PostgreSQL, outbox intake, task scheduler/worker, secret store, external providers, provider callbacks, development mailbox, and platform operations are separate boundaries. A client/provider cannot choose authorization, tenant context, template publication, recipient expansion, route fallback, retry class, or final state.

## Exact tenant permission vocabulary

- `notification:template:read`
- `notification:template:create`
- `notification:template:update`
- `notification:template:validate`
- `notification:template:publish`
- `notification:template:deprecate`
- `notification:policy:read`
- `notification:policy:write`
- `notification:provider:read`
- `notification:provider:manage`
- `notification:webhook:read`
- `notification:webhook:write`
- `notification:webhook:rotate-secret`
- `notification:request:create`
- `notification:request:read`
- `notification:request:cancel`
- `notification:recipient:direct`
- `notification:emergency:send`
- `notification:inbox:read`
- `notification:inbox:manage`
- `notification:audit:read`
- `notification:operations:read`
- `notification:operations:replay`

No wildcard, prefix expansion, inferred role authority, `user:write`, legacy `workflow:write`, or `platform.*` permission may authorize a new WF-2 tenant endpoint. Role mappings require a separate approved permission-manifest review; this package defines names, not grants.

Platform catalog/provider operations use a separate exact vocabulary: `platform.notification.template.read/write/publish`, `platform.notification.provider.read/manage`, `platform.notification.operations.read/replay`, and `platform.notification.audit.read`. They require the existing platform assignment architecture and MFA/recent authentication. They grant no tenant message-content access or tenant impersonation.

## Enforcement sequence

Authenticate actor/service; validate active tenant; validate session version/current membership; verify exact permission; resolve resource by tenant and organization; verify definition/application semantic permission; validate expected version/idempotency/state; enforce classification/preference/suppression/rate policy; transact state/history/task/outbox/audit. Denied and out-of-scope actions are auditable without revealing another tenant or destination.

## Tenant and organization isolation

- IDs are never queried globally then compared.
- Tenant/org composite predicates and foreign keys protect requests, recipients, destinations, deliveries, endpoints, preferences, inbox, and audit.
- Role/organization resolution uses active membership and current organization state.
- Tenant `super_admin` override exists only for tenant-wide reads/actions explicitly documented by API; it is never a platform override and never bypasses destination privacy.
- Organization administrators remain limited to assigned organizations and cannot publish platform/application templates or manage provider-global credentials.
- Workers carry tenant/resource IDs from protected task payloads and re-resolve the delivery under those predicates before decrypting.
- Recipient/membership caches are never authorization evidence. IAM changes publish immediate tenant-qualified invalidation, and resolution plus just-in-time delivery eligibility are transactionally revalidated in PostgreSQL whenever freshness cannot be proven.

## Privacy and data protection

- Classify template variables and content as public, internal, confidential, restricted, or secret-reference-only.
- Minimize content. Prefer object/record IDs and short-lived purpose-bound links over embedded sensitive records.
- Encrypt destinations and rendered confidential content using approved envelope encryption; database stores key version/reference. Credentials/signing keys remain in secret management.
- Logs, errors, metrics, audit, task results, dashboards, and ordinary APIs contain IDs, masks, hashes, classifications, counts, and bounded reason codes only.
- Never store passwords, session tokens, invitation tokens, MFA material, recovery codes, raw provider credentials, webhook signing secrets, raw documents, or unrestricted provider responses.
- Provider data-processing region and retention must satisfy the pinned classification/tenant route policy.
- Data-subject access/deletion operates on content/destination envelopes while preserving legally required redacted evidence; legal holds are enforced.

## Webhook security

- Endpoint creation accepts HTTPS only, normalizes origin, blocks userinfo/fragments, private/link-local/loopback/metadata/reserved networks, validates every DNS result, and pins/revalidates resolution to resist DNS rebinding. The outbound client disables DNS caching, resolves and checks every IPv4/IPv6 result immediately before every connection/retry, pins the socket to the approved IP, and preserves TLS hostname/SNI verification.
- Ownership verification uses a short-lived one-time challenge before activation. Redirects are disabled or revalidated within the exact verified origin.
- Outbound body is canonical bytes. Sign `version.timestamp.nonce.bodyDigest` using HMAC-SHA256 initially; Ed25519 may be added only as a reviewed provider capability.
- Headers include key ID, timestamp, nonce, event ID, and signature. Timestamp skew and nonce/callback IDs enforce replay windows.
- Rotation has a bounded verification overlap, one active outbound key, audited key versions, and no returned secret after creation.
- Callbacks use raw bytes, constant-time signature comparison, content-type/size limits, tenant/provider endpoint ownership, callback dedupe, and generic responses.

## Abuse controls

Tenant/organization/user/channel/provider rate limits; request and fan-out quotas; content/attachment/recipient bounds; webhook egress allowlists; sender-domain verification; SMS segment/cost caps; bounded schedules/retries; tenant-fair worker claims; emergency-send quotas and dual control; administrative replay caps.

## Development mailbox

Activation requires exact development environment flags and explicit provider selection. Files remain `0700/0600` best effort, payloads AES-256-GCM protected, IDs path-safe, and duplicate delivery idempotent. List/view omit protected payload; open decrypts in memory only. Access remains platform-MFA and `platform.audit.read` compatible during migration, then moves to the approved platform notification audit permission without broadening access. It is unavailable in production and CI operational runs.

## Threat tests

Cross-tenant/org ID injection; global template/binding confusion; stale membership/session; destination enumeration; role fan-out amplification; preference/emergency bypass; template injection/XSS/header injection; SSRF/DNS rebinding; webhook signature/replay/key rotation; provider credential leakage; ambiguous-send failover duplication; stale lease/fencing; callback spoofing; idempotency collision; suppression bypass; audit/log/metric PII leakage; platform/tenant authority confusion; development provider enabled in production.
