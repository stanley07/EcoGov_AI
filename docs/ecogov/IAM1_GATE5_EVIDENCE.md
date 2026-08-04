# IAM-1 Gate 5 Evidence

Status: Gates passed; delivery commit pending

## Scope delivered

- Organization list, detail, create, versioned update, suspension/reactivation, and archive controls.
- Tenant- and organization-scoped membership add, role/status update, transfer, removal, session invalidation, and protected organization-administrator assignment/removal.
- Organization-scoped invitation creation/listing using the existing encrypted notification outbox and invitation acceptance lifecycle.
- Delegated Gate 4 security actions restricted to same-organization, non-administrator users.
- Organizations list/detail UI with Users, Invitations, Settings, Security, administrator assignment, status, role, transfer, and removal controls.
- Explicit ID-only audit events for organization, membership, administrator, invitation, denial, and delegated actions.

## Database and catalog

- Fresh pre-migration custom-format backup: `C:\tmp\govos_db_iam_gate5_pre_000030.dump`; `pg_restore --list` readable, 543 TOC entries.
- Official runner applied `000030_iam_organization_delegation.sql`: exit 0, one migration applied.
- Immediate official-runner rerun: exit 0, zero migrations applied.
- Highest migration after apply: 30; checksum mismatches: 0.
- `organization.version`, `organization.archived_at`, and `user_invitation.organization_id` exist.
- All three new constraints are validated; both new indexes exist.
- Guarded catalog reconciliation first run: 13 `organization_admin` mappings, zero role/permission/membership/platform/foreign changes.
- Catalog second run: no-op; zero changes.
- `super_admin`: 25 permissions; `organization_admin`: 13 permissions; platform permissions: 0.
- Final counts: cross-tenant memberships 0; cross-organization violations 0; duplicate current memberships 0; duplicate pending invitations 0; forbidden/cross-tenant/platform mappings 0.

## Role matrix

| Role | Scope | Gate 5 assignment |
| --- | --- | --- |
| `super_admin` | Tenant-wide, protected | Never through organization endpoints |
| `director` | Tenant-wide, protected from delegation | Not assignable by organization admin |
| `finance_officer` | Tenant-wide, protected from delegation | Not assignable by organization admin |
| `organization_admin` | One organization, protected | Tenant super-admin only |
| `inspector` | Organization-scoped | Same-organization admin permitted |
| `environmental_consultant` | Organization-scoped | Same-organization admin permitted |
| `citizen` | Organization-scoped | Same-organization admin permitted |

`subcontractor` remains a non-persisted business/UI alias for `environmental_consultant`.

## Verification commands and results

- Focused: `node run_with_env.js npx.cmd vitest run packages/testing/src/iam-gate4-tenant-login.test.ts packages/testing/src/iam-gate5-organization-administration.test.ts apps/api/tests/platform-admin.test.ts --fileParallelism=false` — exit 0; 3/3 files, 41/41 tests, 10.23s.
- Gate 5/catalog focused run — exit 0; 2/2 files, 12/12 tests.
- Full: `node run_with_env.js npx.cmd vitest run --fileParallelism=false --reporter=dot` — exit 0; 72/72 files, 370/370 tests, 216.45s (final post-safeguard run).
- TypeScript `--noEmit`: configuration, database, domain, infrastructure, observability, core, API, worker, and web — all exit 0.
- Production builds: database, core, API, AI, worker, and web — all exit 0. The worker required only `tsc --build packages/ai/tsconfig.json --clean` to clear stale generated declarations; no source workaround was made. Web: 73 modules, 427.10 kB JS (105.42 kB gzip), 4.43s.
- `node run_with_env.js node scripts/iam/iam-gate5-preflight.mjs` — exit 0, final integrity values above.
- `git diff --check` — exit 0.

## Exact files

- `apps/api/src/routes/account-security.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/organizations.ts`
- `apps/api/src/routes/tenant-iam.ts`
- `apps/api/tests/platform-admin.test.ts`
- `apps/web/src/iam/OrganizationDetailPage.tsx`
- `apps/web/src/iam/OrganizationsPage.tsx`
- `apps/web/src/layout/navigationConfig.ts`
- `apps/web/src/layout/routes.ts`
- `apps/web/src/main.tsx`
- `modules/govos-core/src/iam/tenant-role-catalog.ts`
- `packages/database/migrations/000030_iam_organization_delegation.sql`
- `packages/testing/src/iam-gate5-organization-administration.test.ts`
- `scripts/iam/iam-gate5-preflight.mjs`
- The four Gate 5 documents in `docs/ecogov`.

## Security and limitations

- New handlers use exact granular permissions; `user:write`, wildcards, and `platform.*` are absent.
- Tenant-wide IAM endpoints explicitly reject `organization_admin`; every delegated data query binds tenant and organization.
- Organizations with current users cannot be archived, no physical-delete endpoint exists, final active administrators are protected, and the data model has no organization hierarchy in which ownership loops could form.
- The compact administration UI uses explicit role/organization IDs in prompts; catalog-backed selectors are a future usability enhancement, not an authorization dependency.
- Commit hash and final clean working-tree status are recorded in the delivery report because a commit cannot contain its own hash.
