# ADR-003 — Tenant Role and Permission Catalog Reconciliation

Status: **Approved**

Date: 2026-08-03

## Context

The EcoGov RBAC system has experienced structural drift:
1. Deployed database tenant permissions and roles differ from the runtime maps in `modules/govos-core/src/rbac.ts`.
2. Persisted seed files omit mandatory tenant-local roles like `environmental_consultant` and `finance_officer`.
3. The business label `subcontractor` has no canonical definition in the database, leading to potential duplicate role mapping and privilege escalation risks.
4. The introduction of IAM-1 requires a granular permission vocabulary (`user:read`, `user:invite`, `user:role:assign`, etc.) that is not supported by the legacy `user:write` permission.

## Decisions

### 1. Canonical Tenant Role Catalog
We approve a fixed, persisted set of canonical tenant roles:
* `super_admin`
* `director`
* `inspector`
* `environmental_consultant`
* `finance_officer`
* `organization_admin`
* `citizen`

### 2. Subcontractor Role Alias
* **Decision**: `subcontractor` is classified as a **business/UI alias** for `environmental_consultant`.
* **Action**: Do not seed a role named `subcontractor`. The frontend will present the display label **Environmental Consultant / Subcontractor**, but the backend API must persist and authorize this solely as `environmental_consultant`.

### 3. Granular Permission Vocabulary
We approve the transition to a granular permission model for IAM actions:
* `user:read`: View users, roles, and status.
* `user:invite`: Invite new users.
* `user:role:assign`: Modify user role mappings.
* `user:membership:update`: Modify membership properties.
* `invitation:read`: View invitations.
* `invitation:create`: Create invitations.
* `invitation:resend`: Resend active invitation tokens.
* `invitation:revoke`: Revoke pending invitations.
* `role:read`: Read roles catalog.

### 4. Legacy Compatibility
* **Decision**: The legacy `user:write` permission is retained temporarily as a **compatibility umbrella alias**.
* **Transition Policy**: Existing endpoints may accept `user:write` during the transition. However, all new IAM-1 endpoints must require and enforce the granular permissions.

### 5. Seeding and Mappings
The permissions will be transactionally seeded for each tenant based on the runtime RBAC catalog.

#### super_admin
* Mapped to all 19 canonical tenant permissions.
* Protected role; cannot be assigned or demoted by another tenant user.

#### director
* Mapped to `user:read`, `invitation:read`, `role:read`, and standard operational permissions.

#### inspector / environmental_consultant / finance_officer / citizen
* Mapped to standard operational permissions only. No IAM mutation permissions.

#### organization_admin
* Scoped user/invitation management within assigned organizations.
* **Gating**: Deferred. Excluded from the assignable roles list until organization-scoped validation is fully implemented.

### 6. Assignability Matrix

| Target Role | Assignable by super_admin | Assignable by organization_admin | Protection Status |
| --- | --- | --- | --- |
| `super_admin` | No | No | Protected (System Provisioned Only) |
| `organization_admin` | No | No | Protected / Deferred |
| `director` | Yes | No | Assignable |
| `inspector` | Yes | No | Assignable |
| `environmental_consultant` | Yes | No | Assignable |
| `finance_officer` | Yes | No | Assignable |
| `citizen` | Yes | No | Assignable |

## Consequences

* Seeding is driven by a guarded, idempotent script matching runtime RBAC definitions.
* Access to `super_admin` role assignment is restricted to system-level provisioning.
* System-wide final active `super_admin` protection is enforced to prevent lockouts.
