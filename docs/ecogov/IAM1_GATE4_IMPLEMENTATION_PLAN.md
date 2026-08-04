# IAM-1 Gate 4 Implementation Plan

Status: Implemented for independent review

## Objective and scope

Deliver tenant-context authentication and tenant account security: password changes and forced reset, TOTP enrollment/challenge, one-time recovery codes, self/admin session controls, tenant-scoped security detail/audit APIs, and self/admin web views. Platform administration, SSO, passkeys, Gate 5, and unrelated modules remain out of scope.

## Architecture and data

- Enforce accepted ADR-002 `{tenantSlug,email,password}` login with no email-only fallback.
- Resolve active non-system tenant, active account, active same-tenant membership, and same-tenant role before password verification.
- Add migration 000029 only for actively used reset markers, password history, purpose-separated bounded authentication challenges, session role/display metadata, and audit indexing.
- Reuse Argon2id, AES-256-GCM, HMAC recovery-code hashing, session invalidation, tenant RBAC, and `authz_audit_log`.
- Reject platform principals, self-targeted admin actions, and every cross-tenant target.

## API and UI

Phase 0 changes `/auth/login` and adds MFA/password-reset completion. Later phases add `/auth/password/change`, MFA enrollment/recovery, `/auth/sessions*`, `/users/:userId/security*`, `#/account/security`, and `#/administration/users/:userId/security`.

## Testing and acceptance

Focused contracts cover tenant-context resolution, generic errors, tenant-bound sessions, MFA challenge, secret storage, password/session policy, granular authorization, platform isolation, and secret-free UI state. Acceptance additionally requires migration apply/no-op, full sequential Vitest, all workspace TypeScript checks, affected production builds, secret/generated-file scans, and final database invariants.
