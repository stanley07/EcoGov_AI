# Implementation Plan: IAM-1 — Tenant User & Access Management

Status: Revision required before implementation authorization; revised for Antigravity review

Revision reason: Antigravity requested an explicit tenant-identity ADR, separate account/invitation lifecycles, centralized role and IAM service policies, a delegation matrix, conditional migration decisions, and stronger Gate 0 blockers. No implementation is authorized by this revision.

Owner: Codex implementation agent

Reviewer: Antigravity architecture review agent

## 1. Objective

Deliver production-grade, tenant-scoped user administration while preserving GovOS authentication and authorization architecture. IAM-1 will remove production-facing Quick Access credentials, add a permission-gated **Users & Access** workspace, let authorized tenant administrators invite and administer users, and reuse the existing RBAC, invitation, MFA, session, audit, and platform-administration foundations.

The milestone must prevent role escalation, cross-tenant access, stale-session use, and accidental convergence of tenant administration with the platform control plane.

## 2. Repository audit and current-state findings

### 2.1 Quick Access

- `apps/web/src/LandingPage.tsx` renders a production-facing **Quick Access Stubs** block in the Login modal.
- The Owner, Inspector, and Director buttons populate known emails and the literal password `password123` through the `quickLogin` callback supplied by `apps/web/src/main.tsx`.
- Landing-page facility-registration guidance explicitly tells visitors to use those stubs.
- IAM-1 must remove the helper, its callback contract, all buttons, the credential-setting code, and the guidance. Test/demo fixtures may remain in test-only code, but no production bundle or visible production UI may contain shared credentials.

### 2.2 User accounts and tenant identity

- `user_account` is tenant-owned and contains `id`, `tenant_id`, tenant-unique `email`, Argon2 password hash, name fields, `status`, timestamps, and soft-delete metadata.
- The checked constraint permits `active`, `invited`, and `suspended`.
- Email uniqueness is tenant-local, so the same person may have separate tenant identities. IAM-1 will preserve this model and will not introduce a global identity directory.
- Login currently searches by email without a tenant selector or tenant predicate. If the same email exists in multiple tenants, the result is ambiguous; login also does not reject `invited` or `suspended` before creating a session. This is a security prerequisite for IAM-1 and must be corrected within authentication hardening scope.

### 2.3 Tenant membership model

- `membership` links a tenant user to optional organization/department scope and one tenant role.
- The base schema does not contain a membership lifecycle status or optimistic version, yet tenant provisioning and invitation acceptance currently write `membership.status`. This is checked-in schema/runtime drift and requires a deployed-schema preflight.
- `user_account`, `organization`, and `role` expose composite tenant keys, but the original membership foreign keys reference entity IDs independently rather than enforcing `(tenant_id, id)` relationships. Application queries also join memberships by user ID without consistently repeating tenant predicates.
- The existing uniqueness rule `(user_id, organization_id, role_id)` permits duplicate tenant-wide assignments when `organization_id` is `NULL` under PostgreSQL NULL semantics.
- IAM-1 must treat membership rows as the tenant role assignments. It must not use `platform_role_assignment` for tenant roles.

### 2.4 Roles and permissions

- Tenant permissions and role inheritance are defined in `modules/govos-core/src/rbac.ts` through `ROLE_PERMISSIONS`, `ROLE_INHERITANCE`, `resolveRolePermissions`, and `hasPermission`.
- Existing role names include `super_admin`, `organization_admin`, `commissioner`, `director`, `inspector`, `environmental_consultant`, `finance_officer`, `facility_owner`, and `citizen` in the runtime map.
- Bootstrap/provisioning seed catalogs are narrower and inconsistent: they omit `environmental_consultant` and `finance_officer`, and the persisted `permission`/`role_permission` rows do not fully match the hard-coded runtime map.
- The current API session middleware loads role names from memberships; route-level authorization then evaluates the hard-coded map. Persisted `role_permission` rows are not the runtime authority.
- Frontend permission claims are independently reconstructed from roles in `apps/web/src/main.tsx`, creating drift risk. Browser checks are visibility/UX only and are not authoritative.
- The word `subcontractor` is a business label, not a current canonical tenant role. IAM-1 will expose it as **Environmental Consultant / Subcontractor** while sending canonical role name `environmental_consultant` to the API.

### 2.5 Invitations

- `user_invitation` already stores tenant, normalized/display email, invitation type, optional role, SHA-256 token hash, lifecycle status, expiry, creator/acceptor, and timestamps.
- A partial unique index allows only one pending invitation per tenant/email/type.
- `/auth/invitations/accept` locks the invitation, checks status/expiry/tenant status, activates the account and tenant membership, supersedes competing invitations, and writes `INVITATION_ACCEPTED` to `authz_audit_log`.
- Tenant provisioning already creates a tenant-admin invitation and queues an encrypted `govos.notification.invitation.send` task. IAM-1 should extract/reuse the same token generation, hashed storage, encrypted outbox delivery, acceptance, expiry, revocation, and supersession patterns rather than returning raw invitation tokens from an administration API.
- Acceptance currently updates memberships broadly for the user and assumes a `status` column. It must instead activate only the membership identified by the invitation role/scope and tenant.

### 2.6 Platform administration

- Platform access uses `platform_role_assignment`, `PlatformPermission`, `hasPlatformPermission`, a reserved system tenant, and an MFA gate.
- Platform roles are restricted to `PLATFORM_SUPER_ADMIN`, `PLATFORM_SUPPORT_ADMIN`, and `PLATFORM_AUDITOR`.
- Existing `#/platform` routes and `/platform-admin/*` APIs are platform-control-plane features. IAM-1 must neither display nor mutate platform role assignments and must never allow a tenant administrator to target the system tenant.
- **Users & Access** must be a tenant route and API namespace, guarded by tenant permissions, not nested under or implemented through Platform Admin.

