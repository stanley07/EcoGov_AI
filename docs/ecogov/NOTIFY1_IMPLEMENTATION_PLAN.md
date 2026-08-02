# NOTIFY-1 Secure Development Notification Delivery Adapter

Status: implemented for independent review

## Objective and scope

Provide an explicitly selected development notification provider that delivers encrypted invitation notifications into a protected local mailbox, plus a development-only platform-authorized viewer. Production notification behavior, invitation security, bootstrap token handling, database schema, SMTP, SendGrid, and SES remain out of scope.

## Current architecture

1. Bootstrap creates a SHA-256 invitation token hash, an encrypted AES-GCM task payload, and a pending `govos.notification.invitation.send` task.
2. The task dispatcher invokes `SendInvitationExecutor` with only the task identifier.
3. The worker reads `task_execution.encrypted_payload` and decrypts it inside the worker with `ENCRYPTION_KEY`.
4. Previously the executor validated the invitation and stopped after masked console messages; no provider delivered it.
5. Providers plug in immediately after worker-side decryption. The existing non-development path remains unchanged.

## Implementation design

- `GOVOS_NOTIFICATION_PROVIDER=development` is the only selection mechanism. No default enables it.
- `DevelopmentMailbox` writes one JSON document per task beneath `DEV_MAILBOX_PATH` or `runtime/dev-mailbox`.
- Directory/file permissions are requested as `0700`/`0600`; Windows applies the closest filesystem-supported behavior.
- Recipient, subject, safe body, status, tenant, type, and timestamps are readable metadata. Invitation details are re-encrypted with AES-256-GCM and never stored in plaintext.
- Duplicate worker delivery for the same task is idempotent and returns the existing record.
- The API viewer exists only when `NODE_ENV=development` and `DEV_MAILBOX_ENABLED=true`; all other configurations return 404.
- Viewer operations require verified MFA and `platform.audit.read` through existing platform authorization.
- List/view omit the protected envelope. `POST /internal/dev-mailbox/:id/open` decrypts only in memory for the authorized developer and does not log, cache, or rewrite plaintext.

## API operations

- `GET /internal/dev-mailbox`
- `GET /internal/dev-mailbox/:id`
- `POST /internal/dev-mailbox/:id/open`
- `POST /internal/dev-mailbox/:id/delivered`
- `DELETE /internal/dev-mailbox/:id`

## Testing strategy and acceptance criteria

Focused tests cover explicit enablement, disabled behavior, production 404, protected storage, safe retrieval, authorized lifecycle operations, log secrecy, idempotent worker retries, and compatibility with guarded bootstrap tests. Acceptance requires focused and full regression success, affected TypeScript/build success, no plaintext secrets in mailbox/log/audit output, and clean tenant invariants.

## Known operational boundary

This adapter is local development infrastructure, not email delivery. A developer must authenticate to the protected endpoint and deliberately open the invitation. Production provider delivery remains unchanged and no external provider is introduced.
