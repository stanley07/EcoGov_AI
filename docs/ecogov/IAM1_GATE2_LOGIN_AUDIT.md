# IAM-1 Gate 2 Authentication and Administrative-Login Audit

Status: **Read-only audit complete — remediation requires review before Gate 2**

Date: 2026-08-02

## Scope and safety

This audit inspected repository contracts and non-secret database metadata only. It did not submit credentials, verify or expose any stored hash, create a session, change a password, or modify a user, tenant, membership, role, schema, application file, or database row.

## Intended login surface and contract

- Local web URL: `http://localhost:5173/` and its Login modal; there is no dedicated login route.
- Local API URL: `http://localhost:8080/auth/login`.
- Current request body: `{ "email": string, "password": string }`.
- Current frontend API base: hard-coded `http://localhost:8080` in `apps/web/src/main.tsx`.
- `.env` configures API `PORT=8080`; no `VITE_API_BASE_URL` is consumed by the login client.
- Read-only availability check: API `/healthz` returned HTTP 200. The Vite web development server was not running on port 5173 during the audit.

## ADR-002 tenant-context design

The required design is ADR-002 Option A: resolve an active tenant from `tenantSlug` or a trusted tenant-bound context, then resolve normalized email within that tenant. The intended direct contract is `{ tenantSlug, email, password }`; the browser never supplies a trusted tenant UUID. Authentication errors remain generic and sessions carry the resolved tenant context.

The repository ADR metadata is stale: it still says “Draft,” “Antigravity decision: Pending,” and “Selected option: Pending.” The instruction for this audit treats tenant-context login as approved, but the ADR approval record should be updated by the architecture owner before implementation so code and governance evidence agree.

## Intended EcoGov administrative identity

Canonical tenant:

- Tenant ID: `00000000-0000-0000-0000-000000000001`
- Name: Anambra State Ministry of Environment
- Slug/context: `anambra-state-ministry-of-environment`
- Status: active
- System tenant: no
- Canonical organization exists: yes

The bootstrap contract identifies deterministic tenant administrator user ID `00000000-0000-0000-0000-000000001001`, but that account does not exist in the deployed database. The environment has no configured `ADMIN_EMAIL`, so no owner email can safely be inferred.

Therefore the correct candidate is **an owner-nominated individual account to be provisioned in the canonical tenant**, using the deterministic bootstrap/provisioning identity only if that remains approved. There is currently no deployable administrative account to name by email.

Current canonical-tenant state:

- Users: 0
- Memberships: 0
- Sessions: 0
- Candidate account status: not applicable; account absent
- Membership role: absent
- Role tenant consistency: not applicable; no assignment exists
- Password hash presence: absent with the account; no hash was displayed
- Session state: no current, expired, stale, or revoked session exists for this tenant

## Seeded and Quick Access findings

The frontend's production-facing Quick Access Stubs fill these values and a shared test password:

- `owner@carwash.com`
- `inspector@govos.ai`
- `director@govos.ai`

None of those emails exists in deployed `user_account`. They therefore fail at identity lookup and return the generic `401 Invalid email or password`; their failure does not prove that a stored credential is wrong.

The similarly named `anambra-test-seeder` tenant contains `officer@anambra.gov.ng`, but it is not a valid administrative candidate:

- it belongs to a test tenant, not the canonical EcoGov tenant;
- it has zero memberships and no role;
- its stored value is present but is not in Argon2id format;
- it has no session.

Fourteen other active `super_admin` accounts belong to isolated test tenants. Their memberships now have tenant-consistent roles, but their stored values are not Argon2id hashes and they must not be repurposed for EcoGov administration.

## Exact failure root cause

For the repository-provided current login shortcuts, the immediate root cause is **missing user identity**: all three Quick Access emails are absent. For the intended EcoGov administrative login, the root cause is **incomplete canonical-tenant provisioning**: the canonical tenant is active, but its intended administrator user, membership, password hash, and session do not exist.

This is not presently attributable to:

- credential failure — there is no canonical account/hash against which a submitted password could be evaluated, and no password was tested;
- inactive account — no canonical account exists;
- inactive tenant — the canonical tenant is active;
- ambiguous email — deployed normalized emails are unique across current non-deleted users;
- stale/revoked session — the canonical tenant has no session;
- API availability — local API health is 200 and the frontend targets its configured port.

A separate frontend availability issue existed during the audit: no server answered on local port 5173. This prevents using the local page but does not explain an API `401` from an attempted login.

## Authentication-route defects relevant to Gate 2

The current `POST /auth/login` implementation does not implement ADR-002:

