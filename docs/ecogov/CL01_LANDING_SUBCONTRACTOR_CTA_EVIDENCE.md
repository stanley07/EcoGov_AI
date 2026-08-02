# CL-0.1 — Landing-Page Subcontractor Acquisition Entry Point Evidence

Date: 2026-08-02

Branch: `codex/implementation`
Commit hash: current commit containing this evidence (`git log -1 --format=%H`)

## Final gate status

Implementation verification passed. CL-0.1 is ready for owner review but is not framework-complete until the independent Antigravity review and acceptance steps occur.

## Files changed

- `apps/web/src/LandingPage.tsx`
- `apps/web/src/layout/routes.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/__tests__/landing-subcontractor-acquisition.test.ts`
- `docs/ecogov/CL01_IMPLEMENTATION_PLAN.md`
- `docs/ecogov/CL01_LANDING_SUBCONTRACTOR_CTA_EVIDENCE.md`

The pre-existing owner modification to `docs/ecogov/GOVOS_ENGINEERING_IMPLEMENTATION_FRAMEWORK_v1.0.md` was preserved and excluded from this milestone commit.

## Before and after

Before CL-0.1, the landing page lacked the approved three-action hero, its header exposed only portal login, and its onboarding panel used generic language and legacy hashes. After CL-0.1, unauthenticated visitors can discover facility registration, the existing subcontractor application, public licence verification, and Login from the responsive header. The hero repeats the three commercial actions, and the Environmental Operations Partner section presents all six approved benefits plus qualification wording without promising automatic approval, guaranteed work, exclusive territory, immediate issuance, or unsupported endorsement.

## Route and component reuse

- `#/subcontractor-apply` is registered in the existing EMIS-1B.2 registry as public and renders the existing `ApplicationWizard`; no second form was created.
- `#/marketplace/apply` remains a public compatibility alias.
- `#/verify-licence` is registered through the same route mechanism as public.
- Public application resolution returns `requiresLogin: false`. Native hash history supplies Back behavior, and startup hash resolution supports refresh.

## Focused verification

`npx.cmd vitest run apps/web/src/__tests__/landing-subcontractor-acquisition.test.ts apps/web/src/layout/routing.test.ts --fileParallelism=false`

Exit 0; 2 files and 18 tests passed in 3.17 seconds. Coverage includes CTAs, public access, registration, verification routing, mobile behavior, focus, Login, branding, and component reuse.

`npx.cmd eslint apps/web/src/LandingPage.tsx apps/web/src/layout/routes.ts apps/web/src/__tests__/landing-subcontractor-acquisition.test.ts apps/web/src/main.tsx`

Exit 0.

## Full regression verification

`node run_with_env.js npx.cmd vitest run --fileParallelism=false`

Exit 0; 61 files and 280 tests passed in 128.18 seconds.

## TypeScript verification

`npx.cmd tsc --noEmit --project apps/web/tsconfig.json`

Exit 0; no web TypeScript errors.

## Production build

`npm.cmd run build --workspace=@govos/web`

Exit 0. `tsc && vite build` transformed 66 modules and completed in 2.45 seconds. Output included `dist/index.html` and `dist/assets/index-BSENBMRC.js`.

## Accessibility and mobile verification

- New actions are native links/buttons with meaningful text; principal hero actions have explicit labels.
- `.landing-action:focus-visible` supplies a 3px yellow outline with 3px offset, independent of hover.
- Actions preserve at least 44px touch height.
- Up to 640px, including 360px, header actions wrap and hero actions use full width with `min-width: 0`.
- Wrapping and border-box sizing prevent action widths from producing horizontal overflow.
- Focused automated source-contract tests verify these rules. No browser screenshot run was available in this environment.

## Branding verification

- `/minEnv.jpg` remains in the header and Login modal only (two occurrences).
- `/anambra-state-government.png` remains one occurrence inside the hero.
- The state seal was not moved or duplicated.

## Regression checklist

- Unauthenticated landing default: passed.
- Existing facility-registration handler: passed.
- Public subcontractor CTA and route: passed.
- No login redirect for application: passed.
- Public verification hash: passed.
- Login shortcut/modal: passed.
- Legacy application/status hashes: preserved.
- No database, API, payment, licensing-service, dashboard, facility-backend, or Platform Admin changes: confirmed by scoped diff.
- No duplicate application component: passed.

## Known limitations

- No deployed public licence-verification UI component exists in the repository. CL-0.1 registers the public hash and shows an honest availability panel rather than inventing an implementation.
- The preserved facility-registration action follows existing behavior and opens Login before the authenticated facility workflow.
- Responsive verification uses focused CSS/source tests rather than browser screenshots.
- Framework completion awaits independent Antigravity review and approval.

## Working-tree status

All CL-0.1 files are in the commit containing this evidence. The tree retains only the pre-existing unstaged owner modification to `docs/ecogov/GOVOS_ENGINEERING_IMPLEMENTATION_FRAMEWORK_v1.0.md`; repository-wide status is intentionally not clean, while CL-0.1 scope is clean.
