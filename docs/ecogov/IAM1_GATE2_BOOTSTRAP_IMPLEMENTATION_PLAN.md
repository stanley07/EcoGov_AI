# IAM-1 Gate 2 Bootstrap Implementation Plan

Status: **BLOCKED at Phase 1 — malformed tenant-local super_admin authorization catalog**

Date: 2026-08-02

## Objective

Provision the first EcoGov tenant administrator through a guarded, invitation-only CLI, harden single-use invitation acceptance, implement tenant-context login, and expose authoritative session claims without creating platform authority or a shared/default password.

## Approved boundaries

In scope after prerequisites pass:

- Migration-28-compatible bootstrap/repair membership handling.
- A guarded `bootstrap:tenant-admin` CLI using exact tenant slug and owner-supplied identity metadata.
- One invited tenant user, one invited current tenant-local `super_admin` membership, one pending invitation, one encrypted notification task, and one redacted audit event.
- Single-use invitation acceptance, tenant-context login, authoritative `GET /auth/session`, focused tests, and evidence.

Out of scope:

- Full Users & Access UI or general tenant-user APIs.
- Role-management, suspension/reactivation, MFA-reset, or session-revocation UI.
- Custom roles, global email uniqueness, platform administration, merge, tag, or release.
- Manual user/membership/invitation provisioning or shared/default passwords.

## Phase 1 gate result

The exact configured operational tenant resolves uniquely and is otherwise eligible:

- ID: `00000000-0000-0000-0000-000000000001`
- Slug: `anambra-state-ministry-of-environment`
- Name: Anambra State Ministry of Environment
- Status: active
- System-reserved: no
- Highest migration: 28
- Users/memberships/sessions: 0/0/0
- Tenant-local `super_admin` role ID: `00000000-0000-0000-0000-000000000501`
- Role description: Full system management access

The authorization prerequisite fails. The role has zero permission mappings. All 19 approved canonical tenant permissions are absent for this tenant and therefore unmapped:

- `audit:read`
- `complaint:contact:read`
- `complaint:review`
- `facility:read`
- `facility:register`
- `facility:review`
- `facility:write`
- `org:read`
- `org:write`
- `user:invite`
- `user:mfa:reset`
- `user:read`
- `user:role:assign`
- `user:session:revoke`
- `user:status:write`
- `user:write`
- `workbench:queue:read`
- `workflow:read`
- `workflow:write`

The tenant contains only `marketplace.payment.verify`; it is not mapped to the canonical role. The canonical role has no platform permission.

The directive requires aborting before mutation when the tenant-local role is missing or malformed. Accordingly, Phases 2–8 were not started.

## Planned implementation after unblocking

1. Obtain a separately reviewed disposition for the missing tenant permission catalog and exact canonical role mappings.
2. Re-run Phase 1 and require exact 19-permission parity with no platform permissions.
3. Update repair-bootstrap membership resolution to tenant-safe `SELECT ... FOR UPDATE`, explicitly distinguish current versus revoked memberships, insert status/version explicitly, and remove dependency on the dropped legacy unique constraint.
4. Implement the guarded CLI with the required enable flag and metadata-only environment contract.
5. Encrypt the single-use raw token only inside the notification payload, persist only its SHA-256 hash, and prove the raw token never reaches output/log/audit evidence.
6. Verify notification delivery can securely reach the nominated owner. Stop if the local adapter cannot deliver without exposing the token.
7. Harden invitation acceptance to bind invitation, tenant, user, membership, role, and scope under locks; activate only intended rows; leave MFA unenrolled; mint no session.
8. Implement `{ tenantSlug, email, password }` login with tenant-safe active-membership resolution and generic failures.
9. Implement authoritative `GET /auth/session` with current tenant/user/membership/permission re-resolution and secret-free claims.
10. Run focused, end-to-end, full regression, TypeScript, and build gates before evidence/commit.

## Bootstrap command contract

Required variable names only; values and secrets must never be recorded:

- `ALLOW_TENANT_ADMIN_BOOTSTRAP=true`
- `BOOTSTRAP_TENANT_SLUG`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_FIRST_NAME`
- `BOOTSTRAP_ADMIN_LAST_NAME`

Optional:

- `BOOTSTRAP_ADMIN_PHONE`
- `BOOTSTRAP_CORRELATION_ID`

The CLI accepts no plaintext password, tenant ID, arbitrary role, permission list, or platform authority.

## Acceptance criteria

Implementation may resume only when Phase 1 reports exact canonical permission parity. Completion then requires one invited identity/membership/invitation/notification, idempotent no-op reruns, secure one-time acceptance, tenant-context login, one authoritative session, zero platform authority, unchanged tenant-integrity counts, all tests/builds passing, and a clean tree.

## Review decision required

Antigravity/owner must approve how the missing 19 tenant permissions and their canonical `super_admin` mappings are seeded. The implementation must not infer authorization from the role name or silently copy a template/default tenant role catalog.
