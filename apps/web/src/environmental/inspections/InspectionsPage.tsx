import { useState } from "react";
import {
  DetailPanel,
  FilterBar,
  ModuleHeader,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import {
  inspectionSteps,
  prototypeInspections,
} from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function InspectionsPage() {
  const [selected, setSelected] = useState<PrototypeRecord | null>(
    prototypeInspections[0] || null,
  );
  const [status, setStatus] = useState("all");
  const records = prototypeInspections.filter(
    (r) => status === "all" || r.status === status,
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Inspection Workbench"
        description="Lifecycle view prepared for WF-1 work-item integration; no fake workflow is created."
      />
      <SummaryCards
        items={[
          { label: "Prototype queue", value: records.length },
          { label: "Assigned", value: 1 },
          { label: "Supervisor review", value: 1 },
          {
            label: "Live work items",
            value: 0,
            note: "Use My Tasks for production WF-1 data",
          },
        ]}
      />
      <FilterBar>
        <select
          aria-label="Inspection status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option>Conduct inspection</option>
          <option>Supervisor review</option>
        </select>
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel
          title={`${selected.id} · ${selected.facility}`}
          onClose={() => setSelected(null)}
        >
          <p>
            <strong>Officer:</strong> Field Inspector · <strong>Result:</strong>{" "}
            Under review
          </p>
          <div className="emis-stepper">
            {inspectionSteps.map((step, index) => (
              <div
                className={`emis-step ${index < 2 ? "active" : ""}`}
                key={step}
              >
                {step}
              </div>
            ))}
          </div>
          <div className="emis-detail-grid">
            <section>
              <h3>GPS</h3>
              <p>No coordinates captured.</p>
            </section>
            <section>
              <h3>Photographs / evidence</h3>
              <div className="emis-photo-placeholder">
                No field evidence uploaded
              </div>
            </section>
            <section>
              <h3>Risk & compliance</h3>
              <p>Assessment pending.</p>
            </section>
            <section>
              <h3>Supervisor review</h3>
              <p>{selected.status}</p>
            </section>
          </div>
          <p className="emis-notice">
            Workflow mutations are available only through the canonical My Tasks
            workspace.
          </p>
        </DetailPanel>
      )}
    </div>
  );
}
