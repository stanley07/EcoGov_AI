# IAM-1 Gate 1 Rollback Strategy

## Boundary

Rollback is safe only before IAM-1 application code writes membership lifecycle/version data or relies on composite constraints. After activation, application rollback comes first and schema/data preservation is mandatory; dropping status or version after they contain operational history is prohibited.

## Pre-activation rollback

Execute in one transaction after confirming no IAM-1 application deployment has occurred:

```sql
BEGIN;

DROP INDEX IF EXISTS idx_session_tenant_user;
DROP INDEX IF EXISTS idx_membership_tenant_user_status;
DROP INDEX IF EXISTS uq_membership_current_organization_role;
DROP INDEX IF EXISTS uq_membership_current_tenant_role;

ALTER TABLE membership DROP CONSTRAINT IF EXISTS fk_membership_tenant_department;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS fk_membership_tenant_organization;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS fk_membership_tenant_role;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS fk_membership_tenant_user;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS chk_membership_version_positive;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS chk_membership_status;

ALTER TABLE membership
  ADD CONSTRAINT membership_user_id_organization_id_role_id_key
  UNIQUE (user_id, organization_id, role_id);

ALTER TABLE membership DROP COLUMN IF EXISTS version;
ALTER TABLE membership DROP COLUMN IF EXISTS status;

ALTER TABLE department DROP CONSTRAINT IF EXISTS uq_department_tenant_id;

COMMIT;
```

The rollback intentionally restores the legacy unique constraint. It does not modify membership identity, ownership, roles, users, organizations, or departments.

## Preconditions

- Migration 000028 was applied only in a disposable/review environment or has explicit production rollback approval.
- No membership contains lifecycle/version information produced by IAM-1 application code.
- No duplicate organization-scoped legacy assignment would prevent restoration of the old unique constraint.
- A verified backup exists.
- The migration history row is handled only by the migration/release operator according to the runner's checksum contract; ad hoc deletion is prohibited.

## Post-rollback verification

- `membership.status` and `membership.version` are absent.
- Four composite membership FKs and Gate 1 indexes are absent.
- Legacy membership foreign keys and uniqueness are present.
- Membership count and ownership checksum equal the pre-migration values.
- Cross-tenant memberships and duplicate NULL-scope assignments remain zero.
- Migration 000028 can be reapplied successfully in the disposable verification environment.

## Post-activation recovery

Do not run the destructive rollback. Disable or roll back IAM-1 application traffic first, preserve new columns and audit evidence, diagnose forward, and use a separately reviewed corrective migration. Restore from backup only under the incident-recovery process.