### 2.7 Sessions and frontend claims

- `session` stores opaque bearer tokens, tenant/user IDs, expiry, and `session_version`.
- The implemented version check compares a session snapshot to `tenant.session_version`; it supports tenant-wide invalidation on suspension but not individual user version invalidation.
- Per-user revocation can safely reuse the session architecture by deleting that user's tenant-scoped session rows in the same transaction as a sensitive account change. A new user session-version column is not required for IAM-1.
- The frontend stores the opaque token and login response user object in local storage. Current claims include user/tenant identity, names, and role names; they do not include server-resolved tenant permissions, account status, membership IDs/scopes, or MFA state.
- IAM-1 should add an authenticated session/profile endpoint returning authoritative current display claims and effective permission names. The browser may use those claims to hide controls, while every API mutation re-authorizes from current database state.

### 2.8 MFA

- Structured MFA fields exist on `user_account`: enrollment status, encrypted secret, hashed recovery codes, enrollment/verification timestamps, and recovery-code generation time.
- Legacy plaintext MFA columns were explicitly removed.
- Existing platform administration requires verified MFA. No tenant-admin MFA gate or tenant-user MFA reset API exists.
- IAM-1 MFA reset must clear only structured credential fields, set the user to `unenrolled`, revoke all target-user sessions, and write an audit event. It must never return, decrypt, log, or copy MFA secrets/recovery codes.

### 2.9 Authorization audit

- `authz_audit_log` is the existing append-only authorization trail with tenant, actor, action, resource, allow/deny result, JSON context, and timestamp.
- Existing routes write selected allow events, but there is no centralized tenant IAM audit helper or complete denied-attempt coverage.
- IAM-1 must write both allowed mutations and denied privileged attempts, without passwords, invitation tokens, MFA material, bearer tokens, or unnecessary personal data.

### 2.10 Existing routes and UI

- No tenant user-management API or frontend page currently exists.
- The Administration navigation currently contains Platform Console and Org Settings only.
- `#/settings` is authenticated but is not a user-management implementation.
- IAM-1 should add one canonical `#/administration/users` route to the existing hash registry, with a tenant permission boundary, and one Administration navigation item. It must not add a second router or alter unrelated routes.

## 3. Architecture decisions required

### 3.1 ADR-002 — tenant identity resolution

IAM-1 implementation is blocked until Antigravity approves draft `docs/ecogov/adr/ADR-002-tenant-identity-resolution.md`. The decision must select one strategy:

- **A. Tenant-context login:** tenant slug or tenant-bound login context plus email. This preserves tenant-local identity uniqueness and is the recommended option because it matches the current data model.
- **B. Global email uniqueness:** one email across all tenants. This requires an explicit migration, duplicate-conflict resolution, account compatibility analysis, and owner-approved operational rollout.

IAM-1 must not silently choose either strategy. No authentication implementation may proceed while duplicate tenant-local emails can resolve ambiguously.

### 3.2 Other approval blockers

Antigravity must also approve the delegation matrix, canonical role/permission catalog, organization-scope semantics, tenant `super_admin` self-sensitive action policy, and deployed-schema preflight evidence before Gate 1 begins.

## 4. Account lifecycle model

Account and invitation lifecycles are separate state machines.

The IAM-1 account lifecycle is:

```text
active --suspend--> suspended --reactivate--> active
```

- `active` means eligible to authenticate when tenant, membership, and authentication controls also pass.
- `suspended` means authentication and existing sessions are denied; memberships and audit history are retained.
- `disabled` or `archived` is not introduced unless separately approved and supported by schema.

The existing schema also uses `user_account.status='invited'`. This is a compatibility state representing a not-yet-activated account placeholder, not an invitation lifecycle state. IAM-1 will initially continue reading it and may create it only through the existing compatible invitation path. Acceptance changes the intended account from `invited` to `active`; suspension remains distinct and cannot be cleared by accepting/resending an invitation.

A staged transition may later replace `invited` account status with an explicit activation/readiness field, but only through an approved migration and compatibility period. Existing invited users remain linked to their pending invitation and intended membership, can accept once, and otherwise become expired/revoked invitation holders without automatically becoming active. No existing invited row is silently deleted or reclassified during migration.

## 5. Invitation lifecycle model

The invitation state machine remains the existing schema contract:

```text
pending --> accepted
pending --> expired
pending --> revoked
pending --> superseded
```

- Only `pending` and unexpired invitations may be accepted.
- `accepted`, `expired`, `revoked`, and `superseded` are terminal for that token.
- Resend supersedes the prior pending invitation and creates a new single-use token record.
- Invitation state never substitutes for `user_account.status`; a suspended user stays suspended even if an invitation exists.
- Acceptance under a row lock binds and activates exactly the invitation's tenant account and intended membership/role/scope. It does not broadly activate all memberships and does not mint a session.

Backward compatibility preserves existing invitation statuses, token hashing, invitation types, acceptance route, and `invited` account placeholder behavior during the staged transition. Migration is required only for gaps proven by preflight.

## 6. Role catalog and assignability policy

IAM-1 will add one centralized `TenantRoleCatalog` or `AssignableRolePolicy` within the existing appropriate GovOS core/module boundary. Final module/class naming requires a repository audit before implementation to avoid duplicating an equivalent abstraction.

Responsibilities:

