# EMIS-1B.1 Shell Foundation Evidence

Date: 2026-08-02

Branch: `codex/implementation`

Implementation commit: `a8b44c39ae2e3b37fbc9fe630580891880926017`

## Scope and files changed

The implementation commit changes only the shell foundation and its `main.tsx` strangler integration:

- `apps/web/src/layout/AppShell.tsx`
- `apps/web/src/layout/Sidebar.tsx`
- `apps/web/src/layout/TopBar.tsx`
- `apps/web/src/layout/Breadcrumb.tsx`
- `apps/web/src/layout/PageContainer.tsx`
- `apps/web/src/layout/AppErrorBoundary.tsx`
- `apps/web/src/layout/LoadingBoundary.tsx`
- `apps/web/src/layout/ModuleAvailabilityPanel.tsx`
- `apps/web/src/layout/AccessDeniedPage.tsx`
- `apps/web/src/main.tsx`
- `docs/ecogov/EMIS1B1_EVIDENCE.md` (evidence follow-up)

`PermissionGate.tsx` was reviewed and required no change. No router, route registry, dashboard redesign, timeline service, migration, database object, or new EMIS module was added.

## Component tree

```text
App
├── LandingPage (unauthenticated; unchanged)
└── AppShell
    ├── Sidebar (desktop)
    ├── TopBar
    │   └── Breadcrumb
    ├── main#main-content
    │   └── PageContainer
    │       └── AppErrorBoundary
    │           └── legacy activeTab view
    │               ├── PermissionGate (available to views)
    │               ├── LoadingBoundary (available to views)
    │               ├── ModuleAvailabilityPanel (planned-state messaging)
    │               └── AccessDeniedPage (access-state messaging)
    └── mobile navigation dialog
        └── Sidebar (mobile instance)
```

## Navigation authority

The legacy `activeTab` React state is the only navigation authority in `main.tsx`. Sidebar selections, wizard completion/cancellation, access-denied recovery, Guided Demo navigation, login defaults, and logout all transition through `setActiveTab`.

The EMIS-1B.1 integration contains no `HashRouter`, route-registry import, `hashchange` listener, or `window.location.hash` synchronization. URL routing is deliberately deferred.

## Exact verification commands and results

| Command | Exit code | Result |
| --- | ---: | --- |
| `node run_with_env.js npx vitest run --pool=threads --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1` | 0 | Authoritative sequential suite passed: 57/57 test files and 251/251 tests in 135.16 seconds. No tests failed or were skipped. |
| `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 | EMIS-1B.1 web TypeScript check passed with no diagnostics. |
| `npm run build` | 1 | PowerShell selected the disabled `npm.ps1` shim before npm executed. The command was rerun through `cmd.exe` as described below. |
| `cmd.exe /d /s /c "npm run build"` | 1 | Root build ran and stopped in the root composite TypeScript build on pre-existing `packages/ai/dist` TS5055 collisions and existing marketplace test type diagnostics. The diagnostic paths are unchanged from `main` and do not include EMIS-1B.1 files. |
| `cmd.exe /d /s /c "npx tsc --noEmit"` | 0 | Repository root no-emit TypeScript check passed with no diagnostics. |
| `npm.cmd run build --workspace=@govos/web` | 0 | Phase-specific production build passed: 63 modules transformed; `dist/index.html` 0.88 kB and JS bundle 378.10 kB (93.61 kB gzip). |
| `git diff --name-status main -- packages/ai packages/testing/src/facility-thumbnails.test.ts packages/testing/src/fixtures/marketplace-demo-scenario.ts packages/testing/src/subcontractor-marketplace-e2e.test.ts packages/testing/src/subcontractor-marketplace-resilience.test.ts` | 0 | No output: every path producing the root TypeScript diagnostics is unchanged from clean `main`. |
| `git diff --check` | 0 | No whitespace errors. |

## PostgreSQL verification

A read-only runtime query connected to `govos_db` on `127.0.0.1:5433` and executed `SELECT version(), pg_backend_pid()` successfully:

- Version: PostgreSQL 18.4, 64-bit Windows build
- Database: `govos_db`
- Port: 5433
- Backend PID observed during verification: 11256
- Connection/result status: passed (exit code 0)

The restored database resolved all prior connection failures. The authoritative sequential suite now passes in full.

## Accessibility evidence

| Requirement | Evidence |
| --- | --- |
| Skip-to-content | `AppShell` provides a focus-revealed `Skip to main content` link targeting focusable `main#main-content`. |
| `aria-expanded` | Top-bar mobile toggle and sidebar group toggles expose current expanded state. Group toggles have instance-unique `aria-controls` targets. |
| Mobile focus movement | Opening the drawer records the active element and moves focus to the first focusable drawer control (the close button), falling back to the drawer container. |
| Focus trap | Tab and Shift+Tab wrap between the first and last focusable drawer controls. |
| Escape close | Escape closes the open mobile drawer. |
| Backdrop close | Pointer activation of the backdrop closes the drawer. The decorative backdrop is hidden from the accessibility tree. |
| Focus restoration | Closing restores focus to the element active before the drawer opened. |
| Body-scroll locking | Drawer open stores the prior body overflow value, applies `overflow: hidden`, and restores the exact prior value on close/unmount. |
| Keyboard-visible focus | Shell navigation, mobile controls, logout, breadcrumb actions, error recovery, and access-denied recovery provide visible focus rings. |
| Status semantics | Loading and module-availability states use live status semantics; permission denial uses alert semantics; decorative icons are aria-hidden. |

