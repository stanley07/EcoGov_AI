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
| `node run_with_env.js npx.cmd vitest run --fileParallelism=false` | 1 | 57 test files; 24 passed, 33 failed. 251 tests; 135 passed, 77 failed, 39 skipped. All observed failures were integration tests attempting to connect to unavailable PostgreSQL at `127.0.0.1:5433`. Frontend tests passed. |
| `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 | EMIS-1B.1 web TypeScript check passed with no diagnostics. |
| `npm.cmd run build` | 1 | Root build stopped in the root TypeScript build on existing `packages/ai/dist` TS5055 collisions and existing marketplace test type diagnostics. |
| `npm.cmd run build --workspace=@govos/web` | 0 | Phase-specific production build passed: 63 modules transformed; `dist/index.html` 0.88 kB and JS bundle 378.10 kB (93.61 kB gzip). |
| `git diff --name-status main -- packages/ai packages/testing/src/facility-thumbnails.test.ts packages/testing/src/fixtures/marketplace-demo-scenario.ts packages/testing/src/subcontractor-marketplace-e2e.test.ts packages/testing/src/subcontractor-marketplace-resilience.test.ts` | 0 | No output: every path producing the root TypeScript diagnostics is unchanged from clean `main`. |
| `git diff --check` | 0 | No whitespace errors. |

The required full Vitest run could not be made green because Docker was not running and no process was listening on port 5433. No database/service changes were made to bypass that environmental dependency.

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
- Full integration tests require PostgreSQL on `127.0.0.1:5433`; Docker was unavailable during this verification.
- The root build has pre-existing TypeScript failures in paths identical to `main`; the scoped web TypeScript check and web production build pass.

## Working-tree status

The working tree was clean immediately after implementation commit `a8b44c39ae2e3b37fbc9fe630580891880926017`. This evidence file is committed separately so it can record the immutable implementation commit hash. Final status is recorded in the completion response after the evidence commit and push.
