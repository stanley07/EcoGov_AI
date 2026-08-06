import { useState } from "react";
import {
  ModuleHeader,
  DetailPanel,
  FilterBar,
  PrototypeLabel,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";
import { navigateTo } from "../shared/actions.js";

const views = {
  "Waste Sites": [
    "Transfer station · Awka South",
    "Recovery point · Onitsha North",
  ],
  "Waste Collection": [
    "Route P-18 · collection schedule preview",
    "Route P-22 · vehicle assignment preview",
  ],
  "Disposal Facilities": ["Controlled disposal facility · prototype profile"],
};
export function WasteManagementPage() {
  const [view, setView] = useState<keyof typeof views>("Waste Sites");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Waste Management"
        description="Presentation shells for sites, collections and disposal facilities."
      />
      <SummaryCards
        items={[
          { label: "Prototype sites", value: 2 },
          { label: "Collection routes", value: 2 },
          { label: "Disposal facilities", value: 1 },
          { label: "Production records", value: 0 },
        ]}
      />
      <div className="emis-tabs" role="tablist">
        {Object.keys(views).map((v) => (
          <button
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v as keyof typeof views)}
            key={v}
          >
            {v}
          </button>
        ))}
      </div>
      <FilterBar>
        <input
          aria-label="Filter waste records"
          placeholder="Filter current view"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="emis-action"
          onClick={() => setQuery("")}
        >
          Clear filter
        </button>
        <button
          type="button"
          className="emis-action"
          onClick={() => navigateTo("#/facilities")}
        >
          Back to facilities
        </button>
      </FilterBar>
      <div className="emis-module-grid">
        {views[view]
          .filter((item) => item.toLowerCase().includes(query.toLowerCase()))
          .map((item) => (
            <button
              type="button"
              className="emis-card emis-card-action"
              key={item}
              onClick={() => setSelected(item)}
            >
              <h3>{item}</h3>
              <p className="emis-muted">No production backend is connected.</p>
              <PrototypeLabel />
            </button>
          ))}
      </div>
      {selected && (
        <DetailPanel title={selected} onClose={() => setSelected(null)}>
          <p>
            This is a non-persistent detail preview. Operational records are
            available in production implementation phase.
          </p>
          <button
            type="button"
            className="emis-action"
            onClick={() => navigateTo("#/gis")}
          >
            Open environmental map
          </button>
        </DetailPanel>
      )}
    </div>
  );
}
