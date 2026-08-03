# IAM-1 Gate 3 Role-Catalog Decision Record

Status: **Approved**

Date: 2026-08-03

## 1. Canonical Roles & Subcontractor Disposition

We approve the following canonical tenant roles:
* `super_admin`
* `director`
* `inspector`
* `environmental_consultant`
* `finance_officer`
* `organization_admin`
* `citizen`

### Subcontractor Disposition
The `subcontractor` role is strictly a **business/UI label and alias**. It will not be seeded as a database RBAC role. The frontend page will render **Environmental Consultant / Subcontractor**, but all API actions and permissions must use the canonical `environmental_consultant` role.

---

## 2. Granular Permission Vocabulary & Legacy Compatibility

The following new granular permissions are approved as canonical for IAM-1 Gate 3:
* `user:read`
* `user:invite`
* `user:role:assign`
* `user:membership:update`
* `invitation:read`
* `invitation:create`
* `invitation:resend`
* `invitation:revoke`
* `role:read`

### Legacy Compatibility Policy
* The legacy `user:write` permission is temporarily retained as an **umbrella compatibility alias**.
* Existing endpoints may continue to accept `user:write`. All new Gate 3 endpoints must require the granular permissions explicitly.

---

## 3. Role-Permission Assignment Matrix

| Role | Mapped Permissions | Assignability |
| --- | --- | --- |
| `super_admin` | All 19 canonical tenant permissions, including all IAM-1 permissions | Protected (System Provisioned Only) |
| `director` | `user:read`, `invitation:read`, `role:read`, plus standard operations | Assignable |
| `inspector` | Standard operations only (no IAM management permissions) | Assignable |
| `environmental_consultant` | Standard operations only (no IAM management permissions) | Assignable |
| `finance_officer` | Standard operations only (no IAM management permissions) | Assignable |
| `organization_admin` | Deferred (unassignable in Gate 3) | Protected / Excluded |
| `citizen` | Standard operations only | Assignable |

* **super_admin assignment limit**: A tenant `super_admin` may **not** assign the `super_admin` role to other users. Only the system provisioner may create a tenant `super_admin`.
* **Self-sensitive protections**: Self-promotion, self-demotion, and self-suspension are denied. Final active `super_admin` protection is enforced.

---

## 4. Seeding & Reconciliation Mechanism

* **Mechanism**: **Guarded Idempotent Catalog Script**. Because only metadata update operations are required, seeding will run via a script that reconciles roles and permissions with `modules/govos-core/src/rbac.ts`.
* **DDL Migration 000029**: Not authorized. No schema changes are needed for Gate 3.
* **Manual SQL**: Denied. All updates must run in a single serializable transaction.

---

## 5. Verification and Rollback Expectations

* **Rollback Strategy**: If reconciliation fails, transaction rollback must restore the database to its pre-reconciliation state.
* **Seeding Verification**: Post-seed validation must prove:
  1. Exactly 19/19 permissions exist on `super_admin`.
  2. Zero `platform.*` permissions exist on tenant roles.
  3. Zero cross-tenant mappings exist.
* **Test Requirements**: Focused integration tests must cover wildcard rejections, assignment validations, and tenant-boundary checks.

---

## 6. Authorization to Resume Gate 3

* The decision package is complete. Resuming Gate 3 implementation is **Authorized** subject to the verification criteria.
