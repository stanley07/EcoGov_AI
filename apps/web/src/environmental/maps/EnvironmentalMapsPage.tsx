import { useMemo, useState } from "react";
import {
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
} from "../shared/EnvironmentalUI.js";
import type { EnvironmentalFacility } from "../shared/types.js";

const mapViews = ["Environmental Map", "Facility Map", "Incident Map"] as const;
const colors: Record<string, string> = {
  low: "#22c55e",
  unknown: "#eab308",
  medium: "#f97316",
  high: "#ef4444",
};
export function EnvironmentalMapsPage({
  facilities,
}: {
  facilities: EnvironmentalFacility[];
}) {
  const [view, setView] =
    useState<(typeof mapViews)[number]>("Environmental Map");
  const [risk, setRisk] = useState("all");
  const filtered = useMemo(
    () =>
      facilities
        .filter((f) => risk === "all" || f.riskRating === risk)
        .filter(
          (f) =>
            Number.isFinite(f.latitude) &&
            Number.isFinite(f.longitude) &&
            !(f.latitude === 0 && f.longitude === 0),
        ),
    [facilities, risk],
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="GIS & Environmental Mapping"
        description="Lightweight coordinate visualization; real facility markers use only recorded registry coordinates."
        prototype={false}
      />
      <div className="emis-tabs" role="tablist">
        {mapViews.map((v) => (
          <button
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            key={v}
          >
            {v}
          </button>
        ))}
      </div>
      <FilterBar>
        <select
          aria-label="Map risk filter"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
        >
          <option value="all">All risk levels</option>
          <option value="low">Low / compliant</option>
          <option value="unknown">Under review</option>
          <option value="medium">Non-compliant proxy</option>
          <option value="high">Critical risk</option>
        </select>
        <select aria-label="Map LGA filter" disabled>
          <option>All recorded LGAs</option>
        </select>
        <select aria-label="Map facility type filter" disabled>
          <option>All facility types</option>
        </select>
      </FilterBar>
      <div
        className="emis-map"
        role="img"
        aria-label={`${view} with ${filtered.length} facility markers`}
      >
        {filtered.map((facility, index) => (
          <button
            className="emis-marker"
            aria-label={`${facility.businessName}, ${facility.riskRating} risk`}
            title={`${facility.businessName} · ${facility.riskRating}`}
            key={facility.id}
            style={{
              left: `${12 + ((index * 23) % 78)}%`,
              top: `${18 + ((index * 31) % 68)}%`,
              background: colors[facility.riskRating] || colors.unknown,
            }}
          />
        ))}
        {view === "Incident Map" && (
          <div className="emis-empty" style={{ margin: 70 }}>
            <p>No incident coordinates are connected.</p>
          </div>
        )}
      </div>
      <div className="emis-actions">
        <span style={{ color: "#22c55e" }}>● Compliant</span>
        <span style={{ color: "#eab308" }}>● Under Review</span>
        <span style={{ color: "#f97316" }}>● Non-Compliant</span>
        <span style={{ color: "#ef4444" }}>● Critical Risk</span>
        {view !== "Facility Map" && (
          <PrototypeLabel>Layer shell</PrototypeLabel>
        )}
      </div>
    </div>
  );
}
