# EMIS2 Slice A Prototype Evidence

**Branch:** `codex/implementation`

## Files and pages

- Updated web composition: `apps/web/src/main.tsx`.
- Updated routing/navigation: `apps/web/src/layout/routes.ts`, `apps/web/src/layout/navigationConfig.ts`.
- Extended facility profile: `apps/web/src/facilities/components/FacilityDetailDrawer.tsx`.
- Added shared responsive design and prototype boundaries under `apps/web/src/environmental/shared` and `environmental.css`.
- Added dedicated pages: Environmental Dashboard, Environmental Audits, Inspections, Incidents, Permits, Compliance, Enforcement Notices, Waste Management, Environmental Monitoring, Environmental Maps, and Reports.

## Routes enabled

- `#/dashboard`
- `#/facilities` and `#/facilities/:facilityId`
- `#/operations/audits`
- `#/operations/inspections`
- `#/operations/incidents`
- `#/operations/permits`
- `#/operations/compliance`
- `#/operations/enforcement`
- `#/waste`
- `#/monitoring`
- `#/gis`
- `#/reports`

## Reused APIs and platform capabilities

- `GET /facilities` for tenant-scoped facility rows and pagination.
- `GET /facilities/:facilityId` for the digital environmental profile.
- Existing facility registration timeline endpoint for profile history.
- Existing session, route permission resolution, RBAC-aware sidebar, mobile app shell, facility registration actions, workflow workspace, and notification-capable platform shell.

## Real data versus prototype data

| Area | Boundary |
| --- | --- |
| Facility totals, status, risk, activity | Current facility API response |
| Facility profile and registration history | Current facility/detail and timeline APIs |
| Facility map markers | Only records with existing non-zero coordinates |
| Report preview and CSV | Current facility API response |
| Audit, inspection and incident examples | Explicitly labelled prototype fixtures |
| Permits, enforcement, waste and monitoring | Explicitly labelled prototype fixtures or honest empty states |
| Compliance score | Transparent five-component prototype formula; not policy or persisted |

## Responsive and accessible behavior

- Existing accessible mobile drawer is preserved.
- Environmental grids collapse to one column below 720 px.
- Desktop tables switch to mobile-safe presentation boundaries without horizontal page overflow.
- Controls use touch-friendly minimum heights, visible focus, semantic labels, tab roles, keyboard-selectable rows, and accessible SVG descriptions.
- Facility tabs scroll horizontally on narrow screens and the detail drawer remains viewport-bound.

## Verification

- Focused EMIS2 tests: 8/8 passed.
- Existing route and shell authorization tests: 11/11 passed.
- Aggregate affected frontend tests: 19/19 passed across 3 files.
- Root `npm run typecheck`: passed.
- Web workspace production build: passed; 88 modules transformed.
- Build outputs: `index.html`, CSS bundle, and JavaScript bundle generated successfully and excluded from the commit.

## Presentation journey

1. Authenticate through the existing login/MFA interface.
2. Open the Environmental Operations Dashboard and show live facility totals and six charts.
3. Open Facilities, select a facility, and traverse the ten profile tabs.
4. Open Inspections and explain the eleven-step WF-1-compatible lifecycle without creating fake work.
5. Open Incidents and show clearly labelled assignment/investigation fixtures.
6. Open Compliance and show the transparent prototype score contribution panel.
7. Open GIS and filter coordinate-qualified facilities by risk.
8. Open the existing My Tasks or notification area for production platform records.
9. Use the existing mobile drawer and stacked environmental layouts at phone/tablet width.

## Known production deferrals

- Environmental operational schema and persistence.
- Complaint-to-incident and workflow-work-item projections.
- Inspection commands and assignment notifications.
- Permit, enforcement, waste, sensor, laboratory, and compliance-policy services.
- Authoritative map tiles/geospatial analysis.
- PDF and Excel export.
