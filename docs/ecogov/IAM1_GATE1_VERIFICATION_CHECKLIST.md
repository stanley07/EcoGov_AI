# IAM-1 Gate 1 Verification Checklist

## Review gate

- [x] Engineering framework read.
- [x] Deployed cross-tenant membership count is 0.
- [x] Deployed duplicate NULL-organization assignment count is 0.
- [x] Highest deployed and repository migration is 27 before drafting.
- [x] Migration filename is `000028_iam_membership_tenant_integrity.sql`.
- [ ] Antigravity approves migration design and SQL.

## Pre-application safety

- [ ] Repeat the `0 / 0 / 27` preflight immediately before application.
- [ ] Confirm migration 28 has not appeared on another branch/deployment.
- [ ] Create a target backup and prove it restores.
- [ ] Capture membership row count and identity/ownership checksum.
- [ ] Confirm no incompatible membership status/version columns exist.
- [ ] Confirm no missing or cross-tenant referenced entities exist.

## Isolated migration verification

- [ ] Apply migrations 1–28 to a clean disposable database.
- [ ] Apply 000028 to a representative restored disposable database.
- [x] Transactional draft validation confirmed `status` is non-null and defaults to `active`.
- [x] Transactional draft validation confirmed `version` is non-null and defaults to 1.
- [ ] Confirm invited-user backfill uses matching user and membership tenants.
- [x] Transactional draft validation confirmed all four composite foreign keys exist and are validated.
- [ ] Confirm cross-tenant user, role, organization, and department assignments fail.
- [x] Transactional draft validation confirmed both current-assignment partial unique indexes exist.
- [ ] Confirm duplicate NULL-organization current assignments fail.
- [ ] Confirm a revoked historical assignment permits a new current assignment.
- [ ] Confirm legacy single-column foreign keys remain.
- [x] Execute the SQL a second time and confirm no-op schema/data behavior.

## Rollback and regression

- [ ] Test pre-activation rollback on a disposable database.
- [ ] Re-apply 000028 after rollback.
- [ ] Run `node run_with_env.js npx.cmd vitest run --fileParallelism=false`.
- [ ] Run `npx.cmd tsc --noEmit --project apps/web/tsconfig.json`.
- [ ] Run `npm.cmd run build --workspace=@govos/web`.
- [ ] Confirm final cross-tenant and duplicate counts remain zero.
- [ ] Confirm working tree contains only approved migration/documentation artifacts.

Unchecked items require migration review approval or a post-approval disposable/application verification run. They are not claimed complete at this drafting gate.
