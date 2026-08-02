import React from "react";
import { Breadcrumb } from "./Breadcrumb.js";

export interface TopBarProps {
  pageTitle: string;
  tenantName: string;
  userName: string;
  userRoles: readonly string[];
  onOpenMobileSidebar: () => void;
  isMobileSidebarOpen: boolean;
  breadcrumbItems: readonly string[];
}

export const TopBar: React.FC<TopBarProps> = ({
  pageTitle,
  tenantName,
  userName,
  userRoles,
  onOpenMobileSidebar,
  isMobileSidebarOpen,
  breadcrumbItems,
}) => {
  return (
    <header
      aria-label="Application header"
      style={{
        height: "70px",
        background: "#1e293b",
        borderBottom: "1px solid #334155",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* Left side: Mobile Toggle & Page context */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {/* Mobile menu toggle (minimum touch target 44px) */}
        <button
          onClick={onOpenMobileSidebar}
          aria-expanded={isMobileSidebarOpen}
          aria-controls="mobile-sidebar-drawer"
          aria-label="Open navigation menu"
          disabled={isMobileSidebarOpen}
          style={{
            display: "none", // Managed by media queries in layout container
            alignItems: "center",
            justifyContent: "center",
            width: "44px",
            height: "44px",
            background: "transparent",
            border: "1px solid #334155",
            borderRadius: "6px",
            color: "#f1f5f9",
            cursor: "pointer",
            fontSize: "1.2rem",
            padding: 0,
            outline: "none",
          }}
          className="mobile-sidebar-toggle"
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 2px #38bdf8";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          ☰
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {/* Breadcrumb container */}
          <Breadcrumb items={breadcrumbItems} />
          <h1
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: "bold",
              color: "#f8fafc",
              lineHeight: "1.2",
            }}
          >
            {pageTitle}
          </h1>
        </div>
      </div>

      {/* Right side: Tenant & User badges */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
        className="topbar-user-section"
      >
        {/* Tenant workspace name */}
        <div
          style={{
            fontSize: "0.8rem",
            background: "#0f172a",
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid #334155",
            color: "#cbd5e1",
            maxWidth: "180px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`Active Workspace: ${tenantName}`}
        >
          🏢 {tenantName}
        </div>

        {/* User identification */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              color: "#f1f5f9",
              maxWidth: "120px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={userName}
          >
            {userName}
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              color: "#38bdf8",
              textTransform: "uppercase",
              fontWeight: "bold",
              marginTop: "2px",
            }}
          >
            {userRoles[0]?.replace("_", " ") || "USER"}
          </span>
        </div>
      </div>

      {/* Media query styling for responsive toggle */}
      <style>{`
        @media (max-width: 1024px) {
          .mobile-sidebar-toggle {
            display: flex !important;
          }
          .topbar-user-section {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
};
