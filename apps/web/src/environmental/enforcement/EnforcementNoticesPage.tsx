import { useState } from "react";
import {
  DetailPanel,
  DisabledPrototypeAction,
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { navigateTo, openPrintPreview } from "../shared/actions.js";

const notices = [
  {
    id: "ENF-P-014",
    type: "Abatement Notice",
    source: "AUD-P-103",
    facility: "Onitsha Materials Depot",
    status: "Draft preview",
    date: "2026-08-05",
    officer: "Compliance Officer",
  },
  {
    id: "ENF-P-013",
    type: "Warning Letter",
    source: "INC-P-207",
    facility: "Public report location",
    status: "Under review",
    date: "2026-08-03",
    officer: "Response Officer",
  },
];
export function EnforcementNoticesPage() {
  const [selected, setSelected] = useState<(typeof notices)[number] | null>(
    null,
  );
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const filtered = notices.filter(
    (notice) =>
      (type === "all" || notice.type === type) &&
      (status === "all" || notice.status === status),
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Enforcement Notices"
        description="Warning letters, abatement notices, stop-work orders, compliance orders and prosecution recommendations."
      />
      <FilterBar>
        <select
          aria-label="Notice type"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="all">All types</option>
          <option>Abatement Notice</option>
          <option>Warning Letter</option>
        </select>
        <select
          aria-label="Notice status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option>Draft preview</option>
          <option>Under review</option>
        </select>
        <button
          type="button"
          className="emis-action"
          onClick={() => {
            setType("all");
            setStatus("all");
          }}
        >
          Clear filters
        </button>
      </FilterBar>
      <SummaryCards
        items={[
          { label: "Prototype notices", value: notices.length },
          { label: "Under review", value: 1 },
          { label: "Issued production notices", value: 0 },
          { label: "Prosecution recommendations", value: 0 },
        ]}
      />
      <div className="emis-table-wrap">
        <table className="emis-table">
          <thead>
            <tr>
              <th>Notice</th>
              <th>Category</th>
              <th>Origin</th>
              <th>Facility</th>
              <th>Status</th>
              <th>Officer</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => (
              <tr
                key={n.id}
                tabIndex={0}
                onClick={() => setSelected(n)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    setSelected(n);
                }}
              >
                <td>{n.id}</td>
                <td>{n.type}</td>
                <td>{n.source}</td>
                <td>{n.facility}</td>
                <td>{n.status}</td>
                <td>{n.officer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="emis-actions">
        <button
          className="emis-action"
          onClick={() => setSelected(notices[0] || null)}
        >
          Preview create flow
        </button>
        <PrototypeLabel>No persistence</PrototypeLabel>
      </div>
      {selected && (
        <DetailPanel
          title={`${selected.type} · ${selected.id}`}
          onClose={() => setSelected(null)}
        >
          <p>
            <strong>Origin:</strong> {selected.source}
          </p>
          <button
            type="button"
            className="emis-action"
            onClick={() =>
              navigateTo(
                selected.source.startsWith("AUD")
                  ? "#/operations/audits"
                  : "#/operations/incidents",
              )
            }
          >
            Open originating record
          </button>
          <p>
            <strong>Facility:</strong> {selected.facility}
          </p>
          <p>
            <strong>Issue date:</strong> {selected.date}
          </p>
          <p className="emis-notice">
            Preview only. Issue action is disabled until the production
            enforcement service exists.
          </p>
          <button
            type="button"
            className="emis-action"
            onClick={openPrintPreview}
          >
            Print notice preview
          </button>
          <DisabledPrototypeAction>Issue notice</DisabledPrototypeAction>
        </DetailPanel>
      )}
    </div>
  );
}