- Return canonical tenant roles, descriptions, and resolved permissions.
- Map UI label **Environmental Consultant / Subcontractor** only to canonical `environmental_consultant`.
- Return the explicit IAM-1 assignable set: `director`, `inspector`, `environmental_consultant`, `finance_officer`, and `citizen`.
- Keep `super_admin`, `organization_admin`, `facility_owner`, unknown database roles, and every `PLATFORM_*` role non-assignable through IAM-1.
- Enforce organization scope and actor delegation ceiling.
- Reconcile persisted role-permission data, runtime role mappings, provisioning/bootstrap seeds, and frontend claims through one authoritative catalog.

Database presence does not imply assignability. Routes must not scatter role literals or accept arbitrary role IDs, role names, or permissions from the browser.

## 7. Delegation matrix

| Actor                                                                                               | May manage                                                    | May assign                                                   | Prohibited                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant `super_admin`                                                                                | Tenant users subject to protected-principal/self-action rules | Approved non-administrative business roles                   | System tenant; platform roles; last-active-admin removal/suspension; `organization_admin` assignment until Antigravity explicitly approves it |
| `organization_admin`                                                                                | Users in the actor's assigned organization scope only         | Approved non-administrative business roles within that scope | `super_admin`; `organization_admin`; platform roles; equal/higher admins; out-of-scope users                                                  |
| `director`, `inspector`, `environmental_consultant`, `finance_officer`, `facility_owner`, `citizen` | None by default                                               | None                                                         | All tenant IAM administration                                                                                                                 |

Self-promotion, self-suspension, and self-MFA reset are denied. Self session revocation/logout may use a separate non-admin capability. The default answer to “may tenant `super_admin` assign `organization_admin`?” is **no** until Antigravity approves a controlled policy.

## 8. Service boundaries

Route handlers remain thin: validate transport shape, invoke a domain service, and translate typed outcomes. Before final names are chosen, implementation must audit existing services/helpers and extend them where equivalent behavior exists.

- `TenantIamAuthorizationService`: resolve current actor permissions; validate tenant/organization scope; enforce delegation ceiling and protected administrative principals; prevent last-admin races; reject system-tenant/platform-role operations.
- `TenantInvitationService`: create/resend/revoke; bind tenant, account, membership, role, and scope; reuse hashing, encrypted outbox, idempotency, expiry, acceptance, and supersession.
- `TenantMembershipService`: assign/remove roles; enforce optimistic concurrency and explicit catalog policy; prevent duplicates; preserve organization scope; revoke target sessions after access changes.
- `TenantAccountSecurityService`: suspend/reactivate, revoke sessions, reset MFA, preserve history, and return no secret material.
- `TenantIamAuditService` or typed extension of the existing writer: write allowed mutations transactionally, record denied privileged attempts safely, redact secrets/PII, and attach correlation/idempotency identifiers.

These IAM services should be reusable by EcoGov and future GovOS applications but remain in existing GovOS core/module boundaries during IAM-1. A new identity package is not authorized.

## 9. Exact scope

1. Remove production Quick Access credentials and associated guidance from the landing/login experience.
2. Introduce canonical tenant IAM permissions and server-side checks.
3. Add tenant-scoped list/detail APIs for users, memberships, roles, invitations, and effective permissions.
4. Add idempotent tenant-user invitation, resend, and revoke operations using the existing invitation/outbox architecture.
5. Add approved-role assignment and removal with anti-escalation controls.
6. Add account suspension/reactivation, individual session revocation, and MFA reset operations.
7. Add the permission-gated `#/administration/users` **Users & Access** page and responsive/accessibility-compliant dialogs.
8. Make current session/profile claims server-resolved and suitable for UI visibility decisions.
9. Add complete audit events and focused security/regression tests.
10. Add only the minimum schema migration proven necessary by preflight.

## 10. Out of scope

- Platform tenant provisioning or any Platform Admin UI/API redesign.
- Creation, assignment, revocation, or display of platform roles.
- Custom role creation, arbitrary permission editing, or role hierarchy editing.
- Global identities, cross-tenant account linking, SSO, SCIM, OAuth, passwordless login, or external directory sync.
- Implementing MFA enrollment/challenge UX; IAM-1 includes administrative reset only.
- Password reset/recovery beyond existing invitation activation.
- Bulk imports, CSV export, organization/department management, or fine-grained territory assignment.
- Deleting user accounts or audit records.
- Database, marketplace, payment, licensing, facility, dashboard, or EMIS workflow changes unrelated to IAM.

## 11. Permission model

Add canonical tenant permissions to the existing GovOS tenant RBAC vocabulary:

| Permission            | Capability                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `user:read`           | List/view tenant users, roles, invitations, membership scope, status, and non-secret MFA state |
| `user:invite`         | Invite, resend, and revoke tenant-user invitations                                             |
| `user:role:assign`    | Assign/remove approved tenant roles within the actor's delegation ceiling                      |
| `user:status:write`   | Suspend or reactivate tenant users                                                             |
| `user:session:revoke` | Revoke a target user's sessions                                                                |
| `user:mfa:reset`      | Reset a target user's MFA enrollment and revoke sessions                                       |

`user:write` remains a compatibility umbrella only during migration. Server authorization must translate it explicitly to the approved IAM actions until callers migrate; it must not be inferred by string matching. The long-term source of truth remains the shared tenant RBAC module used by APIs and frontend claim presentation.

Initial grants:

- `super_admin`: all IAM permissions, subject to protected-last-admin and self-action rules.
- `organization_admin`: `user:read`, `user:invite`, and role/status/session operations only inside assigned organization scope; no grant of `super_admin` or `organization_admin` unless an explicit future delegation policy is approved.
- Other roles, including director, inspector, environmental consultant/subcontractor, finance officer, facility owner, and citizen: no IAM administration permissions by default.

