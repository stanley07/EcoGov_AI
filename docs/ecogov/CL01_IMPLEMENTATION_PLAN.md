# Implementation Plan: CL-0.1 — Landing-Page Subcontractor Acquisition Entry Point

Status: Approved by project owner
Objective: Let unauthenticated prospective subcontractors discover and begin the existing EcoGov application process from the public landing page.

## Scope

- Add landing hero actions for facility registration, subcontractor application, and licence verification.
- Add responsive public header links for those actions and Login.
- Add the approved Environmental Operations Partner acquisition content, benefits, and commercial qualification wording.
- Reuse the EMIS-1B.2 route registry and the existing `ApplicationWizard` component.
- Register the approved public `#/subcontractor-apply` and `#/verify-licence` hashes while preserving the legacy marketplace application alias.
- Add focused landing and routing tests plus milestone evidence.

## Out of scope

- Database, API, payment reconciliation, licensing service, marketplace lifecycle policy, facility backend, dashboard, and Platform Admin changes.
- A second application form or subcontractor workflow.
- Implementation of the planned public licence-verification interface.
- Unrelated routing behavior or branding changes.

## Architectural impact

The landing page links into the existing native hash router. The existing application component remains the sole onboarding implementation. Public route resolution does not write an authentication return target or invoke the login guard.

## Database and API changes

None.

## UI and workflow changes

- Public visitors receive clear commercial entry points in the header, hero, and acquisition section.
- Facility registration continues through the existing landing registration/login entry.
- Subcontractor application opens the existing public wizard.
- Licence verification uses the reserved public route without overstating current availability.
- Header and hero actions wrap at mobile widths, retain 44px touch targets, and share a visible `:focus-visible` outline.

## Testing strategy

- Focused source-contract tests for CTA text/routes, public access, registration/login preservation, mobile/focus behavior, branding placement, and component reuse.
- Existing EMIS routing tests.
- Full sequential Vitest, web TypeScript, focused ESLint, and production web build.

## Acceptance criteria

- All requested public actions are visible without authentication.
- `#/subcontractor-apply` resolves publicly to the existing application component with no login redirect.
- `#/verify-licence` is registered as public.
- No duplicate onboarding form is introduced.
- Commercial wording contains no guarantee or automatic-approval claims.
- Branding placement, Login, and facility-registration entry remain intact.
- Focused and full verification gates pass and evidence is pushed to `codex/implementation`.
