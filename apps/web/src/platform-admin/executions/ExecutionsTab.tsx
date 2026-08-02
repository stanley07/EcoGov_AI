import React, { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface Execution {
  id: string;
  tenantId: string;
  agentName: string;
  executionStatus: string;
  validationStatus: string;
  startedAt: string;
  completedAt: string;
  tokenInput: number;
  tokenOutput: number;
  estimatedCostMicrounits: string;
}

interface Attempt {
  id: string;
  attemptNumber: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  actualCostMicrounits: string;
  finishReason: string;
  failureCode?: string;
}

interface ToolInvocation {
  id: string;
  sequenceNumber: number;
  authorizationStatus: string;
  authorizationReasonCode: string;
  status: string;
  requestedAt: string;
  argumentsRedacted: any;
  resultRedacted: any;
}

interface RetryNode {
  executionId: string;
  parentExecutionId: string | null;
  retryType: string;
  status: string;
  createdAt: string;
  failureCode: string | null;
}

interface ExecutionsTabProps {
  token: string;
}

export function ExecutionsTab({ token }: ExecutionsTabProps) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters state
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [validationFilter, setValidationFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Selected Detail Modal state
  const [selectedExec, setSelectedExec] = useState<Execution | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [tools, setTools] = useState<ToolInvocation[]>([]);
  const [retryNodes, setRetryNodes] = useState<RetryNode[]>([]);
  const [unredactedData, setUnredactedData] = useState<any>(null);
  
  // Unredacted sensitive request state
  const [requestJustification, setRequestJustification] = useState("");
  const [justificationError, setJustificationError] = useState("");
  const [requestingSensitive, setRequestingSensitive] = useState(false);

  const fetchExecutions = async (cursorVal = "") => {
    try {
      setLoading(true);
      setError("");
      
      let url = `${API_BASE_URL}/platform-admin/v1/executions?limit=15`;
      if (cursorVal) url += `&cursor=${encodeURIComponent(cursorVal)}`;
      if (agentFilter) url += `&agentName=${encodeURIComponent(agentFilter)}`;
      if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
      if (validationFilter) url += `&validationStatus=${encodeURIComponent(validationFilter)}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to query execution logs");
      const data = await res.json();
      setExecutions(data.items || []);
      setNextCursor(data.nextCursor || "");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExecutions();
  }, [token, agentFilter, statusFilter, validationFilter, startDate, endDate]);

  const loadPage = (dir: "next" | "prev") => {
    if (dir === "next" && nextCursor) {
      setCursorHistory([...cursorHistory, nextCursor]);
      fetchExecutions(nextCursor);
    } else if (dir === "prev" && cursorHistory.length > 0) {
      const updatedHistory = [...cursorHistory];
      updatedHistory.pop();
      setCursorHistory(updatedHistory);
      const prevCursor = updatedHistory[updatedHistory.length - 1] || "";
      fetchExecutions(prevCursor);
    }
  };

  const handleOpenDetail = async (exec: Execution) => {
    setSelectedExec(exec);
    setDetailLoading(true);
    setUnredactedData(null);
    setRequestJustification("");
    setJustificationError("");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [attemptsRes, toolsRes, graphRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/v1/executions/${exec.id}/attempts`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/executions/${exec.id}/tool-invocations`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/v1/executions/${exec.id}/retry-graph`, { headers })
      ]);

      if (attemptsRes.ok) setAttempts(await attemptsRes.json());
      if (toolsRes.ok) setTools(await toolsRes.json());
      if (graphRes.ok) {
        const graphData = await graphRes.json();
        setRetryNodes(graphData.nodes || []);
      }
    } catch (err) {
      console.error("Failed to load nested execution details", err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRequestSensitive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExec || !requestJustification) {
      setJustificationError("You must supply a compliance justification reason.");
      return;
    }
    setRequestingSensitive(true);
    setJustificationError("");
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/v1/executions/${selectedExec.id}/sensitive-view`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: requestJustification })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Access denied by gateway policies");
      }
      const data = await res.json();
      setUnredactedData(data.unredactedData);
    } catch (err: any) {
      setJustificationError(err.message);
    } finally {
      setRequestingSensitive(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "25px" }}>
      {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>{error}</div>}
      {/* Search Filter Panel */}
      <div style={{ background: "#1e293b", padding: "20px", borderRadius: "12px", border: "1px solid #334155", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Agent Name</label>
          <input type="text" placeholder="Filter by agent..." value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Execution Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}>
            <option value="">All Statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Validation Status</label>
          <select value={validationFilter} onChange={e => setValidationFilter(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}>
            <option value="">All Validation States</option>
            <option value="valid">Valid</option>
            <option value="invalid">Invalid</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }} />
        </div>
      </div>

      {/* Table grid */}
      <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ background: "#0f172a", color: "#94a3b8", borderBottom: "1px solid #334155" }}>
              <th style={{ padding: "15px 20px" }}>Execution ID</th>
              <th style={{ padding: "15px 20px" }}>Agent Profile</th>
              <th style={{ padding: "15px 20px" }}>Status</th>
              <th style={{ padding: "15px 20px" }}>Validation</th>
              <th style={{ padding: "15px 20px" }}>Started At</th>
              <th style={{ padding: "15px 20px" }}>Cost (Microunits)</th>
              <th style={{ padding: "15px 20px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading execution history...</td></tr>
            ) : executions.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No execution runs match current filters.</td></tr>
            ) : (
              executions.map(e => (
                <tr key={e.id} style={{ borderBottom: "1px solid #334155" }}>
                  <td style={{ padding: "15px 20px" }}><code style={{ color: "#94a3b8" }}>{e.id.substring(0, 8)}...</code></td>
                  <td style={{ padding: "15px 20px", fontWeight: "bold" }}>{e.agentName}</td>
                  <td style={{ padding: "15px 20px" }}>
                    <span style={{
                      color: e.executionStatus === "succeeded" ? "#34d399" : "#f87171",
                      textTransform: "uppercase", fontSize: "0.85rem", fontWeight: "bold"
                    }}>{e.executionStatus}</span>
                  </td>
                  <td style={{ padding: "15px 20px" }}>
                    <span style={{
                      color: e.validationStatus === "valid" ? "#34d399" : e.validationStatus === "invalid" ? "#f87171" : "#fbbf24",
                      textTransform: "uppercase", fontSize: "0.85rem", fontWeight: "bold"
                    }}>{e.validationStatus}</span>
                  </td>
                  <td style={{ padding: "15px 20px", color: "#cbd5e1" }}>{new Date(e.startedAt).toLocaleString()}</td>
                  <td style={{ padding: "15px 20px", fontFamily: "monospace" }}>
                    {e.estimatedCostMicrounits ? `${parseInt(e.estimatedCostMicrounits).toLocaleString()} μu` : "0 μu"}
                  </td>
                  <td style={{ padding: "15px 20px" }}>
                    <button
                      onClick={() => handleOpenDetail(e)}
                      style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer", fontWeight: "bold" }}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination buttons */}
        <div style={{ padding: "15px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #334155", background: "#0f172a" }}>
          <button disabled={cursorHistory.length === 0} onClick={() => loadPage("prev")} style={{ background: "#334155", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: cursorHistory.length === 0 ? "not-allowed" : "pointer", opacity: cursorHistory.length === 0 ? 0.5 : 1 }}>
            &larr; Previous Page
          </button>
          <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Page {cursorHistory.length + 1}</span>
          <button disabled={!nextCursor} onClick={() => loadPage("next")} style={{ background: "#334155", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: !nextCursor ? "not-allowed" : "pointer", opacity: !nextCursor ? 0.5 : 1 }}>
            Next Page &rarr;
          </button>
        </div>
      </div>

      {/* Nested Details Modal */}
      {selectedExec && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: "20px" }}>
          <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", width: "100%", maxWidth: "800px", overflow: "hidden" }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#f8fafc" }}>
                AI Execution Audit: {selectedExec.agentName} ({selectedExec.id.substring(0, 8)})
              </h3>
              <button onClick={() => setSelectedExec(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>&times;</button>
            </div>
            <div style={{ padding: "24px", display: "grid", gap: "25px", maxHeight: "550px", overflowY: "auto" }}>
              {detailLoading ? (
                <div style={{ textAlign: "center", color: "#cbd5e1", padding: "40px" }}>Fetching attempts metrics, graph cycles and security redactions...</div>
              ) : (
                <>
                  {/* Bounded Retry Graph visualization */}
                  <div>
                    <h4 style={{ margin: "0 0 10px", color: "#f8fafc", fontSize: "0.95rem", textTransform: "uppercase" }}>🔄 Bounded Execution Retry Graph</h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", background: "#0f172a", padding: "15px", borderRadius: "8px", border: "1px solid #334155" }}>
                      {retryNodes.length === 0 ? <p style={{ color: "#64748b" }}>No lineage graph nodes found.</p> : retryNodes.map((node, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center" }}>
                          <div style={{ background: node.status === "succeeded" ? "rgba(52, 211, 153, 0.15)" : "rgba(239, 68, 68, 0.15)", border: `1px solid ${node.status === "succeeded" ? "#34d399" : "#ef4444"}`, padding: "8px 12px", borderRadius: "6px" }}>
                            <code style={{ fontSize: "0.8rem", color: "#cbd5e1" }}>{node.executionId.substring(0, 8)}</code>
                            <span style={{ fontSize: "0.75rem", display: "block", color: node.status === "succeeded" ? "#34d399" : "#fca5a5" }}>{node.status} ({node.retryType})</span>
                          </div>
                          {i < retryNodes.length - 1 && <span style={{ color: "#64748b", margin: "0 8px" }}>&rarr;</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Provider Attempts list */}
                  <div>
                    <h4 style={{ margin: "0 0 10px", color: "#f8fafc", fontSize: "0.95rem", textTransform: "uppercase" }}>🤖 Provider Calls / Attempts</h4>
                    <div style={{ display: "grid", gap: "10px" }}>
                      {attempts.length === 0 ? <p style={{ color: "#64748b" }}>No model calls recorded.</p> : attempts.map(att => (
                        <div key={att.id} style={{ background: "#0f172a", border: "1px solid #334155", padding: "12px 15px", borderRadius: "8px", display: "flex", justifyContent: "space-between" }}>
                          <div>
                            <strong>Attempt #{att.attemptNumber} ({att.provider}/{att.model})</strong>
                            <span style={{ display: "block", color: "#94a3b8", fontSize: "0.85rem", marginTop: "4px" }}>
                              Tokens: {att.inputTokens} in / {att.outputTokens} out &bull; Cost: {parseInt(att.actualCostMicrounits).toLocaleString()} μu
                            </span>
                          </div>
                          <span style={{ color: att.finishReason === "stop" ? "#34d399" : "#fbbf24", fontWeight: "bold", fontSize: "0.85rem" }}>
                            {att.finishReason.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tool Invocations */}
                  <div>
                    <h4 style={{ margin: "0 0 10px", color: "#f8fafc", fontSize: "0.95rem", textTransform: "uppercase" }}>🛠️ Tool Invocations</h4>
                    <div style={{ display: "grid", gap: "10px" }}>
                      {tools.length === 0 ? <p style={{ color: "#64748b" }}>No tool invocations recorded.</p> : tools.map(tool => (
                        <div key={tool.id} style={{ background: "#0f172a", border: "1px solid #334155", padding: "12px 15px", borderRadius: "8px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <strong>Seq {tool.sequenceNumber} &bull; Auth: {tool.authorizationStatus}</strong>
                            <span style={{ color: tool.status === "succeeded" ? "#34d399" : "#f87171", fontSize: "0.85rem", fontWeight: "bold" }}>{tool.status.toUpperCase()}</span>
                          </div>
                          <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                            <div>
                              <small style={{ color: "#64748b" }}>Arguments:</small>
                              <pre style={{ margin: "3px 0 0", background: "#1e293b", padding: "6px", borderRadius: "4px", fontSize: "0.75rem", overflowX: "auto" }}>{JSON.stringify(tool.argumentsRedacted, null, 2)}</pre>
                            </div>
                            <div>
                              <small style={{ color: "#64748b" }}>Result:</small>
                              <pre style={{ margin: "3px 0 0", background: "#1e293b", padding: "6px", borderRadius: "4px", fontSize: "0.75rem", overflowX: "auto" }}>{JSON.stringify(tool.resultRedacted, null, 2)}</pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Privileged sensitive view */}
                  <div style={{ borderTop: "1px solid #334155", paddingTop: "20px" }}>
                    <h4 style={{ margin: "0 0 10px", color: "#fbbf24", fontSize: "0.95rem", textTransform: "uppercase" }}>⚠️ Unredacted Sensitive Data View</h4>
                    {unredactedData ? (
                      <div style={{ background: "#0f172a", border: "1px solid #fbbf24", padding: "15px", borderRadius: "8px" }}>
                        <p style={{ margin: "0 0 10px", color: "#34d399", fontWeight: "bold" }}>Decryption success! Sensitive properties authorized:</p>
                        <div style={{ display: "grid", gap: "8px", fontFamily: "monospace", fontSize: "0.85rem" }}>
                          <div><strong>Prompt Template Version:</strong> {unredactedData.promptTemplateVersion}</div>
                          <div><strong>Input Hash:</strong> {unredactedData.inputHash}</div>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleRequestSensitive} style={{ display: "grid", gap: "10px" }}>
                        <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>
                          To view unredacted prompt variables, input payloads, or model hashes, you must supply an administrative justification. This action is permanently appended to the security audit ledger.
                        </p>
                        {justificationError && <div style={{ color: "#fca5a5", fontSize: "0.85rem" }}>{justificationError}</div>}
                        <div style={{ display: "flex", gap: "10px" }}>
                          <input
                            type="text"
                            placeholder="Reason justification (e.g. Legal compliance inspection request #4092)..."
                            value={requestJustification}
                            onChange={e => setRequestJustification(e.target.value)}
                            style={{ flex: 1, padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}
                            required
                          />
                          <button
                            type="submit"
                            disabled={requestingSensitive}
                            style={{ background: "#fbbf24", color: "#0f172a", border: "none", padding: "8px 16px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                          >
                            {requestingSensitive ? "Authorizing..." : "Request Access"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </>
              )}
            </div>
            <div style={{ padding: "20px", borderTop: "1px solid #334155", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedExec(null)} style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "10px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