- it accepts no tenant slug/context;
- it queries exact email globally and does not normalize case/whitespace;
- if future duplicate emails exist, it can select `rows[0]` nondeterministically;
- it does not require an active user, active tenant, or active membership before creating a session;
- membership and role joins omit tenant predicates;
- it can return a successful session with an empty role list;
- successful verification may transparently rewrite a hash, so the route was not invoked during this read-only audit;
- failed logins do not create an authentication audit event.

The protected-route middleware later rejects expired tokens, tenant session-version mismatches, suspended accounts, and suspended tenants. It does not make unsafe login-time identity resolution acceptable, and it currently joins memberships by user ID without repeating tenant predicates.

## Failure classification matrix

| Failure class | Deployed finding | Current behavior / evidence |
| --- | --- | --- |
| Credential failure | Not established | No canonical hash exists and no password was tested |
| Missing membership | Confirmed for canonical tenant because it has no users/memberships | Current login route would not reject membership absence |
| Inactive account | Not the current cause | No canonical account; route itself does not enforce active status |
| Inactive tenant | Not the current cause | Canonical tenant is active; route itself does not enforce active status |
| Ambiguous tenant-local email | No current duplicate normalized email | Current global lookup remains architecturally unsafe and violates ADR-002 |
| Stale/revoked session | Not the current cause | Canonical tenant has zero sessions; middleware checks expiry/version later |
| Frontend/API configuration | API target is reachable; web dev server was down | Hard-coded API base is environment-fragile but not the observed API 401 cause |

No recent login/authentication/session failure records were available in `authz_audit_log`; the login route does not write them. This limits forensic certainty about a specific human-entered attempt.

## Safe remediation plan

1. Resolve the Gate 1 migration-27 checksum blocker and finish migration 000028 verification before Gate 2.
2. Update ADR-002's approval record to Option A and approve the exact `{ tenantSlug, email, password }` compatibility/error contract.
3. Have the owner nominate one individual, non-shared administrative email for tenant `anambra-state-ministry-of-environment`.
4. Use a separately approved, audited tenant-bootstrap or tenant-admin activation workflow to create that user and one tenant-local canonical administrative membership. Do not insert a role ID manually or reuse any test/template tenant identity.
5. Set the owner's private initial password through a single-use invitation/activation flow or secure interactive provisioning input; never record it in source, evidence, logs, chat, or Quick Access.
6. Verify the created role belongs to the same tenant, has the approved tenant-admin permission ceiling, and has no platform role assignment.
7. Invalidate any superseded invitation/session state and record the provisioning event in the authorization audit log.
8. Implement ADR-002 fail-closed login and remove production-facing Quick Access shortcuts only after the Gate 2 plan is approved.

The current `bootstrap:repair` path requires compatibility review before use after migration 000028: it relies on the legacy `ON CONFLICT (user_id, organization_id, role_id)` constraint that migration 000028 replaces with partial unique indexes. It must not be used blindly as the remediation shortcut.

## Is a password reset required?

**No—not for the current canonical EcoGov state.** There is no administrator account to reset. The required action is secure initial credential establishment during approved account activation. A reset becomes genuinely required only if review selects an existing owner-controlled canonical-tenant account with an unknown/invalid credential; no such account exists today.

## Risks

- Provisioning before tenant-context authentication is approved could create an account that remains ambiguous or unsafe to use.
- Reusing test users, Quick Access credentials, template roles, or shared passwords would violate tenant isolation and accountability.
- Running the current repair bootstrap after 000028 may fail due to its legacy conflict target.
- Current login can issue sessions to inactive or membership-less identities.
- Missing failed-login audit events reduce incident and support visibility.
- Hard-coded frontend API configuration can break non-local deployments.

## Required tests before Gate 2 login is accepted

- Tenant slug plus normalized email selects exactly one active tenant-local account.
- Wrong tenant slug, unknown email, wrong password, suspended/invited user, inactive tenant, and missing/inactive membership all fail generically without creating a session.
- Same email in two tenants authenticates only within the supplied tenant context.
- Cross-tenant role/membership references cannot appear in returned claims.
- An account with no tenant-local role cannot receive an administrative session.
- Expired and session-version-invalidated tokens return 401; suspended user/tenant behavior remains enforced.
- Login failures and successes emit redacted, tenant-safe audit evidence without password, hash, token, or enumeration data.
- Frontend sends tenant context to the configured API base and clears stale local state on 401.
- Quick Access controls and shared test credentials are absent from production UI/bundles.
- Owner activation is single-use, audited, and produces exactly one active same-tenant administrative membership.

## Gate decision

Do not begin Gate 2 implementation. Antigravity must review the ADR approval-record discrepancy, initial tenant-admin provisioning mechanism, repair-bootstrap compatibility, and the login contract/remediation plan.
