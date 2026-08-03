# IAM-1 Gate 3 Role-Catalog Preflight Blocker

Date: 2026-08-03

Branch: `codex/implementation`
Decision: **STOP — security ownership approval required before implementation**

## Scope and mutation statement

This is the bounded report required by the IAM-1 Gate 3 directive when canonical role seeding or permission reconciliation is necessary. The audit was read-only. No migration, role, permission, role-permission mapping, user, membership, invitation, notification, session, platform-role assignment, application source, or deployed data was created or changed.

## Deployed-schema preflight

The audit connected to PostgreSQL 18.4 on `127.0.0.1:5433`, database `govos_db`.

| Check | Result |
| --- | --- |
| Highest applied migration | 28 |
| Applied/repository migrations | 28 / 28 |
| Migration checksum mismatches | 0 |
| Migration 29 applied | No |
| `membership.status` | Present |
| `membership.version` | Present |
| Composite membership tenant FKs | All four present and validated |
| Invitation lifecycle columns/constraints | Present and validated |
| Cross-tenant memberships | 0 |
| Duplicate current memberships | 0 |
| Duplicate pending invitations | 0 |
| Cross-tenant role-permission mappings | 0 |

The nominated owner account is active, its membership is active, its tenant-local role is `super_admin`, and the role tenant matches the active EcoGov tenant. The owner has no platform-role authority through this membership.

## Target-tenant role inventory

Target tenant: `anambra-state-ministry-of-environment`.

| Persisted role | Persisted permissions | Classification for Gate 3 | Finding |
| --- | ---: | --- | --- |
| `super_admin` | 19 | Protected | Present; includes the previously approved granular IAM permissions, but not the newly proposed `invitation:*`, `role:read`, or `user:membership:update` vocabulary. |
| `organization_admin` | 0 | Protected/conditional | Present; cannot be exposed as assignable until its organization-scoped authority and permission mapping are approved. |
| `director` | 1 | Intended assignable | Present, but persisted mapping contains only `marketplace.payment.verify`; runtime RBAC resolves a materially broader set. |
| `inspector` | 0 | Intended assignable | Present, but persisted mapping is empty while runtime RBAC grants operational permissions. |
| `facility_owner` | 0 | Non-assignable in this Gate 3 directive | Present; persisted/runtime mappings diverge. |
| `citizen` | 0 | Assignability requires confirmation | Present; persisted/runtime mappings diverge. |
| `environmental_consultant` | Missing | Intended assignable | Required by the approved IAM plan as the canonical role behind the Subcontractor label, but no tenant-local row exists. |
| `finance_officer` | Missing | Intended assignable | Required by the Gate 3 directive, but no tenant-local row exists. |
| `subcontractor` | Missing | Ambiguous alias | The approved IAM plan says this is a UI/business label for `environmental_consultant`, while the Gate 3 directive lists it among roles the page must be capable of assigning. No canonical persisted or runtime role named `subcontractor` exists. |

## Exact canonical-source conflict

The repository currently has two non-equivalent authorities:

1. `modules/govos-core/src/rbac.ts` defines runtime role permissions in `ROLE_PERMISSIONS` and inheritance in `ROLE_INHERITANCE`.
2. Tenant-local `role`, `permission`, and `role_permission` rows provide a persisted catalog, but the target tenant does not reproduce the runtime mappings for most business roles.

The tenant provisioning seed is also narrower: it creates only `super_admin`, `organization_admin`, `director`, `inspector`, `facility_owner`, and `citizen`; it omits both `environmental_consultant` and `finance_officer`.

The requested granular permission vocabulary is not fully present in the approved deployed catalog. The active `super_admin` has `user:read`, `user:invite`, `user:role:assign`, `user:status:write`, `user:session:revoke`, and `user:mfa:reset`, but the directive additionally proposes `invitation:read`, `invitation:create`, `invitation:resend`, `invitation:revoke`, `role:read`, and `user:membership:update`. Selecting aliases or adding these permissions would change authorization ownership and therefore cannot be inferred during implementation.

## Expected permission source and proposed mappings for review

These are proposals only; they were not applied.

| Missing role | Existing canonical source | Proposed tenant-local mapping | Security impact |
| --- | --- | --- | --- |
| `environmental_consultant` | `ROLE_PERMISSIONS.environmental_consultant` | `facility:read`, `facility:write`, `facility:register` | Grants facility read/write/registration authority. Approval must confirm this is the intended tenant subcontractor capability and that the UI label does not create a second `subcontractor` role. |
| `finance_officer` | `ROLE_PERMISSIONS.finance_officer` | `facility:read`, `workflow:read` | Grants read access to facilities and workflows but does not currently grant marketplace payment verification. Approval must explicitly decide whether finance verification belongs here rather than inheriting the director-only deployed mapping. |
| `subcontractor` alias | IAM-1 plan, Section 2.4/6 | No new role; display “Environmental Consultant / Subcontractor” and persist `environmental_consultant` | Avoids duplicate semantic roles, but requires explicit confirmation because the Gate 3 directive names `subcontractor` directly. |

The existing `director`, `inspector`, `organization_admin`, `facility_owner`, and `citizen` persisted mappings also need an approved reconciliation rule: either persisted mappings become authoritative and are seeded from an approved catalog, or runtime RBAC remains authoritative with an explicit compatibility contract. Silently cloning the current runtime arrays into deployed data is prohibited by the directive.

## Required owner/Antigravity decisions

Implementation may resume only after explicit approval of all of the following:

1. Confirm `environmental_consultant` is the sole persisted canonical role for the Subcontractor UI label, or approve a distinct `subcontractor` role and its exact permissions.
2. Approve tenant-local creation of `environmental_consultant` and `finance_officer` and their exact permission mappings.
3. Select the authoritative role-permission source and approve reconciliation for existing roles whose persisted mappings differ from runtime RBAC.
4. Approve the exact Gate 3 granular permission vocabulary and its compatibility mapping to the already deployed `user:*` permissions.
5. Confirm whether `citizen` is assignable through Users & Access.
6. Confirm that `organization_admin` remains protected and may be assigned only with the directive’s organization-scope controls.

## Security impact of proceeding without approval

Proceeding would require inventing tenant-local roles or choosing permissions without an authoritative source. That could over-grant facility, workflow, payment, organization, or user-administration authority; create two competing subcontractor identities; or produce a frontend role selector that advertises roles the backend cannot safely authorize. It would violate the explicit no-silent-seeding and anti-escalation requirements.

## Gate status

IAM-1 Gate 3 implementation is **blocked at the mandatory read-only role inventory**. No migration 000029 is justified or drafted, and no application implementation, tests, build, commit, or push was performed after discovering the blocker.
