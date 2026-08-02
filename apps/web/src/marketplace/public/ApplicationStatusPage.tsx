import React, { useState, useEffect } from "react";

const API_BASE_URL = "http://localhost:8080";

interface DocumentRecord {
  id: string;
  documentType: string;
  storageKey: string;
  scanStatus: string;
  verificationStatus: string;
}

export function ApplicationStatusPage() {
  const [appId, setAppId] = useState("");
  const [token, setToken] = useState("");
  const [statusData, setStatusData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Extract from hash URL e.g. #marketplace/status/:id
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      const parts = hash.split("/");
      if (parts.length === 3 && parts[1] === "status") {
        const idFromHash = parts[2];
        if (idFromHash) {
          setAppId(idFromHash);
          const savedToken = sessionStorage.getItem("subcontractor_token") || "";
          if (savedToken) {
            setToken(savedToken);
            fetchStatus(idFromHash, savedToken);
          }
        }
      }
    };

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const fetchStatus = async (targetId: string, targetToken: string) => {
    setErrorMsg("");
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/marketplace/applications/${targetId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: targetToken })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Lookup failed: please check your credentials");
      }

      const data = await res.json();
      setStatusData(data);
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatusData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId || !token) {
      setErrorMsg("Application ID and Access Token are required.");
      return;
    }
    fetchStatus(appId, token);
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case "licence_issued":
      case "approved":
        return { background: "rgba(16, 185, 129, 0.2)", color: "#34d399", border: "1px solid #10b981" };
      case "rejected":
        return { background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "1px solid #ef4444" };
      case "more_information_required":
        return { background: "rgba(245, 158, 11, 0.2)", color: "#fbbf24", border: "1px solid #f59e0b" };
      default:
        return { background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", border: "1px solid #0284c7" };
    }
  };

  return (
    <div style={{ maxWidth: "700px", margin: "40px auto", padding: "20px", fontFamily: "sans-serif" }}>
      <div style={{
        background: "rgba(30, 41, 59, 0.7)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "16px",
        padding: "40px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        color: "#f1f5f9"
      }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: "0 0 10px 0", color: "#38bdf8" }}>
          Application Status Inquiry
        </h1>
        <p style={{ margin: "0 0 30px 0", color: "#94a3b8" }}>
          Track screening progression and view administrative licensing outcomes.
        </p>

        {/* Credentials Form */}
        <form onSubmit={handleLookupSubmit} style={{ marginBottom: "30px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Application ID *</label>
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value.trim())}
                style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                placeholder="e.g. 550e8400-e29b-..."
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Access Token *</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                placeholder="Paste your 64-char one-time token"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "12px",
              background: "#38bdf8",
              color: "#0f172a",
              border: "none",
              borderRadius: "6px",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontWeight: "bold",
              fontSize: "14px"
            }}
          >
            {isLoading ? "Querying State..." : "Verify Status"}
          </button>
        </form>

        {errorMsg && (
          <div style={{ background: "rgba(239, 68, 68, 0.2)", border: "1px solid #ef4444", padding: "12px", borderRadius: "8px", color: "#fca5a5", marginBottom: "20px" }}>
            {errorMsg}
          </div>
        )}

        {/* Status Report */}
        {statusData && (
          <div style={{ background: "rgba(15, 23, 42, 0.4)", border: "1px solid #334155", padding: "25px", borderRadius: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "16px", color: "#cbd5e1" }}>Current Tracking State:</span>
              <span style={{
                padding: "4px 12px",
                borderRadius: "20px",
                fontSize: "13px",
                fontWeight: "bold",
                ...getStatusBadgeStyle(statusData.status)
              }}>
                {statusData.status.toUpperCase().replace(/_/g, " ")}
              </span>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", marginBottom: "20px" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "10px 0", color: "#64748b" }}>Version Identifier:</td>
                  <td style={{ padding: "10px 0", fontWeight: "bold", textAlign: "right" }}>v{statusData.version}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "10px 0", color: "#64748b" }}>Last Modified:</td>
                  <td style={{ padding: "10px 0", fontWeight: "bold", textAlign: "right" }}>{new Date(statusData.updatedAt).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>

            {/* Required actions warning if more info is needed */}
            {statusData.requiredActions.length > 0 && (
              <div style={{ background: "rgba(245, 158, 11, 0.15)", border: "1px solid #f59e0b", padding: "15px", borderRadius: "8px", color: "#fbbf24", marginBottom: "20px" }}>
                <h4 style={{ margin: "0 0 5px 0" }}>Action Required</h4>
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {statusData.requiredActions.map((action: string, idx: number) => (
                    <li key={idx}>{action}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Document logs */}
            <h3 style={{ fontSize: "15px", marginBottom: "15px", borderBottom: "1px solid #334155", paddingBottom: "8px" }}>Compliance Documents</h3>
            {statusData.documents.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "13px" }}>No documents found.</p>
            ) : (
              statusData.documents.map((doc: DocumentRecord) => (
                <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px", padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
                  <div>
                    <div style={{ fontWeight: "bold", textTransform: "capitalize" }}>{doc.documentType.replace(/_/g, " ")}</div>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>{doc.storageKey.split("/").pop()}</div>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <span style={{
                      background: doc.scanStatus === "passed" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      color: doc.scanStatus === "passed" ? "#34d399" : "#f87171",
                      padding: "2px 6px",
                      borderRadius: "4px"
                    }}>
                      Scan: {doc.scanStatus}
                    </span>
                    <span style={{
                      background: doc.verificationStatus === "verified" ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
                      color: doc.verificationStatus === "verified" ? "#34d399" : "#fbbf24",
                      padding: "2px 6px",
                      borderRadius: "4px"
                    }}>
                      Verify: {doc.verificationStatus}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
