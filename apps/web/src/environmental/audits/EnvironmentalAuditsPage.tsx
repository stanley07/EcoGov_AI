import { useMemo, useState } from "react";
import {
  DetailPanel,
  DisabledPrototypeAction,
  FilterBar,
  ModuleHeader,
  PrototypeLabel,
  PrototypeModal,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypeAudits } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";
import { openPrintPreview } from "../shared/actions.js";

const auditSections = [
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
];

export function EnvironmentalAuditsPage() {
  const [status, setStatus] = useState("all");
  const [facility, setFacility] = useState("");
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
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
        <input aria-label="Audit date filter" type="date" />
        <button
          type="button"
          className="emis-action"
          onClick={() => {
            setFacility("");
            setStatus("all");
          }}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="emis-action"
          onClick={() => setShowCreate(true)}
        >
          Create Audit
        </button>
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel
          title={`${selected.id} · Prototype audit`}
          onClose={() => setSelected(null)}
        >
          <div className="emis-tabs" role="tablist">
            {auditSections.map((section, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={sectionIndex === index}
                onClick={() => setSectionIndex(index)}
                key={section}
              >
                {section}
              </button>
            ))}
          </div>
          <section className="emis-card">
            <h3>{auditSections[sectionIndex]}</h3>
            <p>No production record is connected for this section.</p>
            {auditSections[sectionIndex] === "Evidence" && (
              <button
                type="button"
                className="emis-action"
                onClick={() => setSectionIndex(11)}
              >
                Open recommendations
              </button>
            )}
          </section>
          <div className="emis-actions">
            <button
              type="button"
              className="emis-action"
              disabled={sectionIndex === 0}
              onClick={() => setSectionIndex((value) => Math.max(0, value - 1))}
            >
              Previous section
            </button>
            <button
              type="button"
              className="emis-action"
              disabled={sectionIndex === auditSections.length - 1}
              onClick={() =>
                setSectionIndex((value) =>
                  Math.min(auditSections.length - 1, value + 1),
                )
              }
            >
              Next section
            </button>
            <button
              type="button"
              className="emis-action"
              onClick={openPrintPreview}
            >
              Print preview
            </button>
          </div>
          <p className="emis-notice">
            Save and approval actions are disabled. Coming in production phase.
          </p>
          <DisabledPrototypeAction>Submit audit</DisabledPrototypeAction>
        </DetailPanel>
      )}
      <PrototypeLabel>Prototype audit records</PrototypeLabel>
      {showCreate && (
        <PrototypeModal
          title="Create Audit · Prototype only — not saved"
          onClose={() => setShowCreate(false)}
        >
          <div className="emis-detail-grid">
            <label>
              Facility
              <input aria-label="Prototype audit facility" />
            </label>
            <label>
              Audit date
              <input type="date" aria-label="Prototype audit date" />
            </label>
            <label>
              Scope
              <textarea aria-label="Prototype audit scope" />
            </label>
          </div>
          <DisabledPrototypeAction>Save audit</DisabledPrototypeAction>
        </PrototypeModal>
      )}
    </div>
  );
}
