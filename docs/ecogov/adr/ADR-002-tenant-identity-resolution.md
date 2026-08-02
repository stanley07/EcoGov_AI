# ADR-002 — Tenant Identity Resolution

Status: Draft for Antigravity review; no decision approved

Date: 2026-08-02

## Context

GovOS `user_account` identities are tenant-owned and email is unique only within `(tenant_id, email)`. The authentication request currently accepts email and password without a tenant discriminator and queries by email alone. The same normalized email may therefore identify multiple valid tenant accounts, making silent row selection unsafe and nondeterministic.

IAM-1 requires unambiguous authentication before tenant user administration can be implemented. This ADR presents the two approved decision candidates; it does not authorize either implementation.

## Decision drivers

- Fail closed under duplicate tenant-local emails.
- Preserve tenant isolation and avoid identity/account disclosure.
- Maintain backward compatibility where safely possible.
- Support future GovOS applications without a repository-wide identity rewrite.
- Minimize risky data migration and operational account merges.
- Keep platform administration separate from tenant administration.

## Option A — Tenant-context login (recommended)

Require a tenant slug or a trusted tenant-bound login context together with normalized email and password.

### Contract

- Direct login may accept `{ tenantSlug, email, password }`.
- A tenant-branded entry URL may establish a validated tenant context before showing Login; the server still derives tenant ID from the resolved slug/context, never from a trusted browser tenant ID.
- Query identity by active tenant plus normalized email.
- Generic authentication errors prevent tenant/account enumeration.
- Existing tenant-local email uniqueness remains authoritative.

### Benefits

- Matches the current schema and tenant isolation model.
- Avoids merging or rejecting legitimate identities sharing an email across tenants.
- Requires no global uniqueness migration.
- Makes tenant context explicit for sessions, auditing, invitations, and support.

### Costs and compatibility

- Public Login needs a tenant selection/slug context and API contract evolution.
- Existing clients using email/password need a staged compatibility response. They must fail closed when identity is ambiguous; a temporary legacy request may work only when exactly one eligible tenant identity exists if Antigravity explicitly approves that bridge.
- Tenant discovery must not leak tenant membership by email.

## Option B — Global email uniqueness

Require a normalized email to identify at most one `user_account` across all tenants.

### Required prerequisites

- Inventory and report duplicate normalized emails across active, invited, suspended, and soft-deleted accounts.
- Approve conflict resolution: account merge/link, tenant-specific replacement addresses, or manual remediation.
- Define membership/session/MFA/password/audit ownership during resolution.
- Add and validate a global normalized-email uniqueness migration only after remediation.
- Analyze invitation, bootstrap, platform tenant, support, and existing client compatibility.

### Benefits

- Retains a simple email/password login surface.
- Makes identity lookup globally deterministic after migration.

### Costs and risks

- Conflicts with the current tenant-owned identity model.
- May force operationally sensitive account merges or address changes.
- Has greater migration, rollout, rollback, privacy, and tenant-coupling risk.
- Could become an implicit global identity redesign beyond IAM-1.

## Recommendation

Approve Option A because it preserves existing tenant-local identity semantics and minimizes destructive migration risk. This is a recommendation only; IAM-1 remains blocked until Antigravity explicitly approves A or B.

## Security invariants for either option

- Authentication must never silently select one of multiple identities.
- Only active users in active tenants with active memberships may receive sessions.
- Queries and session creation must use tenant-safe joins.
- Error messages must not disclose whether an email belongs to another tenant.
- Platform roles/system-tenant context must not be inferred from email.
- Stale sessions must be rejected and frontend local session state cleared on `401`.
- Identity resolution decisions and migrations must be auditable and tested.

## Rollout considerations

1. Capture deployed-schema and duplicate-email evidence without changing data.
2. Antigravity selects an option and approves compatibility behavior.
3. Define exact API/UI contracts and migration/remediation steps, if any.
4. Add focused ambiguity, enumeration, cross-tenant, active-state, and compatibility tests.
5. Deploy server fail-closed behavior before or atomically with client changes.
6. Monitor authentication failures by safe aggregate/correlation metadata; never log credentials.

## Consequences of no decision

IAM-1 implementation must not begin. Existing login ambiguity remains a documented security risk and no tenant user administration endpoints may be introduced on top of it.

## Approval record

- Antigravity decision: Pending
- Selected option: Pending
- Conditions: Pending
- Project owner acknowledgement: Pending
