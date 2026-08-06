import { useMemo, useState } from "react";
import {
  DisabledPrototypeAction,
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
} from "../shared/EnvironmentalUI.js";
import type { EnvironmentalFacility } from "../shared/types.js";
import { downloadCsv, openPrintPreview } from "../shared/actions.js";

export const facilitiesToCsv = (facilities: EnvironmentalFacility[]) =>
  [
    "Facility,Category,Address,Status,Risk,Registered",
    ...facilities.map((f) =>
      [
        f.businessName,
        f.category,
        f.address,
        f.registrationStatus,
        f.riskRating,
        f.createdAt,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\r\n");
const reportTypes = [
  "Daily Reports",
  "Weekly Reports",
  "Monthly Reports",
  "Quarterly Reports",
  "Annual Reports",
  "LGA Reports",
  "Senatorial District Reports",
  "Ministry Reports",
];
export function ReportsPage({
  facilities,
}: {
  facilities: EnvironmentalFacility[];
}) {
  const [type, setType] = useState("Monthly Reports");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const csv = useMemo(() => facilitiesToCsv(facilities), [facilities]);
  const exportCsv = () => downloadCsv("ecogov-facility-report.csv", csv);
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Environmental Reports"
        description="Report preview and CSV export backed by the current tenant facility response."
        prototype={false}
      />
      <FilterBar>
        <label>
          From{" "}
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          To{" "}
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="emis-action"
          onClick={() => {
            setFrom("");
            setTo("");
            setType("Monthly Reports");
          }}
        >
          Clear filters
        </button>
      </FilterBar>
      <div className="emis-module-grid">
        {reportTypes.map((report) => (
          <button
            className="emis-card"
            style={{ textAlign: "left", color: "inherit", cursor: "pointer" }}
            onClick={() => setType(report)}
            key={report}
          >
            <h3>{report}</h3>
            <p className="emis-muted">Open facility registry preview</p>
          </button>
        ))}
      </div>
      <section className="emis-card">
        <div className="emis-section-title">
          <div>
            <h2>{type}</h2>
            <p className="emis-muted">
              Facility registry snapshot · {facilities.length} row(s)
            </p>
          </div>
          <PrototypeLabel>Preview format</PrototypeLabel>
        </div>
        {facilities.length ? (
          <div className="emis-table-wrap">
            <table className="emis-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {facilities.slice(0, 10).map((f) => (
                  <tr key={f.id}>
                    <td>{f.businessName}</td>
                    <td>{f.category}</td>
                    <td>{f.registrationStatus}</td>
                    <td>{f.riskRating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emis-empty">
            <p>No facility rows are available for export.</p>
          </div>
        )}
        <div className="emis-actions" style={{ marginTop: 14 }}>
          <button
            className="emis-action"
            disabled={!facilities.length}
            onClick={exportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="emis-action"
            onClick={openPrintPreview}
          >
            Print preview
          </button>
          <DisabledPrototypeAction>PDF export</DisabledPrototypeAction>
          <DisabledPrototypeAction>Excel export</DisabledPrototypeAction>
        </div>
      </section>
    </div>
  );
}
