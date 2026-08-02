# Implementation Plan: EMIS-1B.2 — Hash Routing & Redirection Guards

Status: Approved  
Authority: GovOS Engineering Implementation Framework v1.0 and EMIS-1 architecture specification

## Objectives

Provide stable native browser hash routing and authentication/permission guards around the EMIS-1B.1 application shell.

## Scope

- Synchronize registered `window.location.hash` routes with legacy React `activeTab` state.
- Preserve refresh, deep links, browser back/forward navigation, normalization, and facility identifiers.
- Store validated unauthenticated private targets in `sessionStorage` as `govos.auth.returnTo` and consume them after login.
- Resolve permission requirements using `resolveSessionPermissions` and platform access using `canViewPlatformAdmin`.
- Adapt Sidebar and Guided Demo tab navigation through `navigateLegacyTab`.
- Render `AccessDeniedPage` for unauthorized routes and `ModuleAvailabilityPanel` for authorized planned modules.
- Add focused routing, normalization, redirect-security, and authorization tests.

## Out of scope

- React Router or any routing dependency.
- Backend API or authentication-protocol changes.
- PostgreSQL schema or data changes.
- Dashboard metrics, KPI calculations, navigation ordering, new permissions, or new role scopes.
- EMIS-1B.3, timeline services, GIS implementation, audits, inspections, permits, or other future modules.

## Architectural impact

The route registry is the allowlist and translation boundary. Native `hashchange` events drive synchronization; there is no routing poller or timer. Existing views and the `activeTab` rendering model remain intact behind the adapter.

## Database and API changes

None.

## UI and workflow changes

- Public marketplace routes render outside the authenticated shell.
- Private deep links preserve their registered target through login.
- Unauthorized content never becomes the selected page view.
- Invalid and malformed hashes normalize to the authorized default.
- Planned routes preserve the existing inline availability panels.

## Testing strategy

- Focused pure routing tests for casing, slash normalization, dynamic IDs, malformed input, external redirects, traversal, return-target lifecycle, permissions, platform boundaries, public routes, defaults, and legacy navigation.
- Existing shell authorization tests.
- Full sequential Vitest regression suite.
- Web TypeScript, focused ESLint, and production web build.

## Acceptance criteria

- Native event-driven routing with no React Router, polling, or routing timers.
- Hash and `activeTab` remain synchronized through navigation history.
- Only registry routes can become redirect targets.
- Authentication and permission boundaries prevent protected content selection.
- EMIS-1B.1 shell, accessibility behavior, navigation ordering, existing marketplace, facility, workbench, settings, platform, demo, and logout flows remain operational.
- All focused and regression tests, TypeScript, and production build pass.
- Evidence is produced and the scoped commit is pushed to `origin/codex/implementation` for Antigravity review.