The assignable business-role allowlist for IAM-1 is `director`, `inspector`, `environmental_consultant`, `finance_officer`, and `citizen`. `super_admin`, `organization_admin`, all `PLATFORM_*` roles, unknown roles, client-supplied permission sets, and arbitrary role IDs outside the actor tenant are rejected. Tenant `super_admin` creation/delegation remains a separately controlled bootstrap/platform-provisioning responsibility.

API authorization must resolve actor roles and permissions from current active tenant memberships on every request. Frontend claims only control visibility and never authorize a mutation.

## 12. Database preflight and migration decision table

### 6.1 Mandatory preflight

Before implementation, inspect `information_schema`, constraints, and indexes in a clean migrated database and the target deployment database. Specifically verify whether `membership.status` exists outside checked-in migrations and whether any cross-tenant or duplicate-null-scope membership rows exist.

### 6.2 Migration decision

A migration is genuinely required if the checked-in schema is authoritative, because runtime code already relies on membership lifecycle state and current foreign keys do not enforce membership tenant consistency. The proposed migration must be assigned the next available number at implementation time; this plan does not reserve a number or create a migration.

The migration should:

- Add `membership.status VARCHAR(50) NOT NULL DEFAULT 'active'` with allowed values `invited`, `active`, and `revoked` if absent.
- Backfill existing rows to `active`; backfill rows tied only to pending invitations to `invited` where the association is unambiguous.
- Add `membership.version INTEGER NOT NULL DEFAULT 1` for optimistic concurrency on role assignment/removal.
- Add/verify composite foreign keys from membership `(tenant_id, user_id)`, `(tenant_id, role_id)`, and, where non-null, `(tenant_id, organization_id)` and `(tenant_id, department_id)` after preflight cleanup.
- Add the required composite unique keys to referenced organization/department tables if absent.
- Replace NULL-unsafe membership uniqueness with partial unique indexes for tenant-wide and organization-scoped active/current assignments.
- Ensure every approved assignable role and every IAM permission exists for each active non-system tenant, and seed deterministic role-permission mappings without changing platform roles.
- Add indexes for tenant user lists, active membership lookup, pending invitation lookup, and session deletion by `(tenant_id, user_id)` if execution plans show they are absent.

Preflight decision table:

| Finding                                             | Required decision                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Gap confirmed in clean and deployed schema          | Create the next available narrowly scoped migration after approval                             |
| Column/constraint/index already exists consistently | Do not recreate it; document and test the existing contract                                    |
| Invalid legacy or cross-tenant data found           | Abort implementation and produce a remediation report; do not auto-correct ownership           |
| Duplicate NULL-scope assignments found              | Abort automatic constraint application; obtain an approved deduplication decision              |
| Composite constraint cannot be validated safely     | Stop implementation and escalate to Antigravity/owner                                          |
| Target schema differs from migration history        | Stop, record drift, and approve reconciliation before feature work                             |
| Next migration number conflicts                     | Re-audit repository history and select the next free number; never overwrite/reuse a migration |

No `user_account.session_version` is proposed. Individual revocation uses transactional deletion of existing session rows; tenant-wide invalidation continues using `tenant.session_version`.

### 6.3 Migration safety and rollback

- Preflight must abort on cross-tenant memberships, ambiguous duplicates, missing referenced entities, or incompatible status values; it must not silently rewrite security ownership.
- Apply constraints as `NOT VALID` where appropriate, validate after data checks, then make them authoritative.
- Migration is additive before cleanup; application deployment must tolerate old/new membership columns during the staged rollout.
- Rollback may remove new indexes/constraints/columns only before IAM writes use them. After IAM-1 activation, rollback is application-first and must preserve membership/audit data; destructive rollback is prohibited.
- Verify forward migration, rollback on an empty/test database, re-apply, bootstrap/repair compatibility, and restart recovery.

## 13. API contracts

All endpoints are authenticated, tenant-derived from `req.user.tenantId`, and must reject any body/query tenant ID. UUID parameters identify resources only after a tenant predicate is applied. Responses omit password hashes, invitation token hashes, MFA secrets/recovery codes, and session tokens.

### 7.1 Session claims

`GET /auth/session`

Response `200`:

```json
{
  "user": {
    "id": "uuid",
    "tenantId": "uuid",
    "email": "user@example.gov.ng",
    "firstName": "Ada",
    "lastName": "Okafor",
    "status": "active",
    "roles": ["organization_admin"],
    "permissions": ["user:read", "user:invite"],
    "mfaEnrollmentStatus": "verified"
  }
}
```

The endpoint re-resolves active memberships and permissions. Inactive accounts or stale sessions receive `401`/`403` consistently with middleware.

### 7.2 Read APIs

- `GET /tenant-admin/users?search=&status=&role=&organizationId=&limit=&cursor=` requires `user:read`; returns cursor-paginated tenant users with active/invited roles, scope, invitation summary, non-secret MFA state, and last session timestamp where allowed.
- `GET /tenant-admin/users/:userId` requires `user:read`; returns one tenant user and memberships.
- `GET /tenant-admin/roles` requires `user:read`; returns only the approved assignable role catalog, display labels, descriptions, and effective permissions.
- `GET /tenant-admin/invitations?status=&limit=&cursor=` requires `user:read`; returns tenant-local invitation metadata without any token.

### 7.3 Invitation APIs

`POST /tenant-admin/invitations` requires `user:invite` and `Idempotency-Key`.

```json
{
  "email": "new.user@example.gov.ng",
  "firstName": "New",
  "lastName": "User",
  "role": "inspector",
  "organizationId": "uuid-or-null"
}
```

