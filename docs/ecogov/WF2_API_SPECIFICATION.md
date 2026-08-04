# WF-2 API Specification

Status: Proposed for independent review

## Conventions

Canonical base is `/v1/notifications`. JSON over HTTPS; authenticated tenant context; UUID IDs; UTC timestamps; cursor pagination; `Idempotency-Key` on commands; `If-Match`/`expectedVersion` on mutable resources; correlation IDs; generic `404` for tenant/org scope failures. Errors are `{code,message,correlationId,fieldErrors?}` and contain no destination, body, provider response, secret, or foreign-resource evidence.

## Template administration

| Method/path                             | Permission                        | Result                                                    |
| --------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `GET /templates`                        | `notification:template:read`      | Tenant-visible bindings/catalog metadata                  |
| `POST /templates`                       | `notification:template:create`    | Tenant-owned draft template                               |
| `GET /templates/:id`                    | read                              | Scoped metadata and versions                              |
| `PATCH /templates/:id`                  | `notification:template:update`    | Mutable metadata with expected version                    |
| `POST /templates/:id/versions`          | update                            | New/clone draft                                           |
| `PUT /template-versions/:id`            | update                            | Replace draft schema/renderings                           |
| `POST /template-versions/:id/validate`  | `notification:template:validate`  | Deterministic bounded report/hash                         |
| `POST /template-versions/:id/publish`   | `notification:template:publish`   | Publish immutable version                                 |
| `POST /template-versions/:id/deprecate` | `notification:template:deprecate` | Stop new binding/use                                      |
| `PUT /template-bindings/:semanticKey`   | publish                           | Atomic active/default binding rotation                    |
| `GET /template-versions/:id/preview`    | read                              | Redacted fixture preview; no real recipient/provider send |

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

`GET /operations/summary`, `/deliveries`, `/dead-letters`, `/providers`, `/rate-limits`, and `/webhooks` require `notification:operations:read` and return authorized aggregates/redacted rows. `POST /dead-letters/:deliveryId/replay-preview` and `/replay` require `notification:operations:replay`; replay additionally requires expected version, reason, idempotency, and MFA/recent auth where policy says. Tenant operations cannot inspect another tenant or provider-global secrets.

Metrics include queue depth/oldest age, scheduled/due, leased/sending age, delivered/accepted/suppressed/failure rates, retry/dead-letter counts, provider/failover/rate-limit health, callback lag, inbox unread count, and recipient-resolution failures with bounded labels.

## Webhook receiver boundary

Provider delivery-status callbacks use `/internal/notifications/providers/:providerKey/callback`; they are not tenant-user APIs. Raw-body signature verification, provider/endpoint ownership, timestamp/nonce replay checks, size limits, callback dedupe, and generic responses precede state mutation. Customer webhook deliveries are outbound only; ownership verification callbacks use a separate one-time challenge route.

## Status codes

200 read/replay; 201 draft/config resource; 202 accepted async request; 204 preference/inbox mutation where appropriate; 400 malformed; 401 unauthenticated; 403 known forbidden action; 404 absent/out of scope; 409 version/state/idempotency conflict; 422 invalid template/policy/selector; 429 bounded operational control; 503 required route/secret/platform dependency unavailable.
