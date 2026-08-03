# IAM-1 Gate 2 Bootstrap Evidence

Status: **BLOCKED — Phase 1 authorization prerequisite failed; no bootstrap mutation**

Date: 2026-08-02

## Verified target tenant metadata

- Tenant ID: `00000000-0000-0000-0000-000000000001`
- Tenant slug: `anambra-state-ministry-of-environment`
- Tenant name: Anambra State Ministry of Environment
- Tenant status: active
- System-reserved: no
- Exact-slug result count: one
- Highest migration: 28
- Current users: 0
- Current memberships: 0
- Current sessions: 0
- Tenant-local `super_admin` role ID: `00000000-0000-0000-0000-000000000501`
- Cross-tenant memberships: 0 from the approved Gate 1 state
- Duplicate current memberships: 0 from the approved Gate 1 state

## Blocking role evidence

- Canonical role exists in the target tenant: yes
- Canonical role permission mappings: 0
- Expected approved tenant permissions: 19
- Expected permissions present in target tenant: 0/19
- Expected permissions mapped to role: 0/19
- Total target-tenant permissions: 1 (`marketplace.payment.verify`)
- `marketplace.payment.verify` mapped to canonical role: no
- Platform permissions mapped to canonical role: 0
- Existing users/invitations/memberships/platform assignments that could make bootstrap ambiguous: 0/0/0/0

This is the directive's explicit “missing or malformed tenant-local super_admin role” abort condition. A role name and description without an approved effective permission set cannot authorize the first tenant administrator.

## Mutation and secret-safety evidence

No database or application mutation was performed:

- User ID: not created
- Membership ID: not created
- Invitation ID: not created
- Notification task ID: not created
- Audit event ID: not created
- Password/hash: not created
- Session: not created
- Platform role assignment: not created

No invitation token, token hash, password, password hash, bearer token, MFA secret, recovery code, database credential, or secret-bearing environment payload was generated, printed, logged, or included in evidence.

## Implementation and verification status

- Phase 1 target revalidation: completed; authorization catalog failed
- Repair-bootstrap compatibility changes: not started
- Guarded CLI: not started
- Invitation acceptance: not changed or invoked
- Tenant-context login: not changed or invoked
- `GET /auth/session`: not changed or invoked
- End-to-end administrator verification: not run
- Focused tests: not run because no implementation was authorized past Phase 1
- Full regression/TypeScript/build: not rerun because no code changed and the mandatory prerequisite blocked implementation

## Known limitations

- The approved canonical permission set is known, but no authorization in this directive permits silently seeding it after Phase 1 explicitly requires aborting on a malformed role.
- The existing repair-bootstrap still references the legacy membership conflict target; it remains unchanged pending prerequisite approval.
- Secure local invitation delivery has not been evaluated because no invitation may be generated before the role catalog is valid.

## Gate decision

Gate 2 bootstrap is not complete and no success claim is made. Resume requires explicit review approval for tenant-local permission catalog seeding/mapping, followed by a clean Phase 1 rerun.

Files changed:

- `docs/ecogov/IAM1_GATE2_BOOTSTRAP_IMPLEMENTATION_PLAN.md`
- `docs/ecogov/IAM1_GATE2_BOOTSTRAP_EVIDENCE.md`

Commit: commit containing this evidence; exact hash is recorded in the final handoff.

Working tree: expected clean after the documentation-only commit; final status is recorded in the handoff.

## Invitation route correction (2026-08-03)

The delivered tenant-administrator invitation remained pending, with its user and membership invited and zero sessions. A bounded source audit established that its protected activation target used:

- Scheme: `http`
- Host: `localhost`
- Port: `3000`
- Pathname: `/`
- Hash route: `/accept-invitation`
- Query parameter names: `token`

No token value, complete activation URL, hash, password, or decrypted mailbox payload was read into evidence or printed during the investigation.

Root cause: the EMIS hash-route registry did not register `/accept-invitation`. Route normalization removed the query portion for matching, found no registered route, and selected the normal landing/dashboard fallback.

Resolution:

- `#/accept-invitation` is the single canonical public invitation route.
- The shared core URL builder and the frontend registry use the same exported route constant.
- Existing platform and tenant-provisioning notification generators use the canonical builder.
- The public acceptance page renders independently of login state, including while another user has an existing session.
- A valid token is captured into React memory and immediately removed from the browser address with `history.replaceState`.
- Missing, duplicated, or malformed tokens render a safe error and do not call the acceptance API.
- Acceptance posts only to the existing public `POST /auth/invitations/accept`; it does not mint a browser session or redirect to the dashboard.

Verification results:

- Focused route and existing routing tests: **17/17 passed**.
- Focused route, routing, and platform-permission compatibility tests: **21/21 passed**.
- Full sequential suite: **66 files, 325/325 tests passed**, duration 155.38 seconds.
- Web TypeScript: **passed**, exit code 0.
- Web production build: **passed**, 68 modules transformed in 4.18 seconds.
- Core TypeScript build: **passed**, exit code 0.
- Database TypeScript build: **passed**, exit code 0.
- Final read-only deployed-state check: invitation `pending`, user `invited`, membership `invited`, sessions `0`.

No bootstrap, invitation creation, invitation acceptance, session creation, mailbox open, or database mutation was performed by this correction.
