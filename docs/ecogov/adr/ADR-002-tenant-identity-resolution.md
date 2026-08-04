# ADR-002 — Tenant Identity Resolution

Status: **Accepted**

Date: 2026-08-03

## Context

GovOS `user_account` identities are tenant-owned and email is unique only within `(tenant_id, email)`. The legacy authentication request accepted email and password without a tenant discriminator and queried by email alone. The same normalized email may therefore identify multiple valid tenant accounts, making silent row selection unsafe and nondeterministic.

IAM-1 requires unambiguous authentication before tenant user administration and advanced security features can be implemented.

## Decision Drivers

- Fail closed under duplicate tenant-local emails.
- Preserve tenant isolation and avoid identity/account disclosure.
- Maintain backward compatibility where safely possible.
- Support future GovOS applications without a repository-wide identity rewrite.
- Minimize risky data migration and operational account merges.
- Keep platform administration separate from tenant administration.

## Selected Option: Option A — Tenant-context login

Require a tenant slug or a trusted tenant-bound login context together with normalized email and password.

### Contract

- Direct login accepts `{ tenantSlug, email, password }`.
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
- Existing clients using email/password must fail closed when identity is ambiguous; the legacy email-only fallback is removed from the tenant login route.
- Tenant discovery must not leak tenant membership by email.

## Rejected Option: Option B — Global email uniqueness

Option B is rejected because it conflicts with the current tenant-owned identity model, forces operationally sensitive account merges, and introduces greater privacy and tenant-coupling risks.

## Security Invariants

- Authentication must never silently select one of multiple identities.
- Only active users in active tenants with active memberships may receive sessions.
- Queries and session creation must use tenant-safe joins.
- Error messages must not disclose whether an email belongs to another tenant.
- Platform roles/system-tenant context must not be inferred from email.
- Stale sessions must be rejected and frontend local session state cleared on `401`.
- Identity resolution decisions and migrations must be auditable and tested.

## Approval Record

- Antigravity decision: Approved
- Selected option: Option A (Tenant-context login)
- Conditions: Remove legacy email-only authentication fallback from the tenant login route atomically; update all frontend views, test files, and fixtures.
- Project owner acknowledgement: Accepted and confirmed by the engineering team.
