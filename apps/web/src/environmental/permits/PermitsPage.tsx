import { useState } from "react";
import {
  DetailPanel,
  DisabledPrototypeAction,
  FilterBar,
  ModuleHeader,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypePermits } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function PermitsPage() {
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
  const [status, setStatus] = useState("all");
  const records = prototypePermits.filter(
    (record) => status === "all" || record.status === status,
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Environmental Permits"
        description="Application, renewal, expiry, suspension and revocation presentation workspace."
      />
      <SummaryCards
        items={[
          { label: "Prototype permits", value: 2 },
          { label: "Active", value: 1 },
          { label: "Renewal due", value: 1 },
          { label: "Suspended / revoked", value: 0 },
        ]}
      />
      <FilterBar>
        <select
          aria-label="Permit status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option>Active</option>
          <option>Renewal due</option>
        </select>
        <button
          type="button"
          className="emis-action"
          onClick={() => setStatus("all")}
        >
          Clear filter
        </button>
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel
          title={`Permit preview · ${selected.id}`}
          onClose={() => setSelected(null)}
        >
          <div className="emis-card">
            <p>
              <strong>Facility:</strong> {selected.facility}
            </p>
            <p>
              <strong>Permit:</strong> {selected.detail}
            </p>
            <p>
              <strong>Status:</strong> {selected.status}
            </p>
            <p>
              <strong>Expiry:</strong> {selected.date}
            </p>
            <p className="emis-notice">
              Prototype printable preview. This is not an issued government
              permit.
            </p>
            <button className="emis-action" onClick={() => window.print()}>
              Print preview
            </button>
            <button
              type="button"
              className="emis-action"
              onClick={() =>
                alert(`Renewal preview for ${selected.id}. No changes saved.`)
              }
            >
              Renewal preview
            </button>
            <DisabledPrototypeAction>Suspend permit</DisabledPrototypeAction>
            <DisabledPrototypeAction>Revoke permit</DisabledPrototypeAction>
          </div>
        </DetailPanel>
      )}
    </div>
  );
}
