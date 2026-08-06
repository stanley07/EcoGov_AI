import { useMemo, useState } from "react";
import {
  DetailPanel,
  FilterBar,
  ModuleHeader,
  RecordTable,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { prototypeIncidents } from "../shared/prototypeData.js";
import type { PrototypeRecord } from "../shared/types.js";

export function IncidentsPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PrototypeRecord | null>(null);
  const records = useMemo(
    () =>
      prototypeIncidents.filter((r) =>
        `${r.detail} ${r.status}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
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
        <select aria-label="Incident type">
          <option>All incident types</option>
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
      </FilterBar>
      <RecordTable records={records} onSelect={setSelected} />
      {selected && (
        <DetailPanel title={selected.id} onClose={() => setSelected(null)}>
          <div className="emis-detail-grid">
            <section>
              <h3>Assignment</h3>
              <p>Environmental Response Officer</p>
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
            </section>
            <section>
              <h3>Images</h3>
              <div className="emis-photo-placeholder">
                Prototype image placeholder
              </div>
            </section>
            <section>
              <h3>Recent activity</h3>
              <p>Assignment recorded in demonstration timeline.</p>
            </section>
          </div>
        </DetailPanel>
      )}
    </div>
  );
}
