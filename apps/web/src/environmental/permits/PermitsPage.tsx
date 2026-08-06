import { useState } from "react";
import {
  DetailPanel,
  ModuleHeader,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypePermits } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function PermitsPage() {
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
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
      <RecordTable records={prototypePermits} onSelect={setSelected} />
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
          </div>
        </DetailPanel>
      )}
    </div>
  );
}
