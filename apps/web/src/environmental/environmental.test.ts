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
});
