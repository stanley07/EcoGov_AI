# WF-2 API Specification

Status: Approved with required review changes incorporated

## Conventions

Canonical base is `/v1/notifications`. JSON over HTTPS; authenticated tenant context; UUID IDs; UTC timestamps; `Idempotency-Key` on commands; `If-Match`/`expectedVersion` on mutable resources; correlation IDs; generic `404` for tenant/org scope failures. Errors are `{code,message,correlationId,fieldErrors?}` and contain no destination, body, provider response, secret, or foreign-resource evidence.

Requests, deliveries, dead letters, and inbox use keyset pagination only, ordered by `(created_at DESC,id DESC)`. They accept `cursor` and bounded `limit` (default 50, maximum 100), never `offset`. The opaque authenticated/base64url cursor contains the last `created_at`, last `id`, normalized filter hash, direction, and schema version; changing filters invalidates it. Responses return `{items,nextCursor}`. Low-volume catalogs such as templates/providers may use bounded offset pagination.

## Template administration

| Method/path                             | Permission                        | Result                                                                                                  |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /templates`                        | `notification:template:read`      | Tenant-visible bindings/catalog metadata                                                                |
| `POST /templates`                       | `notification:template:create`    | Tenant-owned draft template                                                                             |
| `GET /templates/:id`                    | read                              | Scoped metadata and versions                                                                            |
| `PATCH /templates/:id`                  | `notification:template:update`    | Mutable metadata with expected version                                                                  |
| `POST /templates/:id/versions`          | update                            | New/clone draft                                                                                         |
| `PUT /template-versions/:id`            | update                            | Replace draft schema/renderings                                                                         |
| `POST /template-versions/:id/validate`  | `notification:template:validate`  | Deterministic bounded report/hash                                                                       |
| `POST /template-versions/:id/publish`   | `notification:template:publish`   | Publish immutable version                                                                               |
| `POST /template-versions/:id/deprecate` | `notification:template:deprecate` | Stop new binding/use                                                                                    |
| `PUT /template-bindings/:semanticKey`   | publish                           | Atomic rotation after proving the candidate version's template owns this exact application/semantic key |
| `GET /template-versions/:id/preview`    | read                              | Redacted fixture preview; no real recipient/provider send                                               |

Platform/application catalog endpoints live under the existing platform-admin boundary, use `platform.notification.*`, MFA/recent-auth, and cannot access tenant content through these routes.

## Policies, preferences, and providers

| Method/path                                 | Permission                                            |
| ------------------------------------------- | ----------------------------------------------------- |
| `GET/PUT /policies/channels/:channel`       | `notification:policy:read/write`                      |
| `GET/PUT /policies/quiet-hours`             | policy read/write                                     |
| `GET /preferences/me`                       | authenticated user                                    |
| `PUT /preferences/me`                       | authenticated user; own preferences only              |
| `GET /providers/routes`                     | `notification:provider:read`                          |
| `POST/PATCH /providers/routes`              | `notification:provider:manage`                        |
| `GET /webhook-endpoints`                    | `notification:webhook:read`                           |
| `POST/PATCH /webhook-endpoints`             | `notification:webhook:write`                          |
| `POST /webhook-endpoints/:id/verify`        | webhook write, idempotency                            |
| `POST /webhook-endpoints/:id/rotate-secret` | `notification:webhook:rotate-secret`, recent auth/MFA |
| `POST /webhook-endpoints/:id/test`          | webhook write, verified endpoint only                 |

Provider secrets are write-only secret-manager inputs. Responses return reference/key version and health metadata, never values.

## Delivery requests

`POST /v1/notifications/requests` requires `notification:request:create` and `Idempotency-Key`.

```json
{
  "semanticKey": "workflow.sla.reminder",
  "applicationKey": "workflow",
  "organizationId": "uuid",
  "recipient": { "type": "workflow_work_item", "id": "uuid" },
  "channels": ["in_app", "email"],
  "variables": { "workflowInstanceId": "uuid", "workItemId": "uuid" },
  "source": { "type": "workflow_event", "id": "uuid", "version": 7 },
  "scheduleAt": null,
  "expiresAt": "2026-08-05T12:00:00Z",
  "mandatoryPolicyCode": null,
  "emergencyOverride": null
}
```

The API ignores caller-supplied tenant IDs and rejects unapproved variable/selector/channel fields. Direct destination requires its exact permission. Emergency override requires `notification:emergency:send`, reason, policy code, bounded scope, and stronger audit. Response is `202` with request ID, pinned template version, state, version, and safe recipient/channel counts.

| Method/path                 | Permission                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| `GET /requests`             | `notification:request:read` plus org scope                          |
| `GET /requests/:id`         | request read plus org scope                                         |
| `GET /requests/:id/history` | `notification:audit:read`                                           |
| `POST /requests/:id/cancel` | `notification:request:cancel`, expected version, reason/idempotency |

Request list/detail responses include nullable `parentRequestId`, `rootRequestId`, `replayDepth`, and safe correlation IDs. They never embed ancestor payloads. The lineage is same-tenant and immutable.

No public API forces a provider attempt or edits recipient snapshots.

## User inbox

| Method/path               | Permission/ownership                                      |
| ------------------------- | --------------------------------------------------------- |
| `GET /inbox`              | `notification:inbox:read`; current user only              |
| `GET /inbox/:id`          | read; current user/tenant only                            |
| `POST /inbox/:id/read`    | `notification:inbox:manage`, expected version/idempotency |
| `POST /inbox/:id/unread`  | manage                                                    |
| `POST /inbox/:id/archive` | manage                                                    |
| `POST /inbox/read-all`    | manage, bounded set, idempotency                          |

Inbox bodies are sanitized and classification-filtered. Read receipts do not assert external-channel delivery.

## Operations

`GET /operations/summary`, `/deliveries`, `/dead-letters`, `/operations/providers`, `/operations/rate-limits`, and `/operations/webhooks` require `notification:operations:read` and return authorized aggregates/redacted rows. The canonical high-volume paths are `GET /v1/notifications/deliveries` and `GET /v1/notifications/dead-letters`; both use the mandatory `(created_at,id)` keyset contract.

`POST /dead-letters/:deliveryId/replay-preview` and `/replay` require `notification:operations:replay`; replay additionally requires expected version, reason, idempotency, and MFA/recent auth where policy says. Replay selects the source request established by preview. Success returns the new request plus `parentRequestId`, `rootRequestId`, `replayDepth`, new correlation ID, and replay command ID. The server sets ancestry from locked same-tenant rows; clients cannot choose an unrelated parent. Tenant operations cannot inspect another tenant or provider-global secrets.

Metrics include queue depth/oldest age, scheduled/due, leased/sending age, delivered/accepted/suppressed/failure rates, retry/dead-letter counts, provider/failover/rate-limit health, callback lag, inbox unread count, and recipient-resolution failures with bounded labels.

## Webhook receiver boundary

Provider delivery-status callbacks use `/internal/notifications/providers/:providerKey/callback`; they are not tenant-user APIs. Raw-body signature verification, provider/endpoint ownership, timestamp/nonce replay checks, size limits, callback dedupe, and generic responses precede state mutation. Customer webhook deliveries are outbound only; ownership verification callbacks use a separate one-time challenge route.

## Status codes

200 read/replay; 201 draft/config resource; 202 accepted async request; 204 preference/inbox mutation where appropriate; 400 malformed; 401 unauthenticated; 403 known forbidden action; 404 absent/out of scope; 409 version/state/idempotency conflict; 422 invalid template/policy/selector; 429 bounded operational control; 503 required route/secret/platform dependency unavailable.
