import React from "react";

export interface AccessDeniedPageProps {
  onBackToDashboard?: () => void;
}

export const AccessDeniedPage: React.FC<AccessDeniedPageProps> = ({
  onBackToDashboard,
}) => {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        background: "#1e293b",
        borderRadius: "12px",
        border: "1px solid #e11d48", // Rose border to indicate restriction
        color: "#f1f5f9",
        textAlign: "center",
        maxWidth: "600px",
        margin: "40px auto",
        boxSizing: "border-box",
      }}
    >
      <div
        aria-hidden="true"
        style={{ fontSize: "4rem", marginBottom: "20px" }}
      >
        🔒
      </div>
      <h2
        style={{
          fontSize: "1.6rem",
          fontWeight: "bold",
          margin: "0 0 12px 0",
          color: "#f43f5e",
        }}
      >
        Access Restricted
      </h2>
      <p
        style={{
          color: "#94a3b8",
          fontSize: "0.95rem",
          lineHeight: "1.6",
          margin: "0 0 28px 0",
          maxWidth: "450px",
        }}
      >
        You do not hold the authorized permission claims required to view this
        module. Please contact your system administrator if you believe this is
        in error.
      </p>
      {onBackToDashboard && (
        <button
          type="button"
          onClick={onBackToDashboard}
          style={{
            padding: "10px 20px",
            background: "#f43f5e",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: "pointer",
            fontSize: "0.9rem",
            transition: "background 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "#e11d48")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#f43f5e")}
          onFocus={(e) =>
            (e.currentTarget.style.boxShadow = "0 0 0 3px #fda4af")
          }
          onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
        >
          Return to Dashboard
        </button>
      )}
    </div>
  );
};