Returns `202` with invitation ID/status/expiry and notification task ID. It never returns the raw token. The transaction normalizes email, validates scope and role, locks competing identity/invitation rows, creates or reuses an invited tenant identity, creates the invited membership, stores only the token hash, queues the encrypted notification, completes the idempotency record, and writes an audit event.

- Same key/same payload returns the prior result.
- Same key/different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- Duplicate pending tenant/email/type/scope returns the existing pending invitation or a deterministic `409`, as finalized during implementation; it never creates multiple active memberships.
- An already-active tenant user is not re-invited; administrators use role assignment instead.

`POST /tenant-admin/invitations/:invitationId/resend` requires `user:invite`, `Idempotency-Key`, and optional expected version. It revokes/supersedes the old pending token, creates a new hashed token and expiry, and enqueues one notification.

`POST /tenant-admin/invitations/:invitationId/revoke` requires `user:invite` and `{ "reason": "..." }`; reason is mandatory, the pending invitation and invited membership are revoked transactionally, and a consumed/expired invite cannot be revived.

The existing public `POST /auth/invitations/accept` remains the acceptance endpoint but must be hardened to bind tenant, user, role, and membership exactly; consume once under row lock; reject inactive tenants; activate only the intended membership; and audit allow/deny outcomes.

### 7.4 Role assignment APIs

`POST /tenant-admin/users/:userId/roles` requires `user:role:assign`, `Idempotency-Key`, and:

```json
{
  "role": "finance_officer",
  "organizationId": "uuid-or-null",
  "expectedUserVersion": 3,
  "reason": "Assigned to revenue review"
}
```

`DELETE /tenant-admin/users/:userId/roles/:membershipId` requires the same permission, `If-Match` or expected membership version, and a mandatory reason body.

Both endpoints lock the target user and relevant memberships, enforce the approved allowlist/delegation ceiling and scope, prevent duplicate assignments, preserve at least one active tenant super administrator, reject self-escalation, update membership version, revoke target sessions after effective permissions change, and audit before/after role names and scope.

### 7.5 Account and security APIs

- `POST /tenant-admin/users/:userId/suspend` requires `user:status:write`, expected version, and mandatory reason. It sets `user_account.status='suspended'`, revokes all target sessions in the same transaction, preserves memberships/audit history, and prevents suspending the last active tenant super administrator.
- `POST /tenant-admin/users/:userId/reactivate` requires `user:status:write`, expected version, and mandatory reason. It reactivates only a valid tenant-local account; it creates no session and restores no revoked membership.
- `POST /tenant-admin/users/:userId/sessions/revoke` requires `user:session:revoke` and mandatory reason. It deletes all target sessions scoped by tenant/user and returns the count.
- `POST /tenant-admin/users/:userId/mfa/reset` requires `user:mfa:reset`, expected version, and mandatory reason. It clears encrypted MFA/recovery fields and related timestamps, sets status to `unenrolled`, revokes sessions, and returns no secret material.

Common errors: `400` validation, `401` missing/stale authentication, `403` denied/delegation/cross-tenant/system-tenant access, `404` tenant-scoped resource absent, `409` stale version/duplicate/idempotency conflict, and `422` protected-last-admin or invalid workflow transition.

## 14. Frontend design

### 8.1 Routing and navigation

- Add one existing-registry route: `#/administration/users`, access boundary `authenticated`, required permission `user:read`, and no Platform Admin flag.
- Add **Users & Access** beneath the tenant Administration group only when the resolved session claim contains `user:read` and the current tenant is not the reserved system tenant.
- Direct URL access without permission resolves to the existing Access Restricted page. Backend `403` remains authoritative.

### 8.2 Components

Proposed files/components:

- `tenant-admin/UsersAccessPage.tsx`: page orchestration, filters, pagination, refresh, and empty/error states.
- `tenant-admin/UserTable.tsx`: accessible sortable/list presentation of name, email, status, roles, scope, MFA state, and actions.
- `tenant-admin/InviteUserDialog.tsx`: email/name/approved-role/scope fields and idempotent submission.
- `tenant-admin/UserAccessDrawer.tsx`: tenant-local user detail, memberships, invitation history, and session/MFA status.
- `tenant-admin/RoleAssignmentDialog.tsx`: approved roles only, server-returned catalog, reason, and concurrency token.
- `tenant-admin/SecurityActionsDialog.tsx`: suspend/reactivate, revoke sessions, and MFA reset with explicit confirmation and reason.
- `tenant-admin/api/usersAccessApi.ts`: typed contracts, bearer handling, error normalization, and idempotency headers.

Reuse `AppShell`, `PageContainer`, `Breadcrumb`, `PermissionGate`, `LoadingBoundary`, `AccessDeniedPage`, and existing hash routing. Do not place tenant user management inside `PlatformAdminConsole`.

### 8.3 Accessibility and responsive behavior

- Semantic heading/table/list/dialog controls; labelled fields; live regions for async results; status conveyed by text, not color alone.
- Visible `:focus-visible`, minimum 44px targets, logical tab order, initial dialog focus, focus trap, Escape/cancel, and trigger-focus restoration.
- At 360px, table content becomes cards or uses an explicitly labelled contained scroller; the page itself must not overflow horizontally.
- Destructive/security actions require explicit confirmation and mandatory reason, with accessible error association.

## 15. Workflows

### 9.1 Invitation

