# IAM-1 Gate 5 Implementation Plan

Status: Approved scope in implementation

## Objective

Deliver organization lifecycle and organization-scoped user administration while preserving tenant isolation, protected tenant roles, platform separation, optimistic concurrency, session invalidation, and append-only audit evidence.

## Scope

- Tenant `super_admin`: list/detail/create/update/archive organizations; assign/remove the protected `organization_admin`; manage organization memberships and transfers.
- `organization_admin`: read/update only its assigned organization; invite and administer only users in that organization; assign only `inspector`, `environmental_consultant`, and `citizen`; use Gate 4 security actions only on in-scope non-administrative users.
- Organization APIs, membership APIs, organization-scoped invitations, Organizations list/detail UI, user/invitation/settings sections, focused tests, regression, and evidence.

## Out of scope

Platform administration, tenant `super_admin` delegation, custom roles, organization ownership graphs, departments, SSO, Gate 6, physical deletion, and unrelated business modules.

## Role classification

| Role                       | Scope            | Protection                          | Gate 5 assignment                                         |
| -------------------------- | ---------------- | ----------------------------------- | --------------------------------------------------------- |
| `super_admin`              | Tenant-wide      | Protected                           | Never                                                     |
| `director`                 | Tenant-wide      | Protected from delegated assignment | Tenant workflows only; not Gate 5 organization delegation |
| `finance_officer`          | Tenant-wide      | Protected from delegated assignment | Not assignable by `organization_admin`                    |
| `organization_admin`       | One organization | Protected                           | Tenant `super_admin` only                                 |
| `inspector`                | Organization     | Business role                       | Tenant or same-organization admin                         |
| `environmental_consultant` | Organization     | Business role                       | Tenant or same-organization admin                         |
| `citizen`                  | Organization     | Business role                       | Tenant or same-organization admin                         |

`subcontractor` remains a business label mapped to `environmental_consultant`; it is not persisted as a role.

## Architecture and database impact

Migration 000030 is required because deployed `organization` lacks optimistic version/archive metadata and `user_invitation` cannot bind an invitation to an organization. It adds `organization.version`, `archived_at`, a validated status constraint, and tenant-safe `user_invitation.organization_id`. No ownership-loop table or speculative hierarchy is introduced.

The existing permissions remain authoritative: `org:read`, `org:write`, and the approved granular IAM permissions. `user:write`, wildcards, and `platform.*` are forbidden for new Gate 5 handlers. `organization_admin` receives only the explicit delegated manifest and every handler independently enforces tenant and organization predicates.

## API and UI

The API covers organization CRUD/archive, organization users, membership add/update/transfer/remove, organization-admin assignment/removal, scoped invitations, and delegated Gate 4 security operations. The UI adds `#/administration/organizations` and `#/administration/organizations/:organizationId` with overview, users, invitations, and settings.

## Testing and acceptance

Focused tests cover CRUD, concurrency, membership, transfers, protected roles, final-admin/orphan protection, scoped invitations, cross-organization/tenant denial, audit ID-only context, session revocation, route/UI contracts, and role manifests. Completion requires migration apply/no-op, full sequential Vitest, all required TypeScript projects, affected builds, scans, and clean final invariants.
