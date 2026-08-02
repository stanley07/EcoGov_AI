# EMIS-1B.2 — Hash Routing & Redirection Guards Evidence

Date: 2026-08-02  
Branch: `codex/implementation`  
Implementation status: Ready for Antigravity architecture review  
Commit hash: current commit containing this evidence (`git log -1 --format=%H`)

## Summary

EMIS-1B.2 adds native, registry-allowlisted hash routing around the existing EMIS-1B.1 shell without React Router or backend/database changes. Hash changes drive the legacy `activeTab` adapter, private deep links survive login through a validated session return target, permissions are resolved before selecting protected content, planned modules retain inline availability panels, and public marketplace pages remain outside the authenticated shell.

## Files changed

- `apps/web/src/layout/routes.ts`
- `apps/web/src/layout/routing.test.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/marketplace/public/ApplicationWizard.tsx`
- `apps/web/src/marketplace/public/ApplicationStatusPage.tsx`
- `docs/ecogov/EMIS1B2_IMPLEMENTATION_PLAN.md`
- `docs/ecogov/EMIS1B2_EVIDENCE.md`

The authoritative framework file was read and followed but was not modified by Codex or included in this milestone.

## Architecture and security evidence

- Native `hashchange` listener; no React Router, routing polling, interval, or timeout.
- Registry-only matching for exact and dynamic facility/application/platform routes.
- Canonical lowercase paths, legacy missing-slash compatibility, duplicate-slash cleanup, and trailing-slash removal.
- Malformed URI encoding, control characters, traversal, external URLs, protocol-relative URLs, executable schemes, file/data schemes, and unknown routes are rejected.
- `govos.auth.returnTo` is written only for registered private routes while unauthenticated, consumed after login, and removed for authenticated sessions.
- Route permissions use `resolveSessionPermissions`; platform access uses the canonical system tenant and platform permission check.
- Unauthorized route resolution selects only `AccessDeniedPage` via `#/_denied`; protected panels are not selected.
- Authorized planned modules select the existing `ModuleAvailabilityPanel` views.
- Facility detail hashes restore the registry plus the existing detail drawer.
- Sidebar, breadcrumbs, Guided Demo, wizard completion, facility links, drawer close, and denied-page return actions navigate through canonical hashes.
- Existing route registry labels, groups, breadcrumbs, ordering, and visibility metadata are preserved.

## Exact verification commands

| Gate | Command | Exit | Result |
|---|---|---:|---|
| Focused routing and authorization | `npx.cmd vitest run apps/web/src/layout/routing.test.ts apps/web/src/layout/shellAuthorization.test.ts --fileParallelism=false` | 0 | 2 files, 11 tests passed; final run 2.74s |
| Focused ESLint | `npx.cmd eslint apps/web/src/layout/routes.ts apps/web/src/layout/routing.test.ts apps/web/src/main.tsx` | 0 | No errors or warnings |
| Web TypeScript | `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 | No diagnostics |
| Production web build | `npm.cmd run build --workspace=@govos/web` | 0 | 66 modules transformed; built in 7.95s |
| Sequential regression suite | `node run_with_env.js npx.cmd vitest run --fileParallelism=false` | 0 | 60 files, 270 tests passed; final clean run 136.43s |

One intermediate final-suite run exposed an unrelated timing-sensitive `ai_execution_attempt` timestamp constraint failure. The isolated test immediately passed 6/6, no unrelated code was changed, and the subsequent authoritative full suite passed 270/270.

## Database, API, and recovery

- Database changes: none.
- API changes: none.
- Migration verification and rollback: not applicable.
- Router restart/deep-link behavior is deterministic from `window.location.hash`; focused tests cover registered dynamic deep links and defaults.

## Regression checklist

- EMIS-1B.1 AppShell and PageContainer preserved.
- Breadcrumbs and page titles remain driven by the selected tab.
- Sidebar order and permission visibility unchanged.
- Landing/login and logout preserved.
- Dashboard, Facility Registry, register modal, facility wizard, facility drawer, officer queue, marketplace application/status, settings, Platform Admin, and Guided Demo remain mapped to existing views.
- Skip link, focus styles, mobile shell behavior, PermissionGate, and LoadingBoundary were not altered.
- No unavailable EMIS module was implemented.

## Known limitations and remaining framework gates

- Platform Admin sub-hashes resolve securely to the existing console; internal console tab synchronization remains owned by that legacy console.
- The repository’s existing Guided Demo contains unrelated timers for demo state/message behavior. Hash synchronization itself is entirely event-driven and introduces no timers.
- Antigravity architecture review and final APPROVED/REJECTED decision are still required. Under the framework, this milestone must not be called complete, merged, or tagged before approval.

## Working-tree status

The EMIS-1B.2 implementation is scoped for commit. The framework file contains a pre-existing owner modification and is intentionally excluded from the milestone commit; this prevents a globally empty `git status` until the owner commits or otherwise resolves that authoritative-document change.