## Responsive evidence

The shell breakpoint is `max-width: 1024px`; the desktop sidebar is hidden and the 44-by-44-pixel mobile menu control is shown at and below that breakpoint. The top-bar user summary is hidden at mobile/tablet sizes. `PageContainer` uses fluid width, border-box sizing, 24-pixel padding, and a 1280-pixel maximum.

| Viewport | Verified shell mode | Expected layout evidence |
| ---: | --- | --- |
| 360px | Mobile | Desktop sidebar hidden; mobile toggle visible; drawer width 280px, leaving backdrop space; content remains fluid. |
| 768px | Tablet | Desktop sidebar hidden; mobile toggle visible; drawer remains 280px; main content uses available width. |
| 1024px | Breakpoint/mobile | `max-width: 1024px` rules apply; desktop sidebar hidden and mobile toggle visible. |
| 1440px | Desktop | 260px sticky sidebar visible; mobile toggle hidden; remaining main width is fluid; page content caps at 1280px. |

This evidence is based on the implemented deterministic CSS breakpoint and sizing rules plus the successful Vite production transformation. Automated screenshot comparison is not configured in this repository.

## Regression checklist

- [x] Public landing page remains the unauthenticated entry.
- [x] Login form and quick-login behavior remain connected.
- [x] Dashboard rendering remains selected by `activeTab`.
- [x] Facility Registry remains selectable.
- [x] `+ Register Facility` remains present.
- [x] Facility registration modal/wizard remains mounted and its completion/cancellation transitions are preserved.
- [x] Facility detail drawer remains mounted.
- [x] Officer queue remains selectable.
- [x] Marketplace application and analytics surfaces remain present.
- [x] Application-status surface remains present.
- [x] Settings remains selectable.
- [x] Platform Admin remains the platform-tenant default and remains selectable for that boundary.
- [x] Guided Demo remains mounted and navigates through `setActiveTab`.
- [x] Logout still clears session storage and returns legacy state to the dashboard default.

## Known limitations

- URL/deep-link routing is intentionally absent; `activeTab` is in-memory navigation state.
- The repository has no configured browser screenshot/a11y automation, so viewport and interaction evidence is code-path/static-CSS verification rather than screenshot baselines.
- The root composite build has pre-existing TypeScript failures in paths identical to `main`; root no-emit TypeScript, scoped web TypeScript, the web production build, and the full test suite pass.

## Final gate status

