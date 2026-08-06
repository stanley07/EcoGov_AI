import { useMemo, useState } from "react";
import {
  DetailPanel,
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypeAudits } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function EnvironmentalAuditsPage() {
  const [status, setStatus] = useState("all");
  const [facility, setFacility] = useState("");
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
  const records = useMemo(
    () =>
      prototypeAudits.filter(
        (r) =>
          (status === "all" || r.status === status) &&
          r.facility.toLowerCase().includes(facility.toLowerCase()),
      ),
    [status, facility],
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Environmental Audits"
        description="Structured audit review workspace; records below are demonstration fixtures."
      />
      <SummaryCards
        items={[
          { label: "Prototype audits", value: prototypeAudits.length },
          {
            label: "Under review",
            value: prototypeAudits.filter((r) => r.status === "Under review")
              .length,
          },
          {
            label: "Corrective actions",
            value: prototypeAudits.filter(
              (r) => r.status === "Corrective action",
            ).length,
          },
          { label: "Production records", value: 0 },
        ]}
      />
      <FilterBar>
        <input
          aria-label="Filter audits by facility"
          placeholder="Facility"
          value={facility}
          onChange={(e) => setFacility(e.target.value)}
        />
        <select
          aria-label="Filter audits by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option>Under review</option>
          <option>Corrective action</option>
        </select>
        <input
          aria-label="Audit date filter"
          type="date"
          disabled
          title="Production phase"
        />
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel
          title={`${selected.id} · Prototype audit`}
          onClose={() => setSelected(null)}
        >
          <div className="emis-detail-grid">
            {[
              "Audit Information",
              "Audit Team",
              "Facility Information",
              "Air Quality",
              "Water Quality",
              "Noise",
              "Waste",
              "Chemical Management",
              "Health & Safety",
              "Findings",
              "Evidence",
              "Recommendations",
              "Corrective Actions",
              "Approval",
            ].map((section) => (
              <section key={section}>
                <h3>{section}</h3>
                <p>No production record is connected for this section.</p>
              </section>
            ))}
          </div>
          <p className="emis-notice">
            Save and approval actions are disabled. Coming in production phase.
          </p>
          <button className="emis-action" disabled>
            Submit audit
          </button>
        </DetailPanel>
      )}
      <PrototypeLabel>Prototype audit records</PrototypeLabel>
    </div>
  );
}
