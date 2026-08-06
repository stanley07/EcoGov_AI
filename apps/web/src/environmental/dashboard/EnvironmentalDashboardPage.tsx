import { useState } from "react";
import {
  ModuleHeader,
  PrototypeLabel,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import type { EnvironmentalFacility } from "../shared/types.js";
import { navigateTo } from "../shared/actions.js";

export function EnvironmentalDashboardPage({
  facilities,
  loading,
  error,
  onRetry,
}: {
  facilities: EnvironmentalFacility[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [trendView, setTrendView] = useState("all");
  if (loading)
    return (
      <div className="emis-page" aria-busy="true">
        <ModuleHeader
          title="Environmental Operations"
          description="Loading tenant facility registry…"
          prototype={false}
        />
        <div className="emis-summary-grid">
          {[1, 2, 3, 4].map((item) => (
            <div
              className="emis-card"
              style={{ minHeight: 100, opacity: 0.55 }}
              key={item}
            />
          ))}
        </div>
      </div>
    );
  if (error)
    return (
      <div className="emis-page">
        <ModuleHeader
          title="Environmental Operations"
          description="Facility registry data could not be loaded."
          prototype={false}
        />
        <div className="emis-empty" role="alert">
          <strong>Dashboard unavailable</strong>
          <p>{error}</p>
          <button className="emis-action" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  const approved = facilities.filter(
    (f) => f.registrationStatus === "approved",
  ).length;
  const high = facilities.filter((f) => f.riskRating === "high").length;
  const medium = facilities.filter((f) => f.riskRating === "medium").length;
  const low = facilities.filter((f) => f.riskRating === "low").length;
  const lgas = facilities.reduce<Record<string, number>>((counts, facility) => {
    const addressParts = facility.address.split(",");
    const lga = addressParts[addressParts.length - 1]?.trim() || "Not recorded";
    counts[lga] = (counts[lga] || 0) + 1;
    return counts;
  }, {});
  const lgaEntries = Object.entries(lgas).slice(0, 5);
  return (
    <div className="emis-page" data-testid="environmental-dashboard">
      <ModuleHeader
        title="Environmental Operations Dashboard"
        description="Tenant-scoped facility registry metrics with clearly separated prototype modules."
        prototype={false}
      />
      <SummaryCards
        items={[
          {
            label: "Total Facilities",
            value: facilities.length,
            tone: "#38bdf8",
            note: "Live facility registry",
            onClick: () => navigateTo("#/facilities"),
          },
          {
            label: "Active Facilities",
            value: approved,
            tone: "#34d399",
            note: "Approved registry records",
            onClick: () => navigateTo("#/facilities"),
          },
          {
            label: "Environmental Audits",
            value: 0,
            note: "No production source",
            onClick: () => navigateTo("#/operations/audits"),
          },
          {
            label: "Inspections",
            value: 0,
            note: "Workflow integration pending",
            onClick: () => navigateTo("#/operations/inspections"),
          },
          {
            label: "Active Permits",
            value: 0,
            note: "Prototype module",
            onClick: () => navigateTo("#/operations/permits"),
          },
          {
            label: "Incidents",
            value: 0,
            note: "Complaint mapping pending",
            onClick: () => navigateTo("#/operations/incidents"),
          },
          {
            label: "Waste Sites",
            value: 0,
            note: "Prototype module",
            onClick: () => navigateTo("#/waste"),
          },
          {
            label: "Enforcement Notices",
            value: 0,
            note: "Prototype module",
            onClick: () => navigateTo("#/operations/enforcement"),
          },
        ]}
      />
      {!facilities.length && (
        <div className="emis-empty">
          <strong>No facilities in this workspace</strong>
          <p>
            Register a facility to populate live facility totals. Other modules
            remain honest zero states.
          </p>
          <button
            type="button"
            className="emis-action"
            onClick={() => navigateTo("#/facilities/register")}
          >
            Register facility
          </button>
        </div>
      )}
      <section>
        <div className="emis-section-title">
          <h2>Compliance and risk overview</h2>
          <PrototypeLabel>Registry-derived where available</PrototypeLabel>
        </div>
        <SummaryCards
          items={[
            {
              label: "Fully Compliant",
              value: approved,
              note: "Approved facility proxy",
            },
            { label: "Partially Compliant", value: 0 },
            { label: "Non-Compliant", value: 0 },
            { label: "Critical Facilities", value: high, tone: "#f87171" },
            { label: "High Risk Facilities", value: high },
            { label: "Medium Risk", value: medium },
            { label: "Low Risk", value: low },
            { label: "Closed Cases", value: 0 },
            { label: "Pending Reviews", value: facilities.length - approved },
          ]}
        />
      </section>
      <section>
        <div className="emis-section-title">
          <h2>Operational trends</h2>
          <div className="emis-actions">
            <select
              aria-label="Chart display filter"
              value={trendView}
              onChange={(event) => setTrendView(event.target.value)}
            >
              <option value="all">All trends</option>
              <option value="registry">Registry only</option>
              <option value="prototype">Prototype only</option>
            </select>
            <PrototypeLabel>Prototype charts · zero baselines</PrototypeLabel>
          </div>
        </div>
        <div className="emis-chart-grid">
          <figure
            className="emis-card emis-chart"
            hidden={trendView === "prototype"}
          >
            <figcaption>Facilities by LGA</figcaption>
            <svg
              viewBox="0 0 300 160"
              role="img"
              aria-label="Facilities grouped by recorded address area"
            >
              <line className="axis" x1="70" y1="10" x2="70" y2="145" />
              {lgaEntries.length ? (
                lgaEntries.map(([lga, count], i) => (
                  <g key={lga}>
                    <text x="0" y={25 + i * 27}>
                      {lga.slice(0, 10)}
                    </text>
                    <rect
                      className="bar"
                      x="72"
                      y={13 + i * 27}
                      width={Math.max(8, count * 35)}
                      height="15"
                    >
                      <title>{`${lga}: ${count}`}</title>
                    </rect>
                  </g>
                ))
              ) : (
                <text x="90" y="80">
                  No facility locations
                </text>
              )}
            </svg>
          </figure>
          {[
            ["Audits by Month", "0,0 50,0 100,0 150,0 200,0 250,0"],
            ["Compliance Trend", "0,0 50,0 100,0 150,0 200,0 250,0"],
            ["Incident Trend", "0,0 50,0 100,0 150,0 200,0 250,0"],
          ].map(([title, points]) => (
            <figure
              className="emis-card emis-chart"
              key={title}
              hidden={trendView === "registry"}
            >
              <figcaption>{title}</figcaption>
              <svg
                viewBox="0 0 300 160"
                role="img"
                aria-label={`${title}, no production records`}
              >
                <line className="axis" x1="20" y1="130" x2="285" y2="130" />
                <polyline
                  className="line"
                  points={String(points)
                    .split(" ")
                    .map((p) => {
                      const [x, y] = p.split(",");
                      return `${Number(x) + 25},${125 - Number(y)}`;
                    })
                    .join(" ")}
                />
                <text x="85" y="75">
                  No production records
                </text>
              </svg>
            </figure>
          ))}
          {[
            ["Waste Categories", "#f59e0b"],
            ["Permit Distribution", "#818cf8"],
          ].map(([title, color]) => (
            <figure
              className="emis-card emis-chart"
              key={title}
              hidden={trendView === "registry"}
            >
              <figcaption>{title}</figcaption>
              <svg
                viewBox="0 0 300 160"
                role="img"
                aria-label={`${title}, no production records`}
              >
                <circle
                  cx="150"
                  cy="75"
                  r="50"
                  fill="none"
                  stroke="#334155"
                  strokeWidth="18"
                />
                <circle
                  cx="150"
                  cy="75"
                  r="50"
                  fill="none"
                  stroke={color}
                  strokeWidth="18"
                  strokeDasharray="0 314"
                />
                <text x="118" y="80">
                  No data
                </text>
              </svg>
            </figure>
          ))}
        </div>
      </section>
      <section className="emis-card">
        <div className="emis-section-title">
          <h2>Recent activity</h2>
          <button
            type="button"
            className="emis-action"
            onClick={() => navigateTo("#/facilities")}
          >
            View all
          </button>
        </div>
        {facilities.length ? (
          <ul className="emis-activity">
            {facilities.slice(0, 5).map((facility) => (
              <li key={facility.id}>
                <button
                  type="button"
                  className="emis-activity-action"
                  onClick={() => navigateTo(`#/facilities/${facility.id}`)}
                >
                  <strong>{facility.businessName}</strong> registered{" "}
                  {new Date(facility.createdAt).toLocaleDateString()} ·{" "}
                  {facility.registrationStatus.replace(/_/g, " ")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="emis-empty">
            <p>No recent facility activity.</p>
          </div>
        )}
      </section>
    </div>
  );
}
