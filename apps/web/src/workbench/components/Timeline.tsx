import { useState } from "react";
import { TimelineEvent } from "../types/workbench.js";

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={{ marginTop: "30px" }}>
      <h3 style={{ borderBottom: "1px solid #334155", paddingBottom: "10px", color: "#38bdf8" }}>
        ⌛ Execution Timeline
      </h3>
      <div style={{ display: "grid", gap: "20px", marginTop: "15px" }}>
        {events.map((evt) => {
          const isExpanded = expandedId === evt.eventId;
          return (
            <div
              key={evt.eventId}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "15px",
                cursor: "pointer",
              }}
              onClick={() => setExpandedId(isExpanded ? null : evt.eventId)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong style={{ color: "#f1f5f9" }}>{evt.title}</strong>
                  <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>
                    {evt.summary}
                  </div>
                </div>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    background: evt.status === "completed" ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 191, 36, 0.15)",
                    color: evt.status === "completed" ? "#34d399" : "#fbbf24",
                  }}
                >
                  {evt.status.toUpperCase()}
                </span>
              </div>

              {isExpanded && (
                <div
                  style={{
                    marginTop: "12px",
                    paddingTop: "12px",
                    borderTop: "1px solid #334155",
                    fontSize: "0.85rem",
                    color: "#94a3b8",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div><strong>Occurred At:</strong> {new Date(evt.occurredAt).toLocaleString()}</div>
                  <div><strong>Actor Type:</strong> {evt.actorType.toUpperCase()}</div>
                  {evt.metadata && (
                    <div style={{ background: "#0f172a", padding: "8px", borderRadius: "4px", marginTop: "5px" }}>
                      <pre style={{ margin: 0, overflowX: "auto" }}>
                        {JSON.stringify(evt.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