**EMIS-1B.1 gate: PASS.** The authoritative test suite, repository no-emit TypeScript check, scoped web TypeScript check, and scoped production build are green. The root composite build remains blocked only by confirmed baseline diagnostics outside EMIS-1B.1; no unrelated fixes were made.

## P1 findings and safe P2 cleanup verification

Follow-up implementation commit: `09c5ed911f7b059ade3bf7ac6f3e4e422d9f6b1e`

### Exact files changed

- `apps/web/src/layout/Breadcrumb.tsx`
- `apps/web/src/layout/Sidebar.tsx`
- `apps/web/src/layout/shellAuthorization.ts`
- `apps/web/src/layout/shellAuthorization.test.ts`
- `apps/web/src/main.tsx`
- `docs/ecogov/EMIS1B1_EVIDENCE.md` (evidence follow-up)

### Findings resolved

- P1 breadcrumb focus: interactive breadcrumb buttons now use a CSS `:focus-visible` rule with a three-pixel high-contrast outline and offset. The style is keyboard-triggered, independent of hover, and does not alter layout geometry.
- P1 Platform Admin visibility: shell visibility now requires both canonical `SYSTEM_TENANT_ID` membership and the exact resolved `PlatformPermission.TENANT_READ` claim from the existing `PLATFORM_ROLE_PERMISSIONS` contract. There is no ad hoc direct role-name authorization check. The browser gate hides navigation and content; backend APIs remain authoritative.
- P2 `pageTitle`: retained because `AppShell` uses it meaningfully as the accessible label for `main#main-content`.
- P2 mobile backdrop: confirmed `aria-hidden="true"` is present while backdrop-click close remains intact; no additional code change was necessary.
- P2 logout colors: default is `#ef4444`, hover is `#f87171`, and mouse leave restores `#ef4444`.
- P2 denied metadata: `denied` explicitly resolves to title `Access Restricted` and breadcrumbs `EcoGov / Restricted`.
- P2 brand failure: `/minEnv.jpg` failure switches once to a CSS/text `EG` branded placeholder; the failed image is removed, preventing an error loop.

### Follow-up commands and results

| Command | Exit code | Result |
| --- | ---: | --- |
| `node run_with_env.js npx.cmd vitest run apps/web/src/layout/shellAuthorization.test.ts packages/testing/src/platform-admin-permissions.test.ts packages/testing/src/architecture.test.ts --fileParallelism=false` | 0 | Focused shell, backend permission, and architecture verification passed: 3/3 files and 8/8 tests. This proves system-tenant denial without platform permission, authorized platform-admin visibility, ordinary-tenant denial, and backend 403 enforcement. |
| `node run_with_env.js npx.cmd vitest run --fileParallelism=false` | 0 | Final authoritative sequential suite passed: 58/58 files and 254/254 tests in 131.42 seconds. |
| `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 | Web TypeScript passed with no diagnostics. |
| `npm.cmd run build` | 1 | Root composite build remains stopped by the previously confirmed baseline `packages/ai/dist` TS5055 collisions and unrelated marketplace test type diagnostics; no EMIS-1B.1 path is reported. |
| `npm.cmd run build --workspace=@govos/web` | 0 | Scoped production build passed: 65 modules transformed in 2.68 seconds; JS bundle 379.50 kB (94.07 kB gzip). |
| PostgreSQL `SELECT version(), pg_backend_pid()` | 0 | PostgreSQL 18.4 connected on `govos_db` at port 5433; backend PID 2732 observed for the final availability check. |

### Follow-up gate status

**PASS.** Both P1 findings and all safe P2 cleanups are resolved or confirmed already compliant. All focused tests, the full sequential suite, web TypeScript, architecture validation, and the scoped production build pass. The root composite-build baseline remains outside EMIS-1B.1 and was not modified.

## Working-tree status

The working tree was clean immediately after follow-up implementation commit `09c5ed911f7b059ade3bf7ac6f3e4e422d9f6b1e`. This evidence update is committed separately so it can record the immutable implementation commit hash. Final status is recorded in the completion response after the evidence commit and push.
