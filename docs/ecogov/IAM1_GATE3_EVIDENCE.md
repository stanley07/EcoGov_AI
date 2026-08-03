# IAM-1 Gate 3 Evidence

Date: 2026-08-03

## Summary

Gate 3 implements the approved tenant role catalog, granular tenant user/invitation APIs, and responsive Users & Access frontend. No schema migration, platform-role mutation, persisted subcontractor role, or general MFA-reset UI/API was introduced.

## Catalog reconciliation

Target: canonical EcoGov tenant. The first guarded application created exactly two roles (`environmental_consultant`, `finance_officer`), six missing granular permission records, and 35 approved mappings. It changed zero memberships, created zero platform mappings, and created zero foreign-tenant mappings. The second application returned `noOp=true` with zero created roles, permissions, or mappings.

Post-reconciliation parity:

- Operational: 12/12
- Granular IAM: 9/9
- Privileged tenant security: 3/3
- `user:write` compatibility: 1/1
- Exact `super_admin` manifest: 25/25
- Persisted `subcontractor` roles: 0

## Files changed

- `package.json`
- `modules/govos-core/src/index.ts`
- `modules/govos-core/src/iam/tenant-role-catalog.ts`
- `scripts/iam/reconcile-tenant-role-catalog.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/tenant-iam.ts`
- `apps/web/src/LandingPage.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/layout/navigationConfig.ts`
- `apps/web/src/layout/routes.ts`
- `apps/web/src/iam/UsersAccessPage.tsx`
- `packages/testing/src/iam-gate3-role-catalog.test.ts`
- `packages/testing/src/iam-gate3-api-contract.test.ts`
- `apps/web/src/__tests__/iam-gate3-users-access.test.ts`
- Gate 3 plan, checklist, rollback, and evidence documents.

## Verification results

- Focused command: `node run_with_env.js npx.cmd vitest run packages/testing/src/iam-gate3-role-catalog.test.ts packages/testing/src/iam-gate3-api-contract.test.ts apps/web/src/__tests__/iam-gate3-users-access.test.ts apps/web/src/layout/routing.test.ts --fileParallelism=false`
  - Exit 0; 4 files, 29/29 tests passed; final duration 7.49 seconds.
- Full command: `node run_with_env.js npx.cmd vitest run --fileParallelism=false`
  - Exit 0; 69 files, 348/348 tests passed; final duration 184.10 seconds.
- TypeScript: database, domain, infrastructure, core, API, worker, and web all exit 0.
- Builds: core and API exit 0; web production build exit 0, 69 modules transformed, Vite 3.65 seconds.
- `git diff --check`: recorded at final handoff.

## Final deployed invariants

- Highest migration: 28
- Cross-tenant memberships: 0
- Duplicate current memberships: 0
- Duplicate pending invitations: 0
- Foreign role-permission mappings: 0
- Tenant platform-permission mappings: 0
- Approved seeded roles: 2
- Active tenant super administrators: 1
- Owner account: active
- Owner platform-role assignments: 0

Role and status mutation paths delete sessions only with exact target tenant/user predicates. Focused contract evidence verifies the invalidation primitive; no live owner or invitation state was mutated to test it.

## Security and limitations

- Frontend permission reconstruction remains a visibility mechanism; backend database permissions are authoritative.
- Organization-admin assignment is excluded until organization-scoped delegation is implemented.
- `user:write` remains mapped for legacy callers only and is a P2 removal item after migration of legacy routes.
- General MFA reset remains deferred.
- The current UI uses browser-native confirmation/prompt dialogs for role/status reasons; these are keyboard accessible but may be replaced with shell-native trapped dialogs as a reviewed UX improvement.

Commit hash and clean working-tree status are recorded in the final handoff because a commit cannot contain its own hash.
