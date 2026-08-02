import { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface Application {
  id: string;
  key: string;
  displayName: string;
  createdAt: string;
}

interface AgentDefinition {
  id: string;
  key: string;
  displayName: string;
  owningTenantId: string;
  createdAt: string;
}

interface AgentVersion {
  id: string;
  agentDefinitionId: string;
  version: string;
  promptTemplate: string;
  outputContractSchema: any;
  status: "draft" | "active" | "retired";
  versionNumber: number;
}

interface RegistryTabProps {
  token: string;
}

export function RegistryTab({ token }: RegistryTabProps) {
  const [apps, setApps] = useState<Application[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Validation modal state
  const [selectedVersion, setSelectedVersion] = useState<AgentVersion | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [validating, setValidating] = useState(false);


  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");
      const headers = { Authorization: `Bearer ${token}` };
      const [appsRes, agentsRes, versionsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/v1/registry/applications`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/registry/definitions/agent`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/registry/versions/agent`, { headers })
      ]);

      if (!appsRes.ok || !agentsRes.ok || !versionsRes.ok) {
        throw new Error("Failed to load registry catalog data");
      }

      setApps(await appsRes.json());
      setAgents(await agentsRes.json());
      setVersions(await versionsRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleValidate = async (version: AgentVersion) => {
    setSelectedVersion(version);
    setValidationResult(null);
    setValidating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/v1/registry/versions/agent/${version.id}/validate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setValidationResult(data);
    } catch (err: any) {
      setValidationResult({ success: false, errors: [err.message] });
    } finally {
      setValidating(false);
    }
  };

  const handleActivate = async (version: AgentVersion) => {
    const reason = prompt("Enter activation justification reason (mandatory):");
    if (!reason) return;
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/v1/registry/versions/agent/${version.id}/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason, expectedVersion: version.versionNumber, expectedStatus: version.status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to activate agent version");
      }
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRetire = async (version: AgentVersion) => {
    const reason = prompt("Enter retirement justification reason (mandatory):");
    if (!reason) return;
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/v1/registry/versions/agent/${version.id}/retire`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason, expectedVersion: version.versionNumber, expectedStatus: version.status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to retire agent version");
      }
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: "grid", gap: "30px" }}>
      {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>{error}</div>}

      {/* Applications Catalog */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
        <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", padding: "20px" }}>
          <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>📱 Registered Applications</h3>
          <div style={{ display: "grid", gap: "10px", maxHeight: "250px", overflowY: "auto" }}>
            {apps.length === 0 ? <p style={{ color: "#64748b" }}>No applications found.</p> : apps.map(app => (
              <div key={app.id} style={{ background: "#0f172a", padding: "12px 15px", borderRadius: "8px", border: "1px solid #334155", display: "flex", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ color: "#f8fafc" }}>{app.displayName}</strong>
                  <code style={{ display: "block", fontSize: "0.8rem", color: "#38bdf8", marginTop: "2px" }}>{app.key}</code>
                </div>
                <small style={{ color: "#64748b" }}>{new Date(app.createdAt).toLocaleDateString()}</small>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Definitions */}
        <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", padding: "20px" }}>
          <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>🤖 Agent Profiles</h3>
          <div style={{ display: "grid", gap: "10px", maxHeight: "250px", overflowY: "auto" }}>
            {agents.length === 0 ? <p style={{ color: "#64748b" }}>No agents registered.</p> : agents.map(agent => (
              <div key={agent.id} style={{ background: "#0f172a", padding: "12px 15px", borderRadius: "8px", border: "1px solid #334155", display: "flex", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ color: "#f8fafc" }}>{agent.displayName}</strong>
                  <code style={{ display: "block", fontSize: "0.8rem", color: "#fbbf24", marginTop: "2px" }}>{agent.key}</code>
                </div>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{agent.owningTenantId === "00000000-0000-0000-0000-000000000000" ? "Platform Global" : "Tenant Scoped"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Versions Catalog */}
      <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", overflow: "hidden" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #334155" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>⚙️ Agent Versions & Lifecycles</h2>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#0f172a", color: "#94a3b8", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "15px 20px" }}>Version Tag</th>
                <th style={{ padding: "15px 20px" }}>Prompt Preview</th>
                <th style={{ padding: "15px 20px" }}>Output Contract</th>
                <th style={{ padding: "15px 20px" }}>Lifecycle State</th>
                <th style={{ padding: "15px 20px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && versions.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading versions...</td></tr>
              ) : versions.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No agent versions registered yet.</td></tr>
              ) : (
                versions.map(v => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "15px 20px", fontWeight: "bold" }}>
                      <code style={{ color: "#38bdf8" }}>{v.version}</code>
                    </td>
                    <td style={{ padding: "15px 20px", color: "#cbd5e1" }}>
                      <span style={{ fontSize: "0.85rem", fontFamily: "monospace", display: "inline-block", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.promptTemplate}
                      </span>
                    </td>
                    <td style={{ padding: "15px 20px" }}>
                      <code style={{ fontSize: "0.8rem", background: "#0f172a", padding: "3px 6px", borderRadius: "4px" }}>
                        {JSON.stringify(v.outputContractSchema).substring(0, 30)}...
                      </code>
                    </td>
                    <td style={{ padding: "15px 20px" }}>
                      <span style={{
                        padding: "4px 8px", borderRadius: "4px", fontSize: "0.8rem", fontWeight: "bold",
                        background: v.status === "active" ? "rgba(52, 211, 153, 0.2)" : v.status === "retired" ? "rgba(239, 68, 68, 0.2)" : "rgba(148, 163, 184, 0.2)",
                        color: v.status === "active" ? "#34d399" : v.status === "retired" ? "#f87171" : "#cbd5e1"
                      }}>
                        {v.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "15px 20px", display: "flex", gap: "10px" }}>
                      <button
                        onClick={() => handleValidate(v)}
                        style={{ background: "#475569", color: "white", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                      >
                        🔍 Preview
                      </button>
                      {v.status !== "active" && v.status !== "retired" && (
                        <button
                          onClick={() => handleActivate(v)}
                          style={{ background: "#064e3b", color: "#a7f3d0", border: "1px solid #065f46", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                        >
                          Activate
                        </button>
                      )}
                      {v.status === "active" && (
                        <button
                          onClick={() => handleRetire(v)}
                          style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                        >
                          Retire
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Validation Preview Modal */}
      {selectedVersion && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", width: "100%", maxWidth: "600px", overflow: "hidden" }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#f8fafc" }}>
                Dry Run Validation Preview: {selectedVersion.version}
              </h3>
              <button onClick={() => setSelectedVersion(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer" }}>&times;</button>
            </div>
            <div style={{ padding: "24px", display: "grid", gap: "20px", maxHeight: "450px", overflowY: "auto" }}>
              {validating ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8" }}>Running dry-run checks on schemas, parameters, and database bindings...</div>
              ) : validationResult ? (
                <div style={{ display: "grid", gap: "15px" }}>
                  <div style={{ background: validationResult.success ? "rgba(52, 211, 153, 0.15)" : "rgba(239, 68, 68, 0.15)", border: `1px solid ${validationResult.success ? "#34d399" : "#ef4444"}`, padding: "15px", borderRadius: "8px" }}>
                    <strong style={{ color: validationResult.success ? "#34d399" : "#fca5a5", fontSize: "1.1rem" }}>
                      {validationResult.success ? "✅ VALIDATION SUCCEEDED" : "❌ VALIDATION FAILED"}
                    </strong>
                    <p style={{ color: "#cbd5e1", margin: "8px 0 0", fontSize: "0.95rem" }}>
                      {validationResult.success ? "All dependency contracts, prompt configurations, and tool admission policies match expected schemas cleanly." : "The following issues were caught during compile validation checks:"}
                    </p>
                  </div>

                  {!validationResult.success && validationResult.errors && (
                    <div style={{ display: "grid", gap: "10px" }}>
                      {validationResult.errors.map((e: string, i: number) => (
                        <div key={i} style={{ background: "#0f172a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "10px 15px", borderRadius: "6px", fontFamily: "monospace", fontSize: "0.85rem" }}>{e}</div>
                      ))}
                    </div>
                  )}

                  <div style={{ background: "#0f172a", padding: "15px", borderRadius: "8px", border: "1px solid #334155" }}>
                    <strong style={{ color: "#94a3b8", display: "block", marginBottom: "8px", fontSize: "0.85rem" }}>COMPILED PROMPT TEMPLATE PREVIEW</strong>
                    <pre style={{ margin: 0, color: "#cbd5e1", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "0.85rem" }}>{selectedVersion.promptTemplate}</pre>
                  </div>
                </div>
              ) : null}
            </div>
            <div style={{ padding: "20px", borderTop: "1px solid #334155", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedVersion(null)} style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "10px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}>Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
