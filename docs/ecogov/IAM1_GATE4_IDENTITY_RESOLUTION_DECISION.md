# IAM-1 Gate 4 Identity Resolution Decision Record

Status: **Approved**

Date: 2026-08-03

## 1. Final Login Contract & Tenant Resolution Algorithm

The tenant login route (`POST /auth/login`) is updated to enforce tenant-context login.

### Request Body
```json
{
  "tenantSlug": "anambra-state-ministry-of-environment",
  "email": "user@example.gov.ng",
  "password": "private_password"
}
```

### Server-Side Resolution Flow
1. **Slug Validation**: Normalize and validate `tenantSlug` (ensure alphanumeric/hyphen format).
2. **Tenant Matching**: Resolve exactly one tenant record where:
   * `slug` matches the input.
   * `status` is `'active'`.
   * `deleted_at` is `NULL`.
   * `is_system` is `FALSE`.
3. **Email Normalization**: Lowercase and trim the input `email`.
4. **User-Account Mapping**: Look up the `user_account` record matching the normalized email under the resolved `tenant_id`.
5. **Membership & Role Checks**: Verify that the user has an active membership and role in that tenant:
   * `user_account.status = 'active'`
   * `membership.status = 'active'`
   * `role.tenant_id = user_account.tenant_id`
6. **Password Verification**: Evaluate the password against the stored Argon2id hash.
7. **Session Issuance**: Issue the authenticated session only after all authentication factors (including MFA challenge if enrolled) pass.
8. **Session Binding**: Bind the session row to:
   * `user_id`
   * `tenant_id`
   * `role_id`
   * `session_version`

---

## 2. Security Policies

### Email Uniqueness Policy
* Email uniqueness remains **tenant-local** (unique only within `(tenant_id, email)`).
* The same email address can exist on multiple tenants. Login without `tenantSlug` is rejected. The server must not attempt to guess or infer a tenant from the email.

### Platform-Login Separation
* Platform-administration logins (`PLATFORM_SUPER_ADMIN`, `PLATFORM_SUPPORT_ADMIN`, `PLATFORM_AUDITOR`) use a distinct authentication flow and must not be routed through the tenant-context login endpoint.

### Generic Error Policy
* The API must return a generic error message (e.g., `401 Invalid workspace, email, or password`) for any authentication failure, preventing workspace or username enumeration.

---

## 3. Frontend & Backward Compatibility

### Frontend Contract
* The Login interface is updated to require three input fields: **Workspace Slug**, **Email**, and **Password**.
* Branded login URLs (e.g., matching a slug query or route) can prefill the Workspace Slug input, but the client must still submit the `tenantSlug` parameter in the API request payload.

### Legacy Contract Disposition
* The old `{ email, password }` authentication contract is **completely removed** from the tenant login route.
* No compatibility fallback is provided. Clients that omit `tenantSlug` will receive a validation error.
* All test fixtures, development login stubs, and frontend login forms must be updated atomically to supply `tenantSlug`.

---

## 4. MFA Security Invariants & Migration Implications

### MFA Challenge Dependency
* Password verification success must not issue a fully authenticated session if the user is enrolled in MFA.
* Upon password verification success:
  1. Issue a temporary, bounded pending-auth challenge token.
  2. Bind the challenge token in the database or secure cache to the user ID, tenant ID, attempt limits, and short expiry (e.g., 5 minutes).
  3. Require the client to submit a TOTP code or valid recovery code.
  4. Create the authenticated session only after second-factor validation succeeds.

### Migration 000029 Implications
* A schema migration (`000029`) is approved **only** if database columns/tables are required to support pending auth challenges, password expiration markers, or recovery code tracking. Speculative or unused schema additions are denied.

---

## 5. Gate 4 Execution Plan

The Gate 4 implementation will proceed in the following phase sequence:

* **Phase 0**: Implement tenant-context login API, frontend login update, tenant-safe session creation, and test/fixture updates.
* **Phase 1**: Implement self-service password changes and forced-reset lifecycle status.
* **Phase 2**: Implement MFA enrollment, TOTP challenges, recovery code generation, and MFA administrative resets.
* **Phase 3**: Implement session listing and revocation endpoints/services.
* **Phase 4**: Implement account-security frontend views and authentication audit history.

---

## 6. Authorization

* Finalizing ADR-002 Option A is **Approved**.
* Resuming Gate 4 implementation is **Authorized** once this decision package is committed.
