import React, { useMemo, useState } from "react";
import {
  DetailPanel,
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
} from "../shared/EnvironmentalUI.js";
import type { EnvironmentalFacility } from "../shared/types.js";
import { downloadCsv, navigateTo } from "../shared/actions.js";

export const calculatePrototypeCompliance = (
  components: Record<string, number>,
) =>
  Math.round(
    Object.values(components).reduce(
      (sum, value) => sum + Math.max(0, Math.min(100, value)),
      0,
    ) / Math.max(1, Object.keys(components).length),
  );
export const classifyPrototypeCompliance = (score: number) =>
  score >= 85
    ? "Fully Compliant"
    : score >= 65
      ? "Partially Compliant"
      : score >= 40
        ? "Non-Compliant"
        : "Critical Risk";
const baseComponents = {
  "Environmental Audit": 72,
  "Inspection Results": 65,
  "Permit Status": 80,
  "Incident History": 58,
  "Enforcement Actions": 75,
};
export function CompliancePage({
  facilities,
}: {
  facilities: EnvironmentalFacility[];
}) {
  const [selected, setSelected] = useState<EnvironmentalFacility | null>(null);
  const [risk, setRisk] = useState("all");
  const [sort, setSort] = useState("score-desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const score = calculatePrototypeCompliance(baseComponents);
  const ranked = useMemo(
    () =>
      facilities
        .filter((f) => risk === "all" || f.riskRating === risk)
        .slice()
        .sort((a, b) =>
          sort === "name"
            ? a.businessName.localeCompare(b.businessName)
            : sort === "score-asc"
              ? a.riskRating.localeCompare(b.riskRating)
              : b.riskRating.localeCompare(a.riskRating),
        ),
    [facilities, risk, sort],
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Compliance Intelligence"
        description="Transparent demonstration model; this is not final ministry policy."
      />
      <div className="emis-module-grid">
        <article
          className="emis-card"
          style={{ display: "grid", placeItems: "center" }}
        >
          <div
            className="emis-score"
            style={{ "--score": `${score}%` } as React.CSSProperties}
          >
            <strong>{score}%</strong>
          </div>
          <h2>{classifyPrototypeCompliance(score)}</h2>
          <PrototypeLabel>Prototype compliance score</PrototypeLabel>
        </article>
        <article className="emis-card">
          <h2>Component contributions</h2>
          <div className="emis-breakdown">
            {Object.entries(baseComponents).map(([name, value]) => (
              <button
                type="button"
                className="emis-breakdown-row emis-card-action"
                key={name}
                onClick={() => setExpanded(expanded === name ? null : name)}
                aria-expanded={expanded === name}
              >
                <span>{name}</span>
                <div className="emis-progress">
                  <span style={{ width: `${value}%` }} />
                </div>
                <strong>{value}%</strong>
                {expanded === name && (
                  <small>
                    {name} contributes one equally weighted input to this
                    demonstration formula.
                  </small>
                )}
              </button>
            ))}
          </div>
        </article>
      </div>
      <section>
        <div className="emis-section-title">
          <h2>Facility ranking</h2>
          <PrototypeLabel>Score not persisted</PrototypeLabel>
        </div>
        <FilterBar>
          <select
            aria-label="Filter ranking by risk"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          >
            <option value="all">All risk levels</option>
            <option value="high">High risk</option>
            <option value="medium">Medium risk</option>
            <option value="low">Low risk</option>
          </select>
          <select
            aria-label="Sort facility ranking"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="score-desc">Score high to low</option>
            <option value="score-asc">Score low to high</option>
            <option value="name">Facility name</option>
          </select>
          <button
            type="button"
            className="emis-action"
            onClick={() => {
              setRisk("all");
              setSort("score-desc");
            }}
          >
            Clear filters
          </button>
          <button
            type="button"
            className="emis-action"
            disabled={!ranked.length}
            onClick={() =>
              downloadCsv(
                "prototype-compliance.csv",
                [
                  "Facility,Risk",
                  ...ranked.map((f) => `"${f.businessName}",${f.riskRating}`),
                ].join("\r\n"),
              )
            }
          >
            Export CSV
          </button>
        </FilterBar>
        {ranked.length ? (
          <div className="emis-table-wrap">
            <table className="emis-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Recorded risk</th>
                  <th>Prototype score</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((facility, index) => {
                  const value = Math.max(
                    35,
                    score -
                      index * 4 -
                      (facility.riskRating === "high" ? 18 : 0),
                  );
                  return (
                    <tr
                      key={facility.id}
                      tabIndex={0}
                      onClick={() => setSelected(facility)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          setSelected(facility);
                      }}
                    >
                      <td>{facility.businessName}</td>
                      <td>{facility.riskRating}</td>
                      <td>{value}%</td>
                      <td>{classifyPrototypeCompliance(value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emis-empty">
            <p>No facilities match this filter.</p>
          </div>
        )}
      </section>
      {selected && (
        <DetailPanel
          title={`${selected.businessName} · score breakdown`}
          onClose={() => setSelected(null)}
        >
          <p className="emis-notice">
            The displayed score is demonstration-only and has not been
            persisted.
          </p>
          <div className="emis-breakdown">
            {Object.entries(baseComponents).map(([name, value]) => (
              <p key={name}>
                <strong>{name}:</strong> {value}% contribution input
              </p>
            ))}
          </div>
          <p>
            <strong>Classification:</strong> 85+ Fully Compliant; 65–84
            Partially Compliant; 40–64 Non-Compliant; below 40 Critical Risk.
          </p>
          <button
            type="button"
            className="emis-action"
            onClick={() => navigateTo(`#/facilities/${selected.id}`)}
          >
            Open facility profile
          </button>
        </DetailPanel>
      )}
    </div>
  );
}
