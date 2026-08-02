import React, { useEffect, useId, useState } from "react";

export interface ShellNavigationItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  isActive: boolean;
  isVisible: boolean;
  onSelect: () => void;
}

export interface ShellNavigationGroup {
  id: string;
  label: string;
  items: ShellNavigationItem[];
}

export interface SidebarProps {
  groups: readonly ShellNavigationGroup[];
  tenantName: string;
  userName: string;
  userRoleContext: string;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  groups,
  tenantName,
  userName,
  userRoleContext,
  onLogout,
}) => {
  const navigationId = useId().replace(/:/g, "");
  // Track expanded groups (default all expanded)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => groups.reduce((acc, g) => ({ ...acc, [g.id]: true }), {}),
  );

  useEffect(() => {
    setExpandedGroups((current) => {
      const next = { ...current };
      let changed = false;
      for (const group of groups) {
        if (next[group.id] === undefined) {
          next[group.id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [groups]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return (
    <aside
      style={{
        width: "100%",
        height: "100%",
        background: "#1e293b",
        borderRight: "1px solid #334155",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: "24px 20px",
          borderBottom: "1px solid #334155",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <img
          src="/minEnv.jpg"
          alt="Anambra State Ministry of Environment logo"
          style={{
            width: "56px",
            height: "56px",
            objectFit: "contain",
            borderRadius: "50%",
            background: "white",
            marginBottom: "12px",
            border: "1px solid #334155",
          }}
        />
        <h2
          style={{
            margin: 0,
            fontSize: "1.4rem",
            color: "#38bdf8",
            textAlign: "center",
          }}
        >
          EcoGov AI
        </h2>
        <span
          style={{
            fontSize: "0.75rem",
            color: "#94a3b8",
            marginTop: "6px",
            textAlign: "center",
            display: "block",
            lineHeight: "1.3",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={tenantName}
        >
          workspace:
          <br />
          <strong>{tenantName}</strong>
        </span>
      </div>

      {/* Navigation Group Items */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
        aria-label="Primary navigation"
      >
        {groups.map((group) => {
          const isExpanded = expandedGroups[group.id] !== false;
          const visibleItems = group.items.filter((item) => item.isVisible);

          if (visibleItems.length === 0) return null;

          return (
            <div
              key={group.id}
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              {/* Group Header Toggle Button (Min Height/Touch Target 44px) */}
              <button
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isExpanded}
                aria-controls={`${navigationId}-shell-navigation-group-${group.id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  minHeight: "44px",
                  background: "transparent",
                  border: "none",
                  padding: "0 8px",
                  color: "#64748b",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>{group.label}</span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    transition: "transform 0.2s",
                    transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                >
                  ▼
                </span>
              </button>

              {/* Collapsible Group Items */}
              {isExpanded && (
                <div
                  id={`${navigationId}-shell-navigation-group-${group.id}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  {visibleItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={item.onSelect}
                      aria-current={item.isActive ? "page" : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                        minHeight: "44px",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        background: item.isActive ? "#0f172a" : "transparent",
                        border: "none",
                        color: item.isActive ? "#38bdf8" : "#cbd5e1",
                        fontSize: "0.9rem",
                        fontWeight: item.isActive ? "bold" : "normal",
                        textAlign: "left",
                        cursor: "pointer",
                        boxSizing: "border-box",
                        outline: "none",
                        transition: "background 0.15s, color 0.15s",
                      }}
                      onMouseOver={(e) => {
                        if (!item.isActive) {
                          e.currentTarget.style.background = "#334155";
                          e.currentTarget.style.color = "#ffffff";
                        }
                      }}
                      onMouseOut={(e) => {
                        if (!item.isActive) {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "#cbd5e1";
                        }
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.boxShadow = "0 0 0 2px #38bdf8";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      {item.icon && (
                        <span style={{ fontSize: "1.1rem" }}>{item.icon}</span>
                      )}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User Footer Profile & Logout */}
      <div
        style={{
          padding: "20px 16px",
          borderTop: "1px solid #334155",
          background: "#0f172a",
          flexShrink: 0,
        }}
      >
        <div style={{ marginBottom: "12px" }}>
          <span
            style={{
              fontSize: "0.75rem",
              color: "#64748b",
              display: "block",
            }}
          >
            logged in as:
          </span>
          <strong
            style={{
              fontSize: "0.9rem",
              color: "#f1f5f9",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={userName}
          >
            {userName}
          </strong>
          <span
            style={{
              fontSize: "0.75rem",
              color: "#38bdf8",
              display: "block",
              textTransform: "uppercase",
              marginTop: "2px",
            }}
          >
            {userRoleContext}
          </span>
        </div>
        <button
          onClick={onLogout}
          style={{
            width: "100%",
            minHeight: "44px",
            padding: "10px",
            background: "#f87171",
            color: "#0f172a",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: "pointer",
            fontSize: "0.9rem",
            transition: "background 0.15s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "#f87171")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#ef4444")}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 2px #fca5a5";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
};
