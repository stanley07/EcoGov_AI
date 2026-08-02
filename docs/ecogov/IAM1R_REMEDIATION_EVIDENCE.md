# IAM-1R — Cross-Tenant Membership Remediation Evidence

Status: **PASS — remediation and fixture-leak verification complete**

Date: 2026-08-02

Branch: `codex/implementation`

Commit: commit containing this evidence; resolve with `git log -1 --format=%H`

## Scope and authorization

The original IAM-1R remediation was followed by the Antigravity-authorized narrow fixture correction and exact leaked-row cleanup. No production source, migration 000028, IAM-1 API/UI, Quick Access, role service, or membership service was changed.

Cleanup authorization: the 2026-08-02 IAM-1R instruction explicitly authorized deleting membership `11bf98c3-4d95-4ae6-b88a-ade7c9aac245` after all predicates were verified.

## Files changed

- `packages/testing/src/facility-thumbnails.test.ts`
- `packages/testing/src/facility-registry-backend.test.ts`
- `packages/testing/src/iam-cross-tenant-remediation.test.ts`
- `scripts/iam/remediate-cross-tenant-memberships.ts`
- `scripts/iam/verify-cross-tenant-memberships.ts`
- `scripts/iam/rollback-cross-tenant-memberships.ts`
- `docs/ecogov/IAM1R_REMEDIATION_EVIDENCE.md`
- `docs/ecogov/IAM1R_POST_REMEDIATION_REPORT.md`

The IAM scripts and focused remediation test are the previously authorized, uncommitted IAM-1R artifacts retained from the interrupted verification. The only fixture corrections in this verification pass are the two named facility tests.

## Original remediation result

- Approved action: `SEED_AND_MAP_ROLE`
- Approved mappings: 14
- Before remediation: 14 cross-tenant memberships
- After remediation: 0 cross-tenant memberships
- Tenant-local canonical roles created: 14
- Permission parity: 14 of 14, each with the approved 19 tenant permissions and no platform permission
- Sessions revoked: 14
- Audit entries: 14
- Apply correlation ID: `307a1607-b9bc-425e-8910-7ff3251989ac`
- Backup: `C:\tmp\govos_iam1r_pre_remediation_20260802_1502.dump` (1,203,290 bytes)
- Restore verification: passed; restored snapshot contained 53 memberships, 14 cross-tenant memberships, and maximum migration 27

## Root cause and exact cleanup

The unsafe fixture query was:

```sql
SELECT id FROM role WHERE name = $1
```

Both affected fixtures could select the template tenant's `super_admin` role. `facility-thumbnails.test.ts` additionally omitted Tenant A sessions, memberships, users, roles, and tenant records from teardown.

The replacement is tenant-scoped:

```sql
SELECT id FROM role WHERE name = $1 AND tenant_id = $2
```

When absent, the fixture creates a canonical same-tenant test role; it never falls back to the template role. Each membership insert is followed by an executable user/membership/role tenant-equality invariant.

Before deletion, the leaked row was verified as follows:

- exact membership ID: `11bf98c3-4d95-4ae6-b88a-ade7c9aac245`
- membership and user tenant: `17c41a1a-c388-4f13-8a70-8fbd2ee8f780`
- user email: `user-f060b156@gov.ng`
- referenced role: `00000000-0000-0000-0000-000000000501`
- role tenant: `00000000-0000-0000-0000-000000000001`
- role tenant differed from membership tenant: true
- membership was not in the authoritative approved 14: true

The exact-ID and exact-tenant transactional delete returned `deleted_count=1`; all other rows were untouched. The first guard attempt safely rolled back because PostgreSQL eagerly evaluated a constant `1/0` expression; the corrected guard used the deleted-row count as its divisor and committed exactly one deletion.

## Teardown correction

`facility-thumbnails.test.ts` now removes both Tenant A and Tenant B data in dependency order: facility documents, facilities, organizations, sessions, memberships, users, fixture roles, LGAs, clusters, and tenants. `afterAll` runs after assertion failures and `finally` always closes the pool.

`facility-registry-backend.test.ts` now removes the primary and secondary tenant memberships and fixture-created roles before tenant deletion. Its tenant-role lookup and post-insert invariant are tenant-safe.

## Repository-wide scan

Searches covered test/fixture/helper TypeScript for role-name selects, membership inserts, role IDs, and membership teardown.

- No remaining `SELECT id FROM role WHERE name = $1` without `tenant_id` was found.
- The two equivalent unsafe lookups were the authorized facility fixtures and both were fixed.
- `subcontractor-commercial-launch.test.ts` inserts a membership only after creating a unique role with the same `tenant.id`; it does not reuse a template/default role and was not changed.
- The scan noted that commercial-launch fixture cleanup is broader test hygiene work, but it is not an equivalent cross-tenant lookup defect and is outside this authorization.

## Verification sequence and results

All database checks used PostgreSQL 18.4 on port 5433, database `govos_db`.

1. Authorized leaked-row evidence query — exit 0; all predicates true.
2. Exact transactional delete — exit 0; one row deleted.
3. Cross-tenant preflight — exit 0; count 0.
4. `node run_with_env.js npx.cmd vitest run packages/testing/src/facility-thumbnails.test.ts --fileParallelism=false` — exit 0; 1 file, 4/4 tests; 4.68s.
5. Cross-tenant preflight — exit 0; count 0.
6. `node run_with_env.js npx.cmd vitest run packages/testing/src/facility-registry-backend.test.ts --fileParallelism=false` — exit 0; 1 file, 12/12 tests; 4.01s.
7. Cross-tenant preflight — exit 0; count 0.
8. Repeated combined fixture run 1 — exit 0; 2 files, 16/16 tests; 7.16s.
9. Repeated combined fixture run 2 — exit 0; 2 files, 16/16 tests; 7.32s.
10. Final-state focused command including IAM-1R — exit 0; 3 files, 26/26 tests; 8.86s.
11. Final-state repeated fixture command — exit 0; 2 files, 16/16 tests; 7.94s.
12. `node run_with_env.js npx.cmd tsx scripts/iam/verify-cross-tenant-memberships.ts` — exit 0; cross-tenant 0, approved local 14, permission parity 14, audits 14.
13. `node run_with_env.js npx.cmd vitest run --fileParallelism=false` — exit 0; 62 files, 290/290 tests; 148.71s.
14. Post-suite verifier — exit 0; cross-tenant 0, approved local 14, permission parity 14, audits 14.
15. `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` — exit 0.
16. `npm.cmd run build --workspace=@govos/web` — exit 0; 66 modules; Vite build 3.39s.
17. `node run_with_env.js npx.cmd tsx scripts/iam/remediate-cross-tenant-memberships.ts --dry-run` — exit 0; `noOp=true`, cross-tenant before 0, changed memberships 0, sessions revoked 0, audit events written 0.

The initial sandboxed focused-test attempt exited 1 before test collection because esbuild could not read the repository parent. The identical command was rerun with approved execution access and passed; it is an environment startup event, not a failed test assertion.

## Final gate

- Cross-tenant membership count: 0
- Approved mappings unchanged and correct: 14/14
- Full regression: passed
- Web TypeScript: passed
- Production web build: passed
- Final IAM-1R dry run: no-op
- Migration 000028: not created
- Production source: unchanged
- Working tree: expected clean after the commit; final status and exact commit hash are recorded in the handoff.
