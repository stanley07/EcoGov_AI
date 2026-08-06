import { useState } from "react";
import {
  DetailPanel,
  ModuleHeader,
  PrototypeLabel,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";

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
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Enforcement Notices"
        description="Warning letters, abatement notices, stop-work orders, compliance orders and prosecution recommendations."
      />
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
            {notices.map((n) => (
              <tr key={n.id} tabIndex={0} onClick={() => setSelected(n)}>
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
          <button className="emis-action" disabled>
            Issue notice
          </button>
        </DetailPanel>
      )}
    </div>
  );
}
