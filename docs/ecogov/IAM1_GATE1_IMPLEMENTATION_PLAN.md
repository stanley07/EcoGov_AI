# IAM-1 Gate 1 Implementation Plan

Status: **Draft migration awaiting Antigravity review**

## Objective

Bring the membership schema into alignment with the approved IAM-1 architecture before any IAM application code is implemented. Gate 1 adds lifecycle and optimistic-concurrency fields, enforces tenant-consistent references at the database boundary, and closes PostgreSQL's NULL-scope uniqueness gap.

## Clean deployed-schema preflight

PostgreSQL 18.4 at `127.0.0.1:5433`, database `govos_db`, was inspected read-only on 2026-08-02.

- Cross-tenant memberships: 0
- Duplicate NULL-organization `(tenant_id, user_id, role_id)` groups: 0
- Highest applied migration: 27
- `membership.status`: absent
- `membership.version`: absent
- Composite keys: user, role, and organization present; department absent
- Membership composite foreign keys: absent

The three mandatory gates are clean, so migration number `000028` is available for drafting.

## Scope

- Add `membership.status VARCHAR(50) NOT NULL DEFAULT 'active'`.
- Permit only `invited`, `active`, and `revoked` statuses.
- Backfill memberships of tenant-matching invited users to `invited`; retain `active` for all other existing rows.
- Add `membership.version INTEGER NOT NULL DEFAULT 1` and require a positive value.
- Add the missing department `(tenant_id, id)` unique key.
- Add and validate composite membership foreign keys for user, role, organization, and department.
- Preserve the legacy single-column foreign keys and their delete behavior for compatibility.
- Replace the legacy NULL-unsafe assignment constraint with current-assignment partial unique indexes.
- Add membership lookup and session-revocation indexes required by the approved IAM design.
- Make every operation safe to rerun.

## Out of scope

- Application, API, frontend, middleware, RBAC-service, invitation, MFA, session, or Platform Admin changes.
- Role/permission catalog seeding; this requires separate review because it changes effective authorization.
- Modification of existing membership ownership or the approved IAM-1R mappings.
- Migration application to the deployed `govos_db` before review approval.
- Migration 000029 or later.

## Architecture and compatibility

The composite foreign keys make tenant isolation structural rather than dependent solely on application predicates. Existing inserts remain compatible because omitted status/version values resolve to `active` and `1`. Existing primary keys and legacy foreign keys remain available. `NOT VALID` is used when constraints are introduced, followed by explicit validation in the same migration; preflight-clean data is therefore required.

The two partial unique indexes enforce one current tenant-wide or organization-scoped role assignment while allowing historical `revoked` rows. This preserves current active-assignment behavior and supports the approved lifecycle model.

## Implementation sequence

1. Obtain Antigravity approval of this plan and `000028` SQL.
2. Verify the deployed preflight remains clean and migration 28 remains unused.
3. Back up and restore-verify the target database.
4. Apply migration to an isolated representative database.
5. Verify columns, defaults, checks, composite FKs, indexes, cross-tenant rejection, NULL-scope uniqueness, and idempotent rerun behavior.
6. Exercise the documented pre-activation rollback and re-apply.
7. Run the full framework verification suite.
8. Update evidence and request migration-application approval.
9. Do not begin IAM application code until the migration review gate passes.

## Acceptance criteria

- Preflight remains `0 / 0 / 27` before application.
- Existing memberships retain their IDs, tenants, users, roles, organizations, and departments.
- Existing active accounts receive active memberships; invited accounts receive invited memberships only through an unambiguous same-tenant join.
- All membership versions equal 1 immediately after migration.
- Cross-tenant user, role, organization, and department references are rejected by PostgreSQL.
- Duplicate current NULL-organization assignments are rejected.
- Revoked historical assignments do not block a new current assignment.
- A second execution of the SQL succeeds without schema or data drift.
- Rollback is permitted only before IAM-1 application writes depend on the new fields.
- No application source changes are included in the Gate 1 review commit.
