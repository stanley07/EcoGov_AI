import React from "react";

export type UnavailableReason =
  | "module_not_implemented"
  | "module_not_enabled"
  | "permission_denied"
  | "insufficient_data"
  | "timeline_service_not_activated";

export interface ModuleAvailabilityPanelProps {
  title: string;
  reason: UnavailableReason;
  description?: string;
}

export const ModuleAvailabilityPanel: React.FC<
  ModuleAvailabilityPanelProps
> = ({ title, reason, description }) => {
  const getWording = () => {
    switch (reason) {
      case "module_not_implemented":
        return {
          header: `${title} is planned for a future milestone`,
          sub:
            description ||
            "This module is part of the EMIS v2.0 roadmap and is currently under active development. Keep track of system updates for deployment timelines.",
          icon: "🛠️",
        };
      case "module_not_enabled":
        return {
          header: `${title} is not yet activated for this workspace`,
          sub:
            description ||
            "This capability has not been enabled for your organization unit. Please reach out to your administrator to request activation.",
          icon: "⚙️",
        };
      case "permission_denied":
        return {
          header: `Access to ${title} restricted`,
          sub:
            description ||
            "You do not hold the required permission claims to view or access this environmental module.",
          icon: "🔒",
        };
      case "insufficient_data":
        return {
          header: `No metrics available for ${title}`,
          sub:
            description ||
            "The system requires additional environmental records to compute and display statistics for this module.",
          icon: "📊",
        };
      case "timeline_service_not_activated":
        return {
          header: "Operational Timeline Service is not active",
          sub:
            description ||
            "The universal timeline service is scheduled for activation in EMIS-1C. Real-time logging is currently inactive.",
          icon: "⏳",
        };
      default:
        return {
          header: `${title} is unavailable`,
          sub: description || "This module is currently unavailable.",
          icon: "❌",
        };
    }
  };

  const wording = getWording();

  return (
    <div
      role={reason === "permission_denied" ? "alert" : "status"}
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        background: "#1e293b",
        borderRadius: "12px",
        border: "1px solid #334155",
        color: "#f1f5f9",
        textAlign: "center",
        maxWidth: "600px",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <div
        aria-hidden="true"
        style={{ fontSize: "3.5rem", marginBottom: "20px" }}
      >
        {wording.icon}
      </div>
      <h2
        style={{
          fontSize: "1.4rem",
          fontWeight: "bold",
          margin: "0 0 12px 0",
          color: "#38bdf8",
        }}
      >
        {wording.header}
      </h2>
      <p
        style={{
          color: "#94a3b8",
          fontSize: "0.95rem",
          lineHeight: "1.6",
          margin: "0 0 28px 0",
        }}
      >
        {wording.sub}
      </p>
      <div
        style={{
          fontSize: "0.75rem",
          color: "#475569",
          borderTop: "1px solid #334155",
          paddingTop: "16px",
          width: "100%",
        }}
      >
        GovOS Platform Services &bull; Environment Division &bull; Status:{" "}
        <strong style={{ color: "#64748b" }}>{reason.toUpperCase()}</strong>
      </div>
    </div>
  );
};