1. Authorized administrator opens Users & Access and selects Invite user.
2. UI loads the server-approved role catalog; it never submits permissions.
3. API re-resolves actor permission, delegation ceiling, organization scope, and tenant status.
4. Transaction claims idempotency, normalizes email, locks duplicate invitation/user state, creates invited identity and membership, hashes a new single-use token, queues encrypted notification, and audits.
5. Invitee accepts through the existing public endpoint, supplies a compliant password, and the locked invitation activates exactly the intended account/membership once.
6. The invitee signs in normally; invitation acceptance itself does not mint a session.

### 9.2 Role assignment/removal

1. UI presents only server-returned assignable roles and allowed scopes.
2. API ignores no security-relevant client assumption: it resolves target and role by actor tenant and canonical name.
3. Transaction locks user/memberships, checks optimistic version and delegation rules, applies one membership change, records audit, and revokes target sessions.
4. Target must authenticate again to receive current role claims.

### 9.3 Suspension/reactivation

- Suspension is soft-state only: retain identity, memberships, invitations, and audit history; deny login and authenticated requests; delete active sessions atomically.
- Reactivation restores account login eligibility only. Revoked memberships remain revoked, expired/revoked invitations remain unusable, and no session is minted.

### 9.4 Session revocation

- Individual revocation deletes `session` rows with both target tenant and user predicates.
- Role/status/MFA security changes automatically revoke the target user's sessions.
- Tenant suspension continues incrementing `tenant.session_version`; IAM-1 does not replace that mechanism.

### 9.5 MFA reset

- Administrator confirms the target and supplies a reason.
- API verifies `user:mfa:reset`, tenant ownership, delegation/self-action policy, and target version.
- Transaction clears only structured MFA fields, marks enrollment `unenrolled`, deletes sessions, and audits metadata only.
- User must complete the existing/future enrollment flow before any MFA-gated capability. IAM-1 does not fake verification.

## 16. Audit/history model

Use append-only `authz_audit_log` actions:

- `TENANT_USER_INVITED`, `TENANT_USER_INVITATION_RESENT`, `TENANT_USER_INVITATION_REVOKED`, `INVITATION_ACCEPTED`
- `TENANT_USER_ROLE_ASSIGNED`, `TENANT_USER_ROLE_REMOVED`
- `TENANT_USER_SUSPENDED`, `TENANT_USER_REACTIVATED`
- `TENANT_USER_SESSIONS_REVOKED`, `TENANT_USER_MFA_RESET`
- `TENANT_IAM_ACCESS_DENIED` for denied privileged mutations

Each event includes actor tenant/user, target user/invitation/membership resource, result, reason where required, correlation/idempotency identifiers, safe before/after state, and scope. Never log password/password hash, raw or hashed bearer/invitation tokens, MFA ciphertext, recovery hashes/codes, or full request bodies.

Audit insertion must occur in the same database transaction as each successful state mutation. Denied attempts that perform no mutation may be recorded in a separate best-effort insert and must not turn a `403` into a `500` if audit storage is unavailable; operational logging must still carry the correlation ID.

No IAM timeline table is created. `authz_audit_log` is the authoritative IAM history source. Users & Access may render a tenant-filtered access-history view from these records; a future operational timeline may project them only under a separate approved milestone.

## 17. Security invariants

- Deny by default; canonical server allowlist only.
- Never accept permissions, platform roles, tenant IDs, `is_system`, account status, or role IDs as trusted authorization claims from the browser.
- Actor must possess the exact IAM permission from current active memberships, not merely a role name from the stored frontend session.
- Organization admins cannot grant `super_admin`/`organization_admin`, act outside their organization scope, or manage an equal/higher administrative principal.
- Tenant super administrators cannot create or assign `PLATFORM_*` roles or mutate `platform_role_assignment`.
- Prevent self-promotion, self-MFA reset, self-suspension, and removal/suspension of the last active tenant super administrator. Self session revocation/logout may be allowed through a separate non-admin endpoint.
- Use row locks, optimistic versions, idempotency keys, and deterministic uniqueness handling to prevent concurrent double invites/assignments and last-admin races.
- Revoke target sessions after role, status, or MFA changes; clear the RBAC permission cache after role catalog/mapping changes if such changes ever occur.
- Treat the reserved system tenant as out of scope for tenant IAM routes.

## 18. Tenant-isolation invariants

- Derive actor tenant only from the authenticated session; prohibit tenant selection in IAM requests.
- Every select/update/delete uses both `tenant_id = req.user.tenantId` and the resource ID, including session deletion and invitation acceptance joins.
- Validate role, organization, department, user, invitation, and membership belong to that tenant before mutation.
- Enforce equivalent composite constraints in PostgreSQL so application mistakes cannot create cross-tenant memberships.
- Return tenant-scoped `404` for foreign IDs where disclosure would leak existence; return `403` for explicit forbidden system-tenant/platform-role attempts.
- Never expose users, invitation counts, emails, or audit events from another tenant.
- Include cross-tenant negative tests for every read and mutation endpoint.

## 19. Authentication prerequisites

IAM-1 cannot safely launch until:

- Login resolves an identity unambiguously. Preferred contract: require tenant slug plus email, or use a prior tenant-discovery/tenant-bound login context. Do not silently select the first matching email across tenants.
- Login permits only `active` users and active tenants and does not create a session for invited/suspended accounts.
- Session middleware joins `session`, tenant, user, membership, and role with matching tenant predicates and only includes active memberships.
- The session/profile endpoint refreshes UI claims after login and on app bootstrap; a `401` clears local session storage.
- CORS allows `Idempotency-Key`, `If-Match`, and `X-Correlation-Id` where the chosen API contracts require them.

The exact tenant-login UX requires Antigravity approval because adding a tenant slug to login affects an existing public contract. If unique email across all tenants is instead selected, that requires an explicit architecture decision and a safe migration; it must not be assumed during implementation.

