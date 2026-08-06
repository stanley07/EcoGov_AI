import { useState } from "react";
import { ModuleHeader, PrototypeLabel } from "../shared/EnvironmentalUI.js";

const modes = [
  "Air Quality",
  "Water Quality",
  "Noise Monitoring",
  "Laboratory Results",
] as const;
export function EnvironmentalMonitoringPage() {
  const [mode, setMode] = useState<(typeof modes)[number]>("Air Quality");
  return (
    <div className="emis-page">
      <ModuleHeader
        title="Environmental Monitoring"
        description="Station and laboratory result presentation workspace."
      />
      <div className="emis-tabs" role="tablist">
        {modes.map((v) => (
          <button
            role="tab"
            aria-selected={mode === v}
            onClick={() => setMode(v)}
            key={v}
          >
            {v}
          </button>
        ))}
      </div>
      <article className="emis-card">
        <div className="emis-section-title">
          <h2>{mode}</h2>
          <PrototypeLabel />
        </div>
        <div className="emis-empty">
          <strong>No production monitoring records</strong>
          <p>
            Sensor ingestion, calibration, units and laboratory chain-of-custody
            are deferred to the production slice.
          </p>
        </div>
      </article>
    </div>
  );
}
