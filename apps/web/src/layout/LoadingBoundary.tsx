import React, { useEffect } from "react";

export type LoadingVariant = "page" | "metric" | "table" | "card" | "profile";

export interface LoadingBoundaryProps {
  isLoading: boolean;
  variant?: LoadingVariant;
  children: React.ReactNode;
}

export const LoadingBoundary: React.FC<LoadingBoundaryProps> = ({
  isLoading,
  variant = "page",
  children,
}) => {
  useEffect(() => {
    if (
      !isLoading ||
      typeof document === "undefined" ||
      document.getElementById("skeleton-animation-style")
    ) {
      return;
    }

    const style = document.createElement("style");
    style.id = "skeleton-animation-style";
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `;
    document.head.appendChild(style);
  }, [isLoading]);

  if (!isLoading) {
    return <>{children}</>;
  }

  // Common skeleton styling helper
  const skeletonPulseStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite linear",
    borderRadius: "8px",
  };

  const renderSkeleton = () => {
    switch (variant) {
      case "metric":
        return (
          <div
            style={{
              padding: "20px",
              background: "#1e293b",
              borderRadius: "10px",
              border: "1px solid #334155",
              width: "100%",
              height: "100px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{ ...skeletonPulseStyle, width: "60%", height: "16px" }}
            />
            <div
              style={{ ...skeletonPulseStyle, width: "40%", height: "32px" }}
            />
          </div>
        );

      case "card":
        return (
          <div
            style={{
              padding: "24px",
              background: "#1e293b",
              borderRadius: "12px",
              border: "1px solid #334155",
              width: "100%",
              height: "180px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{ ...skeletonPulseStyle, width: "50%", height: "20px" }}
            />
            <div
              style={{ ...skeletonPulseStyle, width: "90%", height: "14px" }}
            />
            <div
              style={{ ...skeletonPulseStyle, width: "80%", height: "14px" }}
            />
            <div
              style={{
                ...skeletonPulseStyle,
                width: "30%",
                height: "32px",
                marginTop: "auto",
              }}
            />
          </div>
        );

      case "profile":
        return (
          <div
            style={{
              padding: "30px",
              background: "#1e293b",
              borderRadius: "12px",
              border: "1px solid #334155",
              width: "100%",
              boxSizing: "border-box",
              display: "flex",
              gap: "24px",
            }}
          >
            <div
              style={{
                ...skeletonPulseStyle,
                width: "96px",
                height: "96px",
                borderRadius: "50%",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                flexGrow: 1,
                justifyContent: "center",
              }}
            >
              <div
                style={{ ...skeletonPulseStyle, width: "40%", height: "24px" }}
              />
              <div
                style={{ ...skeletonPulseStyle, width: "60%", height: "16px" }}
              />
              <div
                style={{ ...skeletonPulseStyle, width: "20%", height: "16px" }}
              />
            </div>
          </div>
        );

      case "table":
        return (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              border: "1px solid #334155",
              width: "100%",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "50px",
                background: "#0f172a",
                borderBottom: "1px solid #334155",
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
              }}
            >
              <div
                style={{ ...skeletonPulseStyle, width: "20%", height: "16px" }}
              />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  height: "70px",
                  borderBottom: i < 5 ? "1px solid #334155" : "none",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 20px",
                  gap: "24px",
                }}
              >
                <div
                  style={{
                    ...skeletonPulseStyle,
                    width: "40px",
                    height: "40px",
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    ...skeletonPulseStyle,
                    width: "25%",
                    height: "16px",
                  }}
                />
                <div
                  style={{
                    ...skeletonPulseStyle,
                    width: "15%",
                    height: "16px",
                  }}
                />
                <div
                  style={{
                    ...skeletonPulseStyle,
                    width: "15%",
                    height: "16px",
                  }}
                />
                <div
                  style={{
                    ...skeletonPulseStyle,
                    width: "35%",
                    height: "16px",
                  }}
                />
              </div>
            ))}
          </div>
        );

      case "page":
      default:
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "24px",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <div
                style={{ ...skeletonPulseStyle, width: "30%", height: "36px" }}
              />
              <div
                style={{ ...skeletonPulseStyle, width: "50%", height: "16px" }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "20px",
              }}
            >
              <div style={{ ...skeletonPulseStyle, height: "120px" }} />
              <div style={{ ...skeletonPulseStyle, height: "120px" }} />
              <div style={{ ...skeletonPulseStyle, height: "120px" }} />
            </div>
            <div style={{ ...skeletonPulseStyle, height: "350px" }} />
          </div>
        );
    }
  };

  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <span
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        Loading
      </span>
      {renderSkeleton()}
    </div>
  );
};
