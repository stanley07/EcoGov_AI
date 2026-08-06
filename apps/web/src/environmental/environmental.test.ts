import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EnvironmentalDashboardPage } from "./dashboard/EnvironmentalDashboardPage.js";
import {
  calculatePrototypeCompliance,
  classifyPrototypeCompliance,
} from "./compliance/CompliancePage.js";
import { facilitiesToCsv } from "./reports/ReportsPage.js";
import { prototypeAudits, prototypeIncidents } from "./shared/prototypeData.js";
import { navigationGroups } from "../layout/navigationConfig.js";
import { matchRoute } from "../layout/routes.js";
import { FACILITY_PROFILE_TABS } from "../facilities/components/FacilityDetailDrawer.js";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_PHASE_REASON } from "./shared/actions.js";
import { DisabledPrototypeAction } from "./shared/EnvironmentalUI.js";
import { EnvironmentalAuditsPage } from "./audits/EnvironmentalAuditsPage.js";
import { InspectionsPage } from "./inspections/InspectionsPage.js";
import { IncidentsPage } from "./incidents/IncidentsPage.js";
import { PermitsPage } from "./permits/PermitsPage.js";
import { EnforcementNoticesPage } from "./enforcement/EnforcementNoticesPage.js";
import { EnvironmentalMapsPage } from "./maps/EnvironmentalMapsPage.js";
import { ReportsPage } from "./reports/ReportsPage.js";

const facility = {
  id: "facility-1",
  businessName: "Awka Works",
  category: "manufacturing",
  address: "Industrial Layout, Awka South",
  latitude: 6.21,
  longitude: 7.07,
  registrationStatus: "approved",
  riskRating: "low",
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("EMIS2 environmental operations prototype", () => {
  test("selects every environmental route as an available module", () => {
    for (const hash of [
      "#/operations/audits",
      "#/operations/inspections",
      "#/operations/incidents",
      "#/operations/permits",
      "#/operations/compliance",
      "#/operations/enforcement",
      "#/waste",
      "#/monitoring",
      "#/gis",
      "#/reports",
    ]) {
      expect(matchRoute(hash)?.route.implementationStatus).toBe("available");
    }
  });

  test("exposes grouped, permission-aware environmental navigation", () => {
    const groupLabels = navigationGroups.map((group) => group.label);
    expect(groupLabels).toEqual(
      expect.arrayContaining([
        "Environmental Operations",
        "Waste Management",
        "Environmental Monitoring",
        "GIS & Mapping",
        "Reports",
      ]),
    );
    expect(
      navigationGroups
        .flatMap((group) => group.items)
        .find((item) => item.id === "audits")?.requiredPermission,
    ).toBe("ecogov.audits.read");
  });

  test("renders live dashboard metrics and an honest empty state", () => {
    const populated = renderToStaticMarkup(
      React.createElement(EnvironmentalDashboardPage, {
        facilities: [facility],
        loading: false,
        error: null,
        onRetry: () => undefined,
      }),
    );
    expect(populated).toContain("Environmental Operations Dashboard");
    expect(populated).toContain("Live facility registry");
    const empty = renderToStaticMarkup(
      React.createElement(EnvironmentalDashboardPage, {
        facilities: [],
        loading: false,
        error: null,
        onRetry: () => undefined,
      }),
    );
    expect(empty).toContain("No facilities in this workspace");
  });

  test("renders dashboard error state with retry", () => {
    const html = renderToStaticMarkup(
      React.createElement(EnvironmentalDashboardPage, {
        facilities: [],
        loading: false,
        error: "Unavailable",
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain("Dashboard unavailable");
    expect(html).toContain("Retry");
  });

  test("calculates and classifies the transparent prototype score", () => {
    expect(calculatePrototypeCompliance({ audit: 80, permit: 60 })).toBe(70);
    expect(classifyPrototypeCompliance(70)).toBe("Partially Compliant");
    expect(classifyPrototypeCompliance(35)).toBe("Critical Risk");
  });

  test("filters have representative audit and incident fixtures", () => {
    expect(
      prototypeAudits.filter((record) => record.status === "Under review"),
    ).toHaveLength(1);
    expect(
      prototypeIncidents.filter((record) =>
        record.detail.includes("Illegal Dumping"),
      ),
    ).toHaveLength(1);
  });

  test("exports tenant facility rows as escaped CSV", () => {
    const csv = facilitiesToCsv([
      { ...facility, businessName: 'Awka "Works"' },
    ]);
    expect(csv).toContain('"Awka ""Works"""');
    expect(csv).toContain("approved");
  });

  test("defines all ten responsive facility profile tabs", () => {
    expect(FACILITY_PROFILE_TABS).toHaveLength(10);
    expect(FACILITY_PROFILE_TABS).toEqual(
      expect.arrayContaining([
        "Overview",
        "Inspections",
        "Compliance",
        "History",
      ]),
    );
  });

  test("renders actionable audit, inspection, incident, permit and enforcement pages", () => {
    const pages = [
      EnvironmentalAuditsPage,
      InspectionsPage,
      IncidentsPage,
      PermitsPage,
      EnforcementNoticesPage,
    ];
    const html = pages
      .map((Page) => renderToStaticMarkup(React.createElement(Page)))
      .join(" ");
    expect(html).toContain("Create Audit");
    expect(html).toContain("Next step");
    expect(html).toContain("Register Incident");
    expect(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "permits",
          "PermitsPage.tsx",
        ),
        "utf8",
      ),
    ).toContain("Print preview");
    expect(html).toContain("Preview create flow");
  });

  test("renders GIS reset and report preview/export controls", () => {
    const map = renderToStaticMarkup(
      React.createElement(EnvironmentalMapsPage, { facilities: [facility] }),
    );
    const reports = renderToStaticMarkup(
      React.createElement(ReportsPage, { facilities: [facility] }),
    );
    expect(map).toContain("Reset map filters");
    expect(reports).toContain("Export CSV");
    expect(reports).toContain("Print preview");
  });

  test("uses the exact explanation for unsupported actions", () => {
    expect(PRODUCTION_PHASE_REASON).toBe(
      "Available in production implementation phase.",
    );
    const disabled = renderToStaticMarkup(
      React.createElement(DisabledPrototypeAction, null, "Save"),
    );
    expect(disabled).toContain(PRODUCTION_PHASE_REASON);
    expect(disabled).toContain("disabled");
  });

  test("guards environmental buttons against inert rendering", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const collect = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (entry.name.endsWith(".tsx")) files.push(path);
      }
    };
    collect(root);
    const inert: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/<button\b[\s\S]*?>/g)) {
        const tag = match[0];
        if (
          !/\bonClick=|\bdisabled(?:=|\s|>)/.test(tag) &&
          !/type=["']submit["']/.test(tag)
        )
          inert.push(`${path}:${tag}`);
      }
    }
    expect(inert).toEqual([]);
  });
});
