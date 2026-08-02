import { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface UsageSummary {
  estimatedCostMicrounits: string;
  reservedCostMicrounits: string;
  actualCostMicrounits: string;
}

interface TimeseriesPoint {
  day: string; // UTC date string
  estimatedCostMicrounits: string;
  reservedCostMicrounits: string;
  actualCostMicrounits: string;
}

interface Anomaly {
  executionId: string;
  tenantId: string;
  tenantSlug: string;
  estimatedCostMicrounits: string;
  reservedCostMicrounits: string;
  actualCostMicrounits: string;
  differenceMicrounits: string;
}

interface UsageTabProps {
  token: string;
}

export function UsageTab({ token }: UsageTabProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");
      const headers = { Authorization: `Bearer ${token}` };
      const [summaryRes, tsRes, anomalyRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/v1/usage/summary`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/usage/timeseries`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/usage/anomalies`, { headers })
      ]);

      if (!summaryRes.ok || !tsRes.ok || !anomalyRes.ok) {
        throw new Error("Failed to load platform accounting ledger metrics");
      }

      setSummary(await summaryRes.json());
      setTimeseries(await tsRes.json());
      setAnomalies(await anomalyRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const toUSD = (microunitsStr: string) => {
    const val = parseInt(microunitsStr || "0");
    return `$${(val / 1000000).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USD`;
  };

  return (
    <div style={{ display: "grid", gap: "30px" }}>
      {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>{error}</div>}

      {/* Microunit Cost Ledger Cards */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        {[
          { label: "Estimated AI cost", desc: "Admission admission estimates", val: summary?.estimatedCostMicrounits || "0", color: "#38bdf8" },
          { label: "Reserved AI cost", desc: "Durable budget reserves", val: summary?.reservedCostMicrounits || "0", color: "#fbbf24" },
          { label: "Actual AI cost", desc: "Settled actual execution costs", val: summary?.actualCostMicrounits || "0", color: "#34d399" }
        ].map((card, i) => (
          <div key={i} style={{ background: "rgba(30, 41, 59, 0.6)", backdropFilter: "blur(12px)", padding: "24px", borderRadius: "12px", border: "1px solid #334155" }}>
            <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{card.label}</h3>
            <span style={{ fontSize: "1.8rem", fontWeight: 800, color: card.color, display: "block", marginTop: "10px", lineHeight: "1.1" }}>
              {loading ? "..." : toUSD(card.val)}
            </span>
            <small style={{ display: "block", color: "#64748b", marginTop: "6px" }}>{card.desc} ({parseInt(card.val).toLocaleString()} μu)</small>
          </div>
        ))}
      </section>

      {/* Timeseries and Reconciliation Row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "25px" }}>
        {/* Timeseries Chart List */}
        <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", padding: "20px" }}>
          <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>📅 Daily Usage Aggregates (UTC time-series)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ color: "#94a3b8", borderBottom: "1px solid #334155" }}>
                  <th style={{ padding: "10px 15px" }}>UTC Date</th>
                  <th style={{ padding: "10px 15px" }}>Estimated Cost</th>
                  <th style={{ padding: "10px 15px" }}>Reserved Cost</th>
                  <th style={{ padding: "10px 15px" }}>Actual Settled Cost</th>
                </tr>
              </thead>
              <tbody>
                {loading && timeseries.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>Loading chart data...</td></tr>
                ) : timeseries.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>No historical ledger points recorded.</td></tr>
                ) : (
                  timeseries.map((pt, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #334155" }}>
                      <td style={{ padding: "12px 15px", fontWeight: "bold" }}>{pt.day.substring(0, 10)}</td>
                      <td style={{ padding: "12px 15px", color: "#38bdf8" }}>{toUSD(pt.estimatedCostMicrounits)}</td>
                      <td style={{ padding: "12px 15px", color: "#fbbf24" }}>{toUSD(pt.reservedCostMicrounits)}</td>
                      <td style={{ padding: "12px 15px", color: "#34d399" }}>{toUSD(pt.actualCostMicrounits)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cost Reconciliation Anomalies */}
        <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", padding: "20px" }}>
          <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>⚠️ Budget Reconciliation Alerts</h3>
          <div style={{ display: "grid", gap: "10px", maxHeight: "350px", overflowY: "auto" }}>
            {loading && anomalies.length === 0 ? (
              <p style={{ color: "#64748b" }}>Loading anomalies database...</p>
            ) : anomalies.length === 0 ? (
              <div style={{ background: "rgba(52, 211, 153, 0.1)", border: "1px solid #34d399", color: "#a7f3d0", padding: "15px", borderRadius: "8px" }}>
                <strong>No anomalies detected!</strong>
                <p style={{ margin: "5px 0 0", fontSize: "0.85rem" }}>All execution costs reconcile correctly within standard model tolerance bounds.</p>
              </div>
            ) : (
              anomalies.map((anom, i) => (
                <div key={i} style={{ background: "#0f172a", border: "1px solid #7f1d1d", padding: "12px 15px", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#fca5a5", fontWeight: "bold", fontSize: "0.85rem" }}>DISCREPANCY DETECTED</span>
                    <span style={{ color: "#fca5a5", fontSize: "0.8rem" }}>{anom.tenantSlug}</span>
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "0.8rem", color: "#cbd5e1" }}>
                    <div>Exec: <code style={{ color: "#94a3b8" }}>{anom.executionId.substring(0, 8)}</code></div>
                    <div style={{ marginTop: "4px" }}>Reserve: {toUSD(anom.reservedCostMicrounits)}</div>
                    <div>Actual: {toUSD(anom.actualCostMicrounits)}</div>
                    <div style={{ color: "#f87171", fontWeight: "bold", marginTop: "4px" }}>Diff: +{toUSD(anom.differenceMicrounits)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
