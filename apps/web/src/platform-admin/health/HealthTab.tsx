import { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface OutboxMetrics {
  queueDepth: number;
  processingCount: number;
  dispatchesTotal: number;
  postgresStatus: string;
  migrationsStatus: string;
}

interface ProviderTelemetry {
  providerName: string;
  successRate: number;
  timeoutRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

interface HealthTabProps {
  token: string;
}

export function HealthTab({ token }: HealthTabProps) {
  const [outbox, setOutbox] = useState<OutboxMetrics | null>(null);
  const [providers, setProviders] = useState<ProviderTelemetry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");
      const headers = { Authorization: `Bearer ${token}` };
      const [outboxRes, providersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/v1/operational/health`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/operational/providers`, { headers })
      ]);

      if (outboxRes.status === 403 || providersRes.status === 403) {
        throw new Error("Access Denied: The platform.health.read permission is required to view operational health analytics.");
      }

      if (!outboxRes.ok || !providersRes.ok) {
        throw new Error("Failed to query operational health or provider telemetry logs");
      }

      setOutbox(await outboxRes.json());
      setProviders(await providersRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  return (
    <div style={{ display: "grid", gap: "30px" }}>
      {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>{error}</div>}

      {/* Database & Migration Integrity Diagnostics */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
        <div style={{ background: "rgba(30, 41, 59, 0.6)", backdropFilter: "blur(12px)", padding: "24px", borderRadius: "12px", border: "1px solid #334155" }}>
          <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>PostgreSQL Connection</h3>
          <span style={{ fontSize: "1.8rem", fontWeight: 800, color: outbox?.postgresStatus === "connected" ? "#34d399" : "#f87171", display: "block", marginTop: "10px", lineHeight: "1.1" }}>
            {loading ? "..." : (outbox?.postgresStatus?.toUpperCase() || "DISCONNECTED")}
          </span>
          <small style={{ display: "block", color: "#64748b", marginTop: "6px" }}>Core relational storage connectivity status</small>
        </div>
        <div style={{ background: "rgba(30, 41, 59, 0.6)", backdropFilter: "blur(12px)", padding: "24px", borderRadius: "12px", border: "1px solid #334155" }}>
          <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Schema Migrations</h3>
          <span style={{ fontSize: "1.8rem", fontWeight: 800, color: outbox?.migrationsStatus === "current" ? "#34d399" : "#fbbf24", display: "block", marginTop: "10px", lineHeight: "1.1" }}>
            {loading ? "..." : (outbox?.migrationsStatus === "current" ? "CURRENT (v000025)" : "PENDING")}
          </span>
          <small style={{ display: "block", color: "#64748b", marginTop: "6px" }}>Database schema version and migrations locks</small>
        </div>
      </section>

      {/* Outbox Pipeline Health cards */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
        {[
          { label: "Outbox Queue Depth", val: `${outbox?.queueDepth || 0} pending`, desc: "Events queued in outbox", color: "#38bdf8" },
          { label: "Active Processing", val: `${outbox?.processingCount || 0} active`, desc: "Worker leases currently locked", color: "#fbbf24" },
          { label: "Outbox Flow Rate", val: `${((outbox?.dispatchesTotal || 0) / 3600).toFixed(2)}/sec`, desc: "Average windowed event rate", color: "#34d399" }
        ].map((c, i) => (
          <div key={i} style={{ background: "rgba(30, 41, 59, 0.6)", backdropFilter: "blur(12px)", padding: "24px", borderRadius: "12px", border: "1px solid #334155" }}>
            <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</h3>
            <span style={{ fontSize: "1.8rem", fontWeight: 800, color: c.color, display: "block", marginTop: "10px", lineHeight: "1.1" }}>
              {loading ? "..." : c.val}
            </span>
            <small style={{ display: "block", color: "#64748b", marginTop: "6px" }}>{c.desc}</small>
          </div>
        ))}
      </section>

      {/* Provider & Model API Health */}
      <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", overflow: "hidden" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>📡 LLM Provider API Telemetry</h2>
          <button onClick={fetchData} style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontWeight: "bold" }}>🔄 Force Refresh</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#0f172a", color: "#94a3b8", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "15px 20px" }}>Provider ID</th>
                <th style={{ padding: "15px 20px" }}>Model Key</th>
                <th style={{ padding: "15px 20px" }}>Success Rate</th>
                <th style={{ padding: "15px 20px" }}>Timeout Rate</th>
                <th style={{ padding: "15px 20px" }}>Mean Latency</th>
                <th style={{ padding: "15px 20px" }}>Status Indicator</th>
              </tr>
            </thead>
            <tbody>
              {loading && providers.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading model telemetry records...</td></tr>
              ) : providers.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No model call telemetry found.</td></tr>
              ) : (
                providers.map((p, i) => {
                  const healthScore = p.successRate;
                  const isHealthy = healthScore >= 0.95;
                  const isWarning = healthScore < 0.95 && healthScore >= 0.80;
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #334155" }}>
                      <td style={{ padding: "15px 20px", fontWeight: "bold", textTransform: "capitalize" }}>{p.providerName}</td>
                      <td style={{ padding: "15px 20px" }}><code style={{ color: "#38bdf8" }}>Gemini</code></td>
                      <td style={{ padding: "15px 20px" }}>
                        <span style={{ color: isHealthy ? "#34d399" : isWarning ? "#fbbf24" : "#f87171", fontWeight: "bold" }}>
                          {(p.successRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: "15px 20px", color: p.timeoutRate > 0.05 ? "#f87171" : "#cbd5e1" }}>
                        {(p.timeoutRate * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "15px 20px" }}>{p.p50LatencyMs.toLocaleString()} ms</td>
                      <td style={{ padding: "15px 20px" }}>
                        <span style={{
                          padding: "4px 8px", borderRadius: "4px", fontSize: "0.8rem", fontWeight: "bold",
                          background: isHealthy ? "rgba(52, 211, 153, 0.2)" : isWarning ? "rgba(251, 191, 36, 0.2)" : "rgba(239, 68, 68, 0.2)",
                          color: isHealthy ? "#34d399" : isWarning ? "#fde047" : "#fca5a5"
                        }}>
                          {isHealthy ? "ONLINE" : isWarning ? "DEGRADED" : "CRITICAL"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
