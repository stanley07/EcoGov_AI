# IAM-1 Gate 1 Evidence

Status: **Migration draft ready for review; not applied to deployed database**

Date: 2026-08-02

## Summary

The deployed-schema preflight is clean, allowing migration 000028 to be drafted. This gate changes no application code and does not apply schema changes to `govos_db`.

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
- Deployed migration application: not performed

## Known limitations and review boundary

The migration is a review artifact. It has not been committed to migration history or left applied to the deployed database. Transactional validation was explicitly rolled back and a post-rollback catalog check confirmed no Gate 1 columns remained. Role/permission seeding described in the broader IAM-1 plan is deliberately excluded because it changes effective authorization and requires its own approved design. Application implementation remains blocked until Antigravity approves migration 000028.

Commit hash and final working-tree status will be recorded after the documentation/migration-only commit.
