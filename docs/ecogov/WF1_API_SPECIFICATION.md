# WF-1 API Specification

Status: Implemented; `/v1/workflows` is canonical

## Contract conventions

JSON over HTTPS; authenticated tenant context; UUID path IDs; ISO-8601 UTC timestamps; explicit `Idempotency-Key` for commands; `If-Match`/`expectedVersion` for mutable resources; correlation/request IDs; cursor pagination; generic 404 for out-of-scope resources. Errors use `{code,message,correlationId,fieldErrors?}` and never expose conditions, secrets, payloads, or another tenant's existence.

## Definition plane

| Method/path | Permission | Result |
| --- | --- | --- |
| `GET /v1/workflows/definitions` | `workflow:definition:read` | Scoped catalog |
| `POST /v1/workflows/definitions` | `workflow:definition:create` | Draft definition |
| `GET /v1/workflows/definitions/:id` | read | Definition and versions |
| `PATCH /v1/workflows/definitions/:id` | `workflow:definition:update` | Versioned metadata update |
| `POST /v1/workflows/definitions/:id/versions` | update | Clone/new draft |
| `PUT /v1/workflows/versions/:id/model` | update | Replace draft model with expected version |
| `POST /v1/workflows/versions/:id/validate` | `workflow:definition:validate` | Deterministic validation report |
| `POST /v1/workflows/versions/:id/publish` | `workflow:definition:publish` | Immutable published version |
| `POST /v1/workflows/versions/:id/deprecate` | publish | Stops new starts; pinned instances continue |
| `GET /v1/workflows/versions/:id/export` | read | Canonical redacted model/hash |

Publish requires reason, expected version, successful current validation hash, and idempotency key. Published model mutation returns 409.

## Runtime commands

| Method/path | Permission |
| --- | --- |
| `POST /v1/workflows/instances` | definition-specific `workflow:start` mapping |
| `GET /v1/workflows/instances/:id` | `workflow:instance:read` plus resource scope |
| `GET /v1/workflows/instances/:id/events` | `workflow:audit:read` |
| `POST /v1/workflows/instances/:id/suspend` | `workflow:instance:suspend` |
| `POST /v1/workflows/instances/:id/resume` | `workflow:instance:resume` |
| `POST /v1/workflows/instances/:id/cancel` | `workflow:instance:cancel` |
| `POST /v1/workflows/instances/:id/retry` | `workflow:instance:repair` |
| `POST /v1/workflows/steps/:executionId/complete` | definition outcome permission |
| `POST /v1/workflows/steps/:executionId/fail` | internal executor or repair permission |

Start body: `definitionKey`, optional published version, entity type/ID, business key, redacted context. Response 202 with instance/version/current-step IDs; machine work remains asynchronous. Complete body: `outcomeCode`, expected execution/instance versions, reason, output reference (not raw secret payload).

## Human work

`GET /v1/work-items`, `GET /v1/work-items/:id`, `POST .../:id/claim`, `.../release`, `.../reassign`, `.../complete`. Claim is atomic and idempotent; completion rechecks membership, permission, organization, work-item version, and step state. Reassignment requires `workflow:work-item:assign` and reason.

## SLA and operations

Read policies/calendars require `workflow:policy:read`; mutations/publish require `workflow:policy:write/publish`. Operations endpoints expose aggregate health, stuck instances, dead letters, timers, breaches, and replay preview. Replay/repair is POST, MFA/recent-auth protected, reasoned, idempotent, audited, and cannot mutate financial ledgers or bypass domain preconditions.

## Webhooks/internal execution

No public worker callback. Internal task completion uses repository-supported authenticated service identity and the same command service. Outbound domain integration uses outbox events with versioned schemas and deduplication keys. Payloads carry IDs/schema versions, not credentials or unrestricted PII.

## Status codes

200 reads/idempotent replay; 201 draft resources; 202 accepted async commands; 400 malformed; 401 unauthenticated; 403 known action forbidden; 404 absent/out of scope; 409 version/idempotency/state conflict; 422 valid shape but invalid graph/outcome/policy; 429 bounded operational controls; 503 required engine dependency unavailable.
