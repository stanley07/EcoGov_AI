import { useState } from "react";
import {
  ModuleHeader,
  PrototypeLabel,
  SummaryCards,
} from "../shared/EnvironmentalUI.js";

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
      <div className="emis-module-grid">
        {views[view].map((item) => (
          <article className="emis-card" key={item}>
            <h3>{item}</h3>
            <p className="emis-muted">No production backend is connected.</p>
            <PrototypeLabel />
          </article>
        ))}
      </div>
    </div>
  );
}
