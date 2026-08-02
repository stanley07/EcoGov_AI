import React from "react";

export interface BreadcrumbProps {
  items: readonly string[];
  onNavigateItem?: (item: string) => void;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, onNavigateItem }) => {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "0.85rem",
        color: "#94a3b8",
        margin: 0,
        padding: 0,
      }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={`${item}-${index}`}>
            {index > 0 && <span aria-hidden="true" style={{ color: "#475569" }}>/</span>}
            {isLast ? (
              <span
                aria-current="page"
                style={{
                  color: "#cbd5e1",
                  fontWeight: 500,
                }}
              >
                {item}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigateItem?.(item)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "#38bdf8",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
                onMouseOver={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseOut={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                {item}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
