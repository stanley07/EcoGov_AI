import { useMemo, useState } from "react";
import {
  DetailPanel,
  FilterBar,
  ModuleHeader,
  PrototypeModal,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypeIncidents } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function IncidentsPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [showRegister, setShowRegister] = useState(false);
  const records = useMemo(
    () =>
      prototypeIncidents.filter(
        (r) =>
          `${r.detail} ${r.status}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (type === "all" || r.detail.includes(type)) &&
          (severity === "all" || r.detail.includes(severity)) &&
          (status === "all" || r.status === status),
      ),
    [query, type, severity, status],
  );
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Environmental Incidents"
        description="Environmental incident prototype; production complaint/triage integration remains clearly distinguished."
      />
      <SummaryCards
        items={[
          { label: "Prototype incidents", value: prototypeIncidents.length },
          { label: "Investigating", value: 1 },
          { label: "Assigned", value: 1 },
          {
            label: "Production complaints",
            value: 0,
            note: "Not represented as incidents",
          },
        ]}
      />
      <FilterBar>
        <input
          aria-label="Filter incidents"
          placeholder="Type, status or severity"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Incident type"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="all">All incident types</option>
          {[
            "Oil Spill",
            "Illegal Dumping",
            "Flooding",
            "Erosion",
            "Open Burning",
            "Hazardous Waste",
            "Air Pollution",
            "Water Pollution",
            "Noise Pollution",
            "Deforestation",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Incident severity"
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="all">All severities</option>
          <option>High severity</option>
          <option>Medium severity</option>
        </select>
        <select
          aria-label="Incident status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option>Investigating</option>
          <option>Assigned</option>
        </select>
        <button
          type="button"
          className="emis-action"
          onClick={() => {
            setQuery("");
            setType("all");
            setSeverity("all");
            setStatus("all");
          }}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="emis-action"
          onClick={() => setShowRegister(true)}
        >
          Register Incident
        </button>
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel title={selected.id} onClose={() => setSelected(null)}>
          <div className="emis-detail-grid">
            <section>
              <h3>Assignment</h3>
              <p>Environmental Response Officer</p>
              <button
                type="button"
                className="emis-action"
                onClick={() =>
                  alert(
                    "Prototype assignment preview: Environmental Response Officer",
                  )
                }
              >
                Preview assignment
              </button>
            </section>
            <section>
              <h3>Investigation</h3>
              <p>{selected.status}</p>
            </section>
            <section>
              <h3>Resolution</h3>
              <p>Open</p>
            </section>
            <section>
              <h3>GPS</h3>
              <p>No verified coordinates</p>
              <button
                type="button"
                className="emis-action"
                disabled
                title="Available in production implementation phase."
              >
                Open map
              </button>
              <small>Available in production implementation phase.</small>
            </section>
            <section>
              <h3>Images</h3>
              <div className="emis-photo-placeholder">
                Prototype image placeholder
              </div>
              <button
                type="button"
                className="emis-action"
                onClick={() =>
                  alert(
                    "Prototype image preview. No production evidence is attached.",
                  )
                }
              >
                Preview image
              </button>
            </section>
            <section>
              <h3>Recent activity</h3>
              <p>Assignment recorded in demonstration timeline.</p>
            </section>
          </div>
        </DetailPanel>
      )}
      {showRegister && (
        <PrototypeModal
          title="Register Incident · Prototype only — not saved"
          onClose={() => setShowRegister(false)}
        >
          <label>
            Incident type
            <select aria-label="New incident type">
              <option>Oil Spill</option>
              <option>Illegal Dumping</option>
              <option>Flooding</option>
            </select>
          </label>
          <label>
            Description
            <textarea aria-label="New incident description" />
          </label>
          <button
            type="button"
            className="emis-action"
            disabled
            title="Available in production implementation phase."
          >
            Save incident
          </button>
          <p>Available in production implementation phase.</p>
        </PrototypeModal>
      )}
    </div>
  );
}
