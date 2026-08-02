import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("AppErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Force refresh the active component/page view
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== "undefined") {
      window.location.hash = "#/dashboard";
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "400px",
            padding: "40px",
            background: "#1e293b",
            borderRadius: "12px",
            border: "1px solid #334155",
            color: "#f1f5f9",
            textAlign: "center",
            margin: "20px",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0 0 12px 0", color: "#f87171" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#94a3b8", maxWidth: "500px", margin: "0 0 24px 0", fontSize: "0.95rem" }}>
            An unexpected error occurred while rendering this module. Safe diagnostics state has been engaged.
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: "10px 20px",
                background: "#38bdf8",
                color: "#0f172a",
                border: "none",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
                minWidth: "120px",
                fontSize: "0.9rem",
              }}
            >
              Retry Load
            </button>
            <button
              onClick={this.handleGoHome}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: "1px solid #475569",
                color: "#cbd5e1",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
                minWidth: "120px",
                fontSize: "0.9rem",
              }}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
