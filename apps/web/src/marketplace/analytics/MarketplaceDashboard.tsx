import { useEffect, useState } from "react";

export type WidgetState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: any; refreshedAt: string }
  | { status: "empty"; refreshedAt: string }
  | { status: "error"; code: string; retryable: boolean };

interface MarketplaceDashboardProps {
  token: string;
}

const API_BASE_URL = "http://localhost:8080";

export function MarketplaceDashboard({ token }: MarketplaceDashboardProps) {
  // Filter states
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedLga, setSelectedLga] = useState("");
  const [selectedCluster, setSelectedCluster] = useState("");
  const [selectedLicenseType, setSelectedLicenseType] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");

  // Metadata dropdown values
  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [clusters, setClusters] = useState<{ id: string; name: string; lgaId: string }[]>([]);

// Loaded analytics data states
  const [summary, setSummary] = useState<WidgetState>({ status: "idle" });
  const [funnel, setFunnel] = useState<WidgetState>({ status: "idle" });
  const [screening, setScreening] = useState<WidgetState>({ status: "idle" });
  const [revenue, setRevenue] = useState<WidgetState>({ status: "idle" });
  const [licences, setLicences] = useState<WidgetState>({ status: "idle" });
  const [assignments, setAssignments] = useState<WidgetState>({ status: "idle" });
  const [acquisition, setAcquisition] = useState<WidgetState>({ status: "idle" });
  const [quality, setQuality] = useState<WidgetState>({ status: "idle" });

  // Helper to fetch filter values
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        // Load static/dynamic LGAs and Clusters matching seed scenario
        setLgas([
          { id: "lga-1", name: "Awka South" },
          { id: "lga-2", name: "Onitsha South" },
          { id: "lga-3", name: "Nnewi North" }
        ]);
        setClusters([
          { id: "c-1", name: "Awka Central", lgaId: "lga-1" },
          { id: "c-2", name: "Awka North-East", lgaId: "lga-1" },
          { id: "c-3", name: "Onitsha Market", lgaId: "lga-2" },
          { id: "c-4", name: "Onitsha Port", lgaId: "lga-2" },
          { id: "c-5", name: "Nnewi Industrial", lgaId: "lga-3" },
          { id: "c-6", name: "Nnewi Commercial", lgaId: "lga-3" }
        ]);
      } catch (err) {
        console.error("Failed to load filters", err);
      }
    };
    fetchMetadata();
  }, [token]);

  const fetchWidget = async (
    _key: string,
    endpoint: string,
    setter: (state: WidgetState) => void,
    queryStr: string,
    headers: any
  ) => {
    setter({ status: "loading" });
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}${queryStr}`, { headers });
      if (!res.ok) {
        setter({
          status: "error",
          code: `HTTP_${res.status}`,
          retryable: true
        });
        return;
      }
      const payload = await res.json();
      setter({
        status: "success",
        data: payload,
        refreshedAt: new Date().toLocaleTimeString()
      });
    } catch (err: any) {
      setter({
        status: "error",
        code: "NETWORK_ERROR",
        retryable: true
      });
    }
  };

  // Fetch all analytics modules
  const fetchAnalytics = async () => {
    const queryParams = new URLSearchParams();
    if (from) queryParams.append("from", new Date(from).toISOString());
    if (to) queryParams.append("to", new Date(to).toISOString());
    if (selectedLga) queryParams.append("lgaId", selectedLga);
    if (selectedCluster) queryParams.append("clusterId", selectedCluster);
    if (selectedLicenseType) queryParams.append("licenceType", selectedLicenseType);
    if (selectedCurrency) queryParams.append("currency", selectedCurrency);

    const headers = { Authorization: `Bearer ${token}` };
    const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

    const endpoints = [
      { key: "summary", url: "/officer/marketplace/analytics/summary", setter: setSummary },
      { key: "funnel", url: "/officer/marketplace/analytics/funnel", setter: setFunnel },
      { key: "screening", url: "/officer/marketplace/analytics/screening", setter: setScreening },
      { key: "revenue", url: "/officer/marketplace/analytics/revenue", setter: setRevenue },
      { key: "licences", url: "/officer/marketplace/analytics/licences", setter: setLicences },
      { key: "assignments", url: "/officer/marketplace/analytics/assignments", setter: setAssignments },
      { key: "acquisition", url: "/officer/marketplace/analytics/acquisition", setter: setAcquisition },
      { key: "quality", url: "/officer/marketplace/analytics/quality", setter: setQuality }
    ];

    await Promise.allSettled(
      endpoints.map(ep => fetchWidget(ep.key, ep.url, ep.setter, queryStr, headers))
    );
  };

  const triggerRetry = (key: string) => {
    const queryParams = new URLSearchParams();
    if (from) queryParams.append("from", new Date(from).toISOString());
    if (to) queryParams.append("to", new Date(to).toISOString());
    if (selectedLga) queryParams.append("lgaId", selectedLga);
    if (selectedCluster) queryParams.append("clusterId", selectedCluster);
    if (selectedLicenseType) queryParams.append("licenceType", selectedLicenseType);
    if (selectedCurrency) queryParams.append("currency", selectedCurrency);

    const headers = { Authorization: `Bearer ${token}` };
    const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

    const map: Record<string, { url: string; setter: (s: WidgetState) => void }> = {
      summary: { url: "/officer/marketplace/analytics/summary", setter: setSummary },
      funnel: { url: "/officer/marketplace/analytics/funnel", setter: setFunnel },
      screening: { url: "/officer/marketplace/analytics/screening", setter: setScreening },
      revenue: { url: "/officer/marketplace/analytics/revenue", setter: setRevenue },
      licences: { url: "/officer/marketplace/analytics/licences", setter: setLicences },
      assignments: { url: "/officer/marketplace/analytics/assignments", setter: setAssignments },
      acquisition: { url: "/officer/marketplace/analytics/acquisition", setter: setAcquisition },
      quality: { url: "/officer/marketplace/analytics/quality", setter: setQuality }
    };

    const target = map[key];
    if (target) {
      fetchWidget(key, target.url, target.setter, queryStr, headers);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [token, from, to, selectedLga, selectedCluster, selectedLicenseType, selectedCurrency]);


  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: "#f1f5f9" }}>
      {/* Dashboard Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "2.2rem", fontWeight: 700, color: "#38bdf8", letterSpacing: "-0.025em" }}>
            💼 Subcontractor Marketplace Dashboard
          </h1>
          <p style={{ margin: "5px 0 0 0", color: "#94a3b8", fontSize: "0.95rem" }}>
            Automatically refreshed analytics, revenue reconciliation, and performance monitoring for subcontractors.
          </p>
        </div>
        <button
          onClick={fetchAnalytics}
          style={{
            background: "#0284c7",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "10px 20px",
            cursor: "pointer",
            fontWeight: "bold",
            transition: "background 0.2s"
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "#0369a1")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#0284c7")}
        >
          🔄 Refresh Dashboard
        </button>
      </div>

      {/* Filter panel */}
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "30px"
        }}
      >
        <h3 style={{ margin: "0 0 15px 0", fontSize: "1rem", color: "#f8fafc" }}>🔍 Filter Scope</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>From Date</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>To Date</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>LGA Territory</label>
            <select
              value={selectedLga}
              onChange={(e) => {
                setSelectedLga(e.target.value);
                setSelectedCluster(""); // Reset cluster when LGA changes
              }}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            >
              <option value="">All LGAs</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>{lga.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>Cluster Territory</label>
            <select
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            >
              <option value="">All Clusters</option>
              {clusters
                .filter((c) => !selectedLga || c.lgaId === selectedLga)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>Licence Type</label>
            <select
              value={selectedLicenseType}
              onChange={(e) => setSelectedLicenseType(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            >
              <option value="">All Types</option>
              <option value="environmental-consultant">Environmental Consultant</option>
              <option value="waste-collector">Waste Collector</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "5px" }}>Currency</label>
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "6px",
                padding: "8px",
                color: "#f1f5f9"
              }}
            >
              <option value="">All Currencies</option>
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
      </div>

      {summary.status === "loading" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "30px" }}>
          {[1, 2, 3, 4, 5].map((idx) => (
            <div key={idx} style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "12px", height: "90px" }}>
              <div style={{ width: "60%", height: "14px", background: "#334155", borderRadius: "4px" }} />
              <div style={{ width: "40%", height: "24px", background: "#334155", borderRadius: "4px", marginTop: "10px" }} />
            </div>
          ))}
        </div>
      )}

      {summary.status === "error" && (
        <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "20px", borderRadius: "12px", marginBottom: "30px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠️ Failed to load summary KPIs ({summary.code})</span>
          <button onClick={() => triggerRetry("summary")} style={{ padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>Retry</button>
        </div>
      )}

      {summary.status === "success" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "30px" }}>
          {[
            { label: "Total Applications", value: summary.data.data.funnelSummary?.draftCount ?? summary.data.data.totalApplications ?? 0, color: "#38bdf8" },
            { label: "Active Licences", value: summary.data.data.licenceSummary?.activeCount ?? summary.data.data.activeLicences ?? 0, color: "#10b981" },
            { label: "Active Assignments", value: summary.data.data.assignmentSummary?.activeCount ?? summary.data.data.activeAssignments ?? 0, color: "#a855f7" },
            { label: "Total Facilities", value: summary.data.data.acquisitionSummary?.totalRegistered ?? summary.data.data.totalFacilities ?? 0, color: "#f59e0b" },
            { label: "Active Warnings", value: summary.data.data.qualitySummary?.activeWarnings ?? summary.data.data.activeWarnings ?? 0, color: "#ef4444" }
          ].map((kpi, idx) => (
            <div key={idx} style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "12px", display: "flex", flexDirection: "column" }}>
              <span style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 500 }}>{kpi.label}</span>
              <span style={{ fontSize: "2rem", fontWeight: 800, color: kpi.color, marginTop: "8px", lineHeight: 1 }}>
                {kpi.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "30px", marginBottom: "30px" }}>
        {/* Funnel Module */}
        <WidgetContainer
          title="🎯 Onboarding Conversion Funnel"
          state={funnel}
          onRetry={() => triggerRetry("funnel")}
        >
          {(res) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              {[
                { label: "Draft State", count: res.data.draftCount, pct: 100 },
                { label: "Submitted State", count: res.data.submittedCount, pct: Math.round(res.data.submissionRate * 100) },
                { label: "Approved State", count: res.data.approvedCount, pct: Math.round(res.data.approvalRate * 100) },
                { label: "Licence Issued", count: res.data.licensedCount, pct: Math.round(res.data.licenceRate * 100) }
              ].map((fStage, idx) => (
                <div key={idx}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.9rem" }}>
                    <span style={{ fontWeight: 600 }}>{fStage.label}</span>
                    <span style={{ color: "#94a3b8" }}>
                      {fStage.count} ({isNaN(fStage.pct) ? 0 : fStage.pct}%)
                    </span>
                  </div>
                  <div style={{ height: "10px", background: "#0f172a", borderRadius: "5px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${isNaN(fStage.pct) ? 0 : Math.min(fStage.pct, 100)}%`,
                        background: "linear-gradient(90deg, #38bdf8, #0284c7)",
                        borderRadius: "5px",
                        transition: "width 0.5s ease-out"
                      }}
                    />
                  </div>
                </div>
              ))}
              <div style={{ background: "#0f172a", padding: "12px", borderRadius: "6px", fontSize: "0.85rem", marginTop: "10px" }}>
                🤝 <strong>Agreement Rate:</strong> {res.data.agreementRate !== null ? `${Math.round(res.data.agreementRate * 100)}%` : "N/A"}{" "}
                <span style={{ color: "#64748b" }}>(Active Assignments / Valid Licences)</span>
              </div>
            </div>
          )}
        </WidgetContainer>

        {/* Screening Module */}
        <WidgetContainer
          title="🛡️ AI Screening Performance"
          state={screening}
          onRetry={() => triggerRetry("screening")}
        >
          {(res) => (
            <div>
              <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
                <div style={{ flex: 1, background: "#0f172a", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Average AI Score</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "5px", color: "#f59e0b" }}>
                    {res.data.averageScore ? parseFloat(res.data.averageScore).toFixed(1) : "0.0"}
                  </div>
                </div>
                <div style={{ flex: 1, background: "#0f172a", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Executions</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "5px" }}>
                    {res.data.totalScreened || 0}
                  </div>
                </div>
              </div>

              <h4 style={{ margin: "0 0 10px 0", fontSize: "0.9rem", color: "#94a3b8" }}>Recommendation Breakdown</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {res.data.recommendations && res.data.recommendations.map((rec: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      background: "#0f172a",
                      padding: "10px 15px",
                      borderRadius: "6px",
                      fontSize: "0.9rem"
                    }}
                  >
                    <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
                      {rec.recommendation.replace("_", " ")}
                    </span>
                    <span style={{ color: "#38bdf8" }}>{rec.count} applications</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WidgetContainer>
      </div>

      {/* Revenue and Quality Scorecard */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "30px", marginBottom: "30px" }}>
        {/* Revenue Module */}
        <WidgetContainer
          title="💰 Marketplace Revenue Ledger"
          state={revenue}
          onRetry={() => triggerRetry("revenue")}
        >
          {(res) => (
            res.data.currencies && res.data.currencies.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
                  <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Gross Revenue</span>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, marginTop: "5px", color: "#10b981" }}>
                      {res.data.currencies[0] ? `${res.data.currencies[0].grossRevenue.toFixed(2)} ${res.data.currencies[0].currency}` : "0.00 NGN"}
                    </div>
                  </div>
                  <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Net Revenue</span>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, marginTop: "5px", color: "#ef4444" }}>
                      {res.data.currencies[0] ? `${res.data.currencies[0].netRevenue.toFixed(2)} ${res.data.currencies[0].currency}` : "0.00 NGN"}
                    </div>
                  </div>
                </div>

                <h4 style={{ margin: "0 0 10px 0", fontSize: "0.9rem", color: "#94a3b8" }}>Ledger Breakdown by Currency</h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                        <th style={{ padding: "8px 0" }}>Currency</th>
                        <th>Gross Revenue</th>
                        <th>Net Revenue</th>
                        <th>Refunds</th>
                        <th>Chargebacks</th>
                        <th style={{ textAlign: "right" }}>Adjustments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.data.currencies.map((row: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #1e293b" }}>
                          <td style={{ padding: "8px 0", fontWeight: 600 }}>{row.currency}</td>
                          <td>{row.grossRevenue.toFixed(2)} {row.currency}</td>
                          <td>{row.netRevenue.toFixed(2)} {row.currency}</td>
                          <td style={{ color: "#ef4444" }}>{row.refunds.toFixed(2)} {row.currency}</td>
                          <td style={{ color: "#f59e0b" }}>{row.chargebacks.toFixed(2)} {row.currency}</td>
                          <td style={{ textAlign: "right", color: row.adjustments >= 0 ? "#10b981" : "#ef4444" }}>
                            {row.adjustments.toFixed(2)} {row.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <span style={{ color: "#64748b", fontSize: "0.9rem" }}>No ledger transactions recorded in this period.</span>
            )
          )}
        </WidgetContainer>

        {/* Quality Scorecard Module */}
        <WidgetContainer
          title="⭐️ Subcontractor Quality & Scorecard Distribution"
          state={quality}
          onRetry={() => triggerRetry("quality")}
        >
          {(res) => (
            <div>
              <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
                <div style={{ flex: 1, background: "#0f172a", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Average Quality Score</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "5px", color: "#10b981" }}>
                    {res.data.averagePerformanceScore ? parseFloat(res.data.averagePerformanceScore).toFixed(2) : "0.00"} / 5.00
                  </div>
                </div>
                <div style={{ flex: 1, background: "#0f172a", padding: "15px", borderRadius: "8px", textAlign: "center" }}>
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Audits Run</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "5px" }}>
                    {res.data.totalAudits || 0}
                  </div>
                </div>
              </div>

              <h4 style={{ margin: "0 0 10px 0", fontSize: "0.9rem", color: "#94a3b8" }}>Fixed Scorecard Buckets</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {res.data.scoreBuckets && Object.entries(res.data.scoreBuckets).map(([bucket, count]: any, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      background: "#0f172a",
                      padding: "10px 15px",
                      borderRadius: "6px",
                      fontSize: "0.85rem"
                    }}
                  >
                    <span style={{ color: "#94a3b8" }}>{bucket}</span>
                    <span style={{ fontWeight: 700, color: "#10b981" }}>{count} subs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WidgetContainer>
      </div>

      {/* Facility Onboarding & Subcontractor Attribution */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "30px", marginBottom: "30px" }}>
        <WidgetContainer
          title="🏢 Facility Onboarding & Subcontractor Attribution"
          state={acquisition}
          onRetry={() => triggerRetry("acquisition")}
        >
          {(res) => (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
              <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Registered</span>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "5px" }}>{res.data.totalRegistered}</div>
              </div>
              <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Completed Attributions</span>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "5px", color: "#10b981" }}>{res.data.completedAttributions}</div>
              </div>
              <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Duplicate Detections</span>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "5px", color: "#ef4444" }}>{res.data.duplicateRegistrations}</div>
              </div>
              <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Rejected Registrations</span>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "5px", color: "#f59e0b" }}>{res.data.rejectedRegistrations}</div>
              </div>
            </div>
          )}
        </WidgetContainer>
      </div>

      {/* Licences & Assignments Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "30px" }}>
        {/* Active Licences */}
        <WidgetContainer
          title="💳 Issued Subcontractor Licences"
          state={licences}
          onRetry={() => triggerRetry("licences")}
        >
          {(res) => (
            res.data && res.data.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                      <th style={{ padding: "10px 0" }}>Licence Number</th>
                      <th>Subcontractor</th>
                      <th>Type</th>
                      <th>Valid From</th>
                      <th>Expires At</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.data.map((lic: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "10px 0", fontWeight: 700, color: "#38bdf8" }}>{lic.licence_number}</td>
                        <td>{lic.business_name}</td>
                        <td>{lic.licence_type}</td>
                        <td>{new Date(lic.valid_from).toLocaleDateString()}</td>
                        <td>{new Date(lic.expires_at).toLocaleDateString()}</td>
                        <td>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "4px",
                              background: lic.status === "active" ? "#064e3b" : "#451a03",
                              color: lic.status === "active" ? "#34d399" : "#fbbf24",
                              fontSize: "0.75rem",
                              fontWeight: "bold"
                            }}
                          >
                            {lic.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span style={{ color: "#64748b", fontSize: "0.9rem" }}>No licences found in this tenant.</span>
            )
          )}
        </WidgetContainer>

        {/* Assignments & Territory */}
        <WidgetContainer
          title="🗺️ Active Territory Assignments"
          state={assignments}
          onRetry={() => triggerRetry("assignments")}
        >
          {(res) => (
            res.data && res.data.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                      <th style={{ padding: "10px 0" }}>Subcontractor</th>
                      <th>Assignment Type</th>
                      <th>Scope (LGA / Cluster)</th>
                      <th>Assigned At</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.data.map((asg: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "10px 0", fontWeight: 700 }}>{asg.business_name}</td>
                        <td style={{ textTransform: "capitalize" }}>{asg.assignment_type}</td>
                        <td style={{ color: "#38bdf8" }}>{asg.scope_name || asg.lga_id || asg.cluster_id}</td>
                        <td>{new Date(asg.starts_at).toLocaleDateString()}</td>
                        <td>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "4px",
                              background: asg.status === "active" ? "#064e3b" : "#451a03",
                              color: asg.status === "active" ? "#34d399" : "#fbbf24",
                              fontSize: "0.75rem",
                              fontWeight: "bold"
                            }}
                          >
                            {asg.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span style={{ color: "#64748b", fontSize: "0.9rem" }}>No active territory assignments found.</span>
            )
          )}
        </WidgetContainer>
      </div>

      {/* CSS Loader Animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function WidgetContainer({
  title,
  state,
  onRetry,
  children
}: {
  title: string;
  state: WidgetState;
  onRetry: () => void;
  children: (data: any) => React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: "12px",
        padding: "24px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minHeight: "200px"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid #334155", paddingBottom: "10px" }}>
        <h3 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>{title}</h3>
        {state.status === "success" && (
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
            Refreshed: {state.refreshedAt}
          </span>
        )}
      </div>

      {state.status === "loading" && (
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              border: "3px solid #334155",
              borderTop: "3px solid #38bdf8",
              borderRadius: "50%",
              width: "24px",
              height: "24px",
              animation: "spin 1s linear infinite"
            }}
          />
        </div>
      )}

      {state.status === "error" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#fca5a5", fontSize: "0.9rem" }}>⚠️ Failed to load metric ({state.code})</span>
          {state.retryable && (
            <button
              onClick={onRetry}
              style={{
                padding: "6px 12px",
                background: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: "bold"
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {state.status === "empty" && (
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: "0.9rem" }}>No data available for this range/filter.</span>
        </div>
      )}

      {state.status === "success" && children(state.data)}
    </div>
  );
}

