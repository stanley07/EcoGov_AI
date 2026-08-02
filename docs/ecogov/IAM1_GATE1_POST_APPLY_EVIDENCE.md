# IAM-1 Gate 1 Post-Apply Evidence

Status: **PASS — migration 000028 applied and verified**

Date: 2026-08-02

## Summary

After the explicitly approved migration-27 checksum reconciliation, the repository's official runner validated history and applied migration `000028_iam_membership_tenant_integrity`. Migration 28 was never executed manually. No bootstrap, tenant administrator, invitation, authentication, session API, or Gate 2 work began.

## Backup and preflight

- Backup: `C:\tmp\govos_iam1_gate1_bootstrap_pre_000028_20260802_170523.dump`
- Size: 1,403,412 bytes
- `pg_dump`: exit 0
- Backup list/readability: passed
- Previously completed disposable restore: passed with migration 27 and 62 memberships
- Cross-tenant memberships before apply: 0
- Duplicate current NULL-organization memberships before apply: 0
- Migration history before apply: highest version 27; version 28 absent

## Official migration application

Command:

`node run_with_env.js npm.cmd run migrate --workspace=@govos/database`

Exit code: 0.

- Official runner accepted repaired migrations 1–27.
- Applied version: 28
- Name: `iam_membership_tenant_integrity`
- Applied count: 1
- Recorded migration-28 checksum: `18c3208cced16429037b98d15cab80a7180b30d42d475325b5043eb4d3cbf22a`

No-op verification command: the same official command was run again, exited 0, and reported `appliedCount=0`.

## Membership schema verification

- `membership.status`: `VARCHAR`, non-null, default `active`
- Allowed lifecycle check: `invited`, `active`, `revoked`
- `membership.version`: integer, non-null, default 1, positive-version check present
- Existing membership statuses after migration: 62 active
- Existing membership version range: 1–1
- Validated composite foreign keys: 4/4
  - `(tenant_id, user_id)` → `user_account(tenant_id, id)`
  - `(tenant_id, role_id)` → `role(tenant_id, id)`
  - `(tenant_id, organization_id)` → `organization(tenant_id, id)`
  - `(tenant_id, department_id)` → `department(tenant_id, id)`
- Partial unique current-assignment indexes present:
  - `uq_membership_current_tenant_role`
  - `uq_membership_current_organization_role`

## Tenant and data-integrity verification

Immediately after apply:

- Cross-tenant memberships: 0
- Duplicate current assignments: 0
- Users: 1,108 before / 1,108 after
- Memberships: 62 before / 62 after
- Roles: 68 before / 68 after
- Permissions: 607 before / 607 after
- Invitations: 0 before / 0 after
- Sessions: 1,110 before / 1,110 after
- Authorization audit rows: 266 before / 266 after

Therefore no user, membership, role, permission, invitation, session, or authorization-audit record was deleted by reconciliation or migration. After the full test suite, cross-tenant memberships and duplicate current assignments remained 0 and highest migration remained 28.

## Verification results

| Gate | Command/result | Exit |
| --- | --- | ---: |
| Official apply | `node run_with_env.js npm.cmd run migrate --workspace=@govos/database`; applied 1 | 0 |
| Official no-op rerun | same command; applied 0 | 0 |
| Focused database/migration tests | 4 files, 10/10 tests, 8.64s | 0 |
| Full sequential regression | 62 files, 290/290 tests, 211.17s | 0 |
| Database TypeScript/build | `npm.cmd run build --workspace=@govos/database` | 0 |
| API TypeScript/build | `npm.cmd run build --workspace=@govos/api` | 0 |
| Core/domain TypeScript/build | `npm.cmd run build --workspace=@govos/domain` | 0 |
| Web TypeScript | `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 |
| Production web build | `npm.cmd run build --workspace=@govos/web`; 66 modules, Vite 5.32s | 0 |

## Files changed

- `docs/ecogov/IAM1_MIGRATION27_CHECKSUM_RECONCILIATION_EVIDENCE.md`
- `docs/ecogov/IAM1_GATE1_POST_APPLY_EVIDENCE.md`

Migration 27 and migration 28 files were not edited in this deployment turn. No application code changed.

## Known limitations and boundary

- Migration 27's originally applied source text was not recovered; the authorized checksum repair relies on the approved schema-parity review evidence.
- Migration rollback was not applied to the deployed database. The pre-approved rollback remains restricted to pre-activation/disposable use.
- Existing test fixtures produce deprecation and unavailable-local-webhook warnings, but all assertions passed.
- Bootstrap and Gate 2 authentication remain explicitly out of scope and were not started.

Commit: commit containing this evidence; exact hash is recorded in the final handoff.

Working tree: expected clean after commit; final status is recorded in the handoff.