Classification:

| Prerequisite                                                       | Classification                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Unambiguous identity resolution                                    | Blocked by approved ADR-002; then implemented inside IAM-1                       |
| Active-user, active-tenant, and active-membership enforcement      | Inside IAM-1                                                                     |
| Tenant-safe authentication/session joins                           | Inside IAM-1                                                                     |
| Authoritative session/profile endpoint and stale-session rejection | Inside IAM-1                                                                     |
| Clear local storage on `401`                                       | Inside IAM-1 frontend integration                                                |
| CORS for `Idempotency-Key`, `If-Match`, `X-Correlation-Id`         | Inside IAM-1 API integration                                                     |
| SSO, SCIM, OAuth, global identity linking, MFA enrollment UX       | Separate follow-up; not required to implement IAM-1 after approved prerequisites |

## 20. Tests

### 14.1 Focused unit tests

- Canonical role catalog and alias display (`subcontractor` maps only to `environmental_consultant`).
- Account lifecycle transitions remain separate from invitation transitions; accepting/resending an invitation never unsuspends an account.
- Duplicate-email tenant identity ambiguity fails closed until/according to approved ADR-002.
- Explicit assignable catalog rejects administrative, platform, unknown, and browser-supplied roles/permissions.
- Every delegation-matrix row and self-sensitive action rule.
- IAM permission resolution/inheritance and compatibility handling for `user:write`.
- Delegation ceiling, equal/higher-admin protection, last-admin rule, system-tenant rejection, and organization scope.
- Invitation normalization, token hashing, expiry, state transitions, idempotency request hashing, and secret redaction.
- Session claims exclude secrets and contain current effective permissions.

### 14.2 API/integration tests

- Tenant admin with exact permission can list/invite/manage allowed users; unauthorized roles receive `403`.
- Quick Access credentials are absent from production source/rendered Login.
- Invited/suspended users cannot log in; ambiguous cross-tenant email cannot select an arbitrary tenant.
- Duplicate pending invitation and duplicate idempotency submissions create one invitation, one membership, and one notification task.
- Invitation acceptance is single-use, tenant-bound, expiry-aware, activates exactly one membership, and never mints a session.
- Invalid/foreign role, organization, user, invitation, membership, and session IDs cannot cross tenant boundaries.
- Organization admin cannot assign administrative/platform roles or manage out-of-scope users.
- Concurrent attempts cannot remove/suspend the last active tenant super administrator.
- Role changes, suspension, session revocation, and MFA reset invalidate all target sessions but no other tenant user's sessions.
- Reactivation does not restore revoked roles or mint sessions.
- MFA reset clears structured fields only and emits no secrets.
- Every successful mutation writes exactly one expected audit event; denied attempts write a deny event; audit context is redacted.
- Platform Admin routes/roles and system-tenant protections remain unchanged.
- Production build/source contains no Quick Access helper, shared email/password, or credential-population behavior; test fixtures remain test-only.
- Audit redaction excludes all password, session, invitation, and MFA secret material.

### 14.3 Database tests

- Fresh forward migration, preflight failure fixtures, rollback before activation, re-apply, and bootstrap/repair compatibility.
- Composite foreign keys reject cross-tenant membership references.
- NULL-scope uniqueness rejects duplicate current role assignments.
- Status/version constraints and indexes exist.
- Migration preserves valid existing memberships and invitations.
- Preflight decision-table branches are tested: confirmed gap, already-present schema, invalid legacy data, unsafe validation, drift, and migration-number conflict.

### 14.4 Frontend tests

- Users & Access nav/page visibility follows `user:read`; direct unauthorized hash resolves Access Restricted.
- Browser-hidden controls do not substitute for backend authorization.
- Invite/role/security dialogs validate role choices, reason fields, concurrency conflicts, and API errors.
- Keyboard focus, dialog trap/Escape/restoration, screen-reader labels/status, 44px touch targets, and 360/768/1024/1440 layouts.
- Existing Login, landing, dashboard, tenant routes, and Platform Console remain intact.

### 14.5 Verification commands

Run focused IAM/API/frontend/database tests separately, then the framework gates:

```text
node run_with_env.js npx.cmd vitest run --fileParallelism=false
npx.cmd tsc --noEmit --project apps/web/tsconfig.json
npm.cmd run build --workspace=@govos/web
```

Also run API/core/database TypeScript/build checks defined by their workspaces, migration forward/rollback/re-apply verification, and restart/session invalidation checks.

## 21. Acceptance criteria

1. No production-facing Quick Access control, known shared credential, or Quick Access guidance remains in the web bundle/UI.
2. Only authenticated non-system tenant users with `user:read` can see/open Users & Access; backend APIs independently enforce exact permissions.
3. Authorized administrators can invite users only to their own tenant and allowed scope, using approved canonical roles.
4. Invitation tokens are single-use, stored only as hashes, delivered through the encrypted notification outbox, and never returned by admin APIs or logs.
5. Duplicate/retried invitations and role assignments are idempotent and do not create duplicate identities, memberships, or notifications.
6. Tenant administrators cannot assign tenant-admin/platform roles outside their delegation ceiling, self-escalate, cross tenant boundaries, or disable the last active tenant super administrator.
7. Role/status/MFA changes revoke the affected user's sessions without invalidating unrelated users.
8. Suspended/invited users cannot obtain or use sessions; reactivation does not silently restore revoked access.
9. MFA reset clears structured credentials securely, revokes sessions, exposes no secrets, and is fully audited.
10. All IAM reads/mutations enforce tenant predicates in code and composite tenant integrity in the database where migration preflight confirms the gap.
11. Successful mutations and denied privileged attempts produce redacted, tenant-correct audit evidence.
12. Platform Admin remains restricted to the system-tenant/platform-permission/MFA architecture and is not reachable through tenant IAM.
13. Accessibility/responsive requirements pass at 360, 768, 1024, and 1440 pixels.
14. Focused tests, full sequential Vitest, applicable TypeScript checks, production build, migration verification, evidence, clean milestone tree, and Antigravity approval all pass before merge.

