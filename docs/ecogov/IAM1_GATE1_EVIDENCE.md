# IAM-1 Gate 1 Evidence

Status: **BLOCKED — official runner detected migration 27 checksum drift before applying migration 28**

Date: 2026-08-02

## Summary

The deployed-schema preflight remained clean and a fresh restore-verified backup was created. The approved deployment was attempted only through the repository's official migration runner. The runner stopped before applying migration 28 because the deployed checksum for migration 27 differs from the committed file. No Gate 1 schema change was applied.

## Preflight environment and results

- PostgreSQL: 18.4, 64-bit Windows
- Host/port: `127.0.0.1:5433`
- Database: `govos_db`
- Cross-tenant memberships: 0
- Duplicate current NULL-organization assignment groups: 0
- Highest applied migration: 27
- `membership.status`: absent
- `membership.version`: absent
- User/role/organization composite referenced keys: present
- Department composite referenced key: absent
- Membership composite tenant foreign keys: absent

The first catalog command returned all three mandatory clean gate values, then exited nonzero only when an `ORDER BY` referenced a select-list alias incorrectly. The corrected catalog-only command exited zero and confirmed the constraint/index inventory. No mutation occurred.

## Artifacts

- `packages/database/migrations/000028_iam_membership_tenant_integrity.sql`
- `docs/ecogov/IAM1_GATE1_IMPLEMENTATION_PLAN.md`
- `docs/ecogov/IAM1_GATE1_VERIFICATION_CHECKLIST.md`
- `docs/ecogov/IAM1_GATE1_ROLLBACK_STRATEGY.md`
- `docs/ecogov/IAM1_GATE1_EVIDENCE.md`

## Migration properties

- Backward-compatible defaults: `status='active'`, `version=1`
- Same-tenant invited-account backfill
- Guarded/idempotent columns, checks, unique key, FKs, and indexes
- Composite membership FKs retain the legacy single-column constraints
- Constraints are added `NOT VALID` and explicitly validated
- NULL-safe partial uniqueness applies only to current (`invited`/`active`) assignments
- No role, permission, membership ownership, or platform assignment data is changed

## Deployment attempt and blocker

Fresh pre-application state:

- Cross-tenant memberships: 0
- Duplicate NULL-organization assignments: 0
- Highest migration: 27
- Membership count: 62
- Membership identity/ownership checksum: `c0351f6d8be9dcfafa638bdf3bb07c15`
- Missing user/role/organization/department references: 0/0/0/0
- Existing Gate 1 columns: 0

Backup and restore evidence:

- Backup: `C:\tmp\govos_iam1_gate1_pre_000028_20260802_164314.dump`
- Size: 1,403,412 bytes
- `pg_dump` exit: 0
- Disposable restore and `pg_restore --exit-on-error`: exit 0
- Restored highest migration: 27
- Restored membership count/checksum: 62 / `c0351f6d8be9dcfafa638bdf3bb07c15`
- Disposable restore database removed after verification

Official command:

`node run_with_env.js npm.cmd run migrate --workspace=@govos/database`

Exit code: 1. The runner reported:

```text
Migration checksum mismatch for version 27 (marketplace_bank_transfer_claims).
Disk: dd17040517ff5e876451f526bb50193f91332bd2ef6992ce4a475bf55ce34a93
DB:   4c073fb1084560d7664ebc535a4a0a7ca62f5770c162dba27c84f6ceb85e27fa
```

Migration 27 was recorded as applied at 2026-08-02 10:18:19 +01, while its only Git commit was created later at 10:38. The mismatch is not caused by LF/CRLF conversion. Git history, other worktrees, and recoverable unreachable blobs did not contain the exact deployed source. Therefore neither immutable migration 27 nor `schema_migrations.checksum` was changed automatically.

Post-attempt state was rechecked:

- Highest migration: 27
- Migration 28 history row: absent
- Gate 1 columns: absent
- Cross-tenant memberships: 0
- Duplicate NULL-organization assignments: 0

## Verification at this drafting gate

- Framework read: complete
- Read-only preflight: pass (`0 / 0 / 27`)
- Repository migration-number audit: pass; 000028 was free before drafting
- SQL transactional syntax/shape validation: pass; draft executed twice in one transaction, constraints validated, then rolled back
- Idempotent rerun: pass; second execution changed no schema/data and emitted only expected `IF EXISTS`/`IF NOT EXISTS` notices
- Post-rollback deployed state: migration 27, cross-tenant 0, duplicate NULL-scope 0, Gate 1 columns absent
- SQL review/diff check: passed before commit
- Disposable forward/idempotency/rollback checks: pending migration review authorization
- Full Vitest/TypeScript/build: pending migration review authorization; no application code changed
- Official migration application: blocked before migration 28; no deployed schema mutation
- Sequential Vitest, TypeScript, build, disposable rollback/reapply, and post-apply constraint checks: not run because their required deployed post-apply state was not reached

## Known limitations and review boundary

Migration 28 remains unapplied. Proceeding requires explicit owner/Antigravity approval of a deterministic migration-27 checksum reconciliation backed by schema equivalence evidence or recovery of the exact originally applied SQL. Bypassing checksum verification, manually applying migration 28, silently changing migration history, or rewriting immutable migration 27 is prohibited. Gate 2 remains blocked.

## Bootstrap-prerequisite deployment reattempt

The approved “Gate 1 Deployment + Initial EcoGov Tenant Administrator Bootstrap” directive was evaluated in strict phase order. Phase A reconfirmed the target before mutation:

- tenant ID: `00000000-0000-0000-0000-000000000001`
- slug: `anambra-state-ministry-of-environment`
- name: Anambra State Ministry of Environment
- status: active
- system-reserved: no
- exact configured/public slug resolution: one tenant
- current users/memberships/sessions: 0/0/0
- tenant-local `super_admin` roles: 1

A test tenant shares the display name but has a different slug; exact-slug resolution is unambiguous. The operational target matches the configured `PUBLIC_TENANT_SLUG` default and canonical bootstrap tenant metadata.

Phase B preflight again passed with cross-tenant memberships 0, duplicate NULL-organization assignments 0, and highest migration 27. A second fresh backup was created and restore-verified:

- backup: `C:\tmp\govos_iam1_gate1_bootstrap_pre_000028_20260802_170523.dump`
- size: 1,403,412 bytes
- restored highest migration: 27
- restored memberships: 62
- disposable restore database removed after verification

The official runner command was invoked again and exited 1 on the same version-27 checksum mismatch before applying version 28. Post-attempt verification confirmed migration 27, zero Gate 1 columns, and target users/memberships/sessions still 0/0/0.

The directive explicitly prohibits bootstrap work when migration verification fails. Therefore bootstrap/repair code, tenant administrator identity, membership, invitation, notification, audit event, password, session, tenant-context login, `/auth/session`, frontend, and tests were not changed or executed. This is the required safe stop, not a partial bootstrap.

Commit hash and final working-tree status will be recorded after the documentation/migration-only commit.
