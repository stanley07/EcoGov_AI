# IAM-1 Migration 27 Checksum Reconciliation Evidence

Status: **PASS — authorized history checksum repaired**

Date: 2026-08-02

## Authorization and scope

Antigravity approved disposition `REPAIR_HISTORY_CHECKSUM` after confirming that the deployed schema has perfect parity with the immutable committed migration 27 and that migration 27 has not changed after its initial Git commit. Editing or rerunning migration 27 remained prohibited. The only authorized manual SQL was the exact, old-checksum-qualified history repair recorded below.

No database credential, connection string, personal-data inventory, token, password, or backup content is included here.

## Pre-repair safety evidence

- PostgreSQL reachable: 18.4, 64-bit Windows
- Target database: `govos_db`
- Highest applied migration: 27
- Migration 28 applied rows: 0
- Recorded migration 27 checksum: `4c073fb1084560d7664ebc535a4a0a7ca62f5770c162dba27c84f6ceb85e27fa`
- Repository migration 27 checksum: `dd17040517ff5e876451f526bb50193f91332bd2ef6992ce4a475bf55ce34a93`
- Migrations 1–26 independently recomputed and matched their recorded checksums: yes
- Only mismatch: migration 27
- Fresh backup readable: `C:\tmp\govos_iam1_gate1_bootstrap_pre_000028_20260802_170523.dump`, 1,403,412 bytes
- Backup TOC/list check: passed
- Pre-repair schema fingerprint: `189be052035c5c97bd49521f1fd67fa9`
- Protected table counts before repair: users 1,108; memberships 62; roles 68; permissions 607; invitations 0; sessions 1,110; authorization audits 266
- Cross-tenant memberships: 0
- Duplicate current NULL-organization memberships: 0

Every value matched the approved review evidence before mutation.

## Exact authorized SQL

```sql
BEGIN;

UPDATE schema_migrations
SET checksum = 'dd17040517ff5e876451f526bb50193f91332bd2ef6992ce4a475bf55ce34a93'
WHERE version = 27
  AND checksum = '4c073fb1084560d7664ebc535a4a0a7ca62f5770c162dba27c84f6ceb85e27fa';

COMMIT;
```

The update was executed in an interactive explicit transaction. PostgreSQL returned `UPDATE 1`; only then was `COMMIT` issued. No timestamp, version, name, filename, or other history row was changed.

## Post-repair verification

- Updated rows: exactly 1
- Migration 27 checksum: approved repository checksum
- Migration 27 `applied_at`: unchanged (`2026-08-02 10:18:19.527403+01`)
- Highest migration before migration-28 application: 27
- Migration 28 rows before application: 0
- Schema fingerprint after checksum repair: `189be052035c5c97bd49521f1fd67fa9` (identical)
- Protected table counts after repair: identical to pre-repair
- Cross-tenant memberships: 0
- Duplicate current NULL-organization memberships: 0

The official runner subsequently accepted migrations 1–27 and applied only migration 28. A second official runner invocation completed with `appliedCount=0`, proving checksum validation and migration-history stability.

## Audit boundary

This immutable-history evidence record is the narrow reconciliation audit artifact requested by the review. No application audit row was inserted because the authorization allowed exactly one database change: the predicate-bound update to `schema_migrations.checksum`.

## Files changed

- `docs/ecogov/IAM1_MIGRATION27_CHECKSUM_RECONCILIATION_EVIDENCE.md`
- `docs/ecogov/IAM1_GATE1_POST_APPLY_EVIDENCE.md`

Commit: commit containing this evidence; exact hash is recorded in the final handoff.

Working tree: expected clean after the documentation-only commit; final status is recorded in the handoff.