## 22. Staged implementation gates

### Gate 0 — Architecture decisions

- Antigravity approves `IAM1_IMPLEMENTATION_PLAN.md`.
- Antigravity approves ADR-002 and selects the tenant identity-resolution strategy.
- Antigravity approves the delegation matrix, organization scope behavior, and tenant `super_admin` administrative-role policy.
- Deployed-schema preflight evidence records every migration decision-table input and confirms the next available migration number.
- Antigravity confirms the canonical tenant role/permission catalog and explicit assignable-role policy.

Exit: signed architecture/security decisions; no unresolved authorization ambiguity.

### Gate 1 — Schema and shared authorization foundation

- Implement preflighted migration, role/permission catalog alignment, composite tenant constraints, membership lifecycle/versioning, and shared authorization helpers.
- Update bootstrap/provisioning/repair paths to use the same role catalog.

Exit: migration forward/rollback/re-apply tests and RBAC unit tests pass; no invalid legacy rows.

### Gate 2 — Authentication/session hardening

- Remove login ambiguity, enforce active user/tenant status, tenant-safe joins, active memberships, and authoritative `/auth/session` claims.
- Implement individual session-revocation primitive.

Exit: invited/suspended/ambiguous login and stale-session tests pass.

### Gate 3 — Invitation APIs

- Implement tenant invitation create/resend/revoke and harden acceptance using existing idempotency, hashing, encrypted outbox, and audit architecture.

Exit: duplicate, replay, expiry, cross-tenant, notification-once, and audit tests pass.

### Gate 4 — Role and security administration APIs

- Implement assignment/removal, suspension/reactivation, session revocation, and MFA reset with locks, versions, delegation controls, and audit.

Exit: escalation, last-admin, concurrency, cross-tenant, session, and MFA tests pass.

### Gate 5 — Frontend and Quick Access removal

- Remove Quick Access and shared-credential guidance.
- Add route/navigation/page/dialogs using authoritative session claims and existing shell/routing components.

Exit: focused UI/routing/accessibility/responsive tests pass.

### Gate 6 — Integrated verification and evidence

- Run focused suites, full sequential regression, all applicable TypeScript checks, web production build, migration/restart recovery, and manual accessibility/responsive checks.
- Produce `docs/ecogov/IAM1_EVIDENCE.md` with commands, exit codes, totals, migration evidence, security evidence, limitations, commit hash, and tree status.

Exit: all gates green and milestone-scoped tree clean.

### Gate 7 — Independent review

- Push implementation only to `codex/implementation` after all checks pass.
- Antigravity reviews architecture, authorization, tenant isolation, migration safety, accessibility, backward compatibility, and tests.
- Codex fixes P0/P1 findings; P2 items go to backlog; rerun final verification.

Exit: Antigravity issues **APPROVED**. No merge, tag, or release occurs before approval.

## 23. Open decisions requiring Antigravity approval

1. ADR-002 option A (recommended tenant-context login) or option B (global email uniqueness).
2. Whether and under what elevated control tenant `super_admin` may assign `organization_admin`; default is no.
3. Organization scope semantics when a user has multiple organization memberships.
4. Final self-sensitive action policy beyond the default denials.
5. Authoritative role/permission reconciliation approach where runtime mappings and persisted seed data differ.
6. Migration contents and number after deployed-schema preflight.
7. Whether the compatibility `user_account.status='invited'` transition remains indefinitely or receives a later approved activation-state migration.

## 24. P2 backlog items

- Consider extracting reusable identity services into a future `packages/identity` only through a separate ADR; no extraction in IAM-1.
- Consider an operational timeline projection consuming `authz_audit_log`; no new timeline table in IAM-1.
- Consider custom roles, delegated `organization_admin` assignment, bulk provisioning, external directories, SSO/SCIM/OAuth, global identity linking, and MFA enrollment UX as separate milestones.
- Consider retiring the compatibility `user:write` umbrella after all callers use bounded permissions.

## 25. Planned evidence and merge criteria

Evidence: `docs/ecogov/IAM1_EVIDENCE.md` during implementation, not during this planning milestone.

Merge criteria: approved implementation plan; every staged gate passed; clean scoped working tree; evidence complete; no open P0/P1 findings; explicit Antigravity approval. Merge/tag/release remain owner-controlled under the GovOS Engineering Implementation Framework.

## 26. Known planning risks requiring review

1. Login email is tenant-local in the database but the current login request has no tenant discriminator. Antigravity must approve the resolution before implementation.
2. Checked-in schema and runtime disagree about `membership.status`; target database inspection is mandatory before choosing migration operations.
3. Runtime hard-coded RBAC, persisted role-permission data, provisioning seeds, bootstrap seeds, and frontend permission reconstruction are inconsistent. IAM-1 must consolidate the catalog contract without silently changing unrelated business permissions.
4. The platform invitation acceptance branch marks MFA verified without demonstrating enrollment in the shown route. IAM-1 must not copy that behavior for tenant users; broader platform-MFA correction should be separately reviewed unless required to prevent regression.
5. `organization_admin` scope semantics are not presently encoded in authorization middleware. The default plan constrains it to assigned organizations and prohibits administrative-role delegation, pending approval.
