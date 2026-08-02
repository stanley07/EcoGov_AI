import { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface AuditEvent {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  result: string;
  context: any;
  createdAt: string;
}

interface AuditTabProps {
  token: string;
}

export function AuditTab({ token }: AuditTabProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters state
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Selected Detail Modal state
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventDetail, setEventDetail] = useState<AuditEvent | null>(null);

  const fetchEvents = async (cursorVal = "") => {
    try {
      setLoading(true);
      setError("");

      let url = `${API_BASE_URL}/platform-admin/v1/audit-events?limit=15`;
      if (cursorVal) url += `&cursor=${encodeURIComponent(cursorVal)}`;
      if (actionFilter) url += `&action=${encodeURIComponent(actionFilter)}`;
      if (actorFilter) url += `&actor=${encodeURIComponent(actorFilter)}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to query platform audit trails");
      const data = await res.json();
      setEvents(data.items || []);
      setNextCursor(data.nextCursor || "");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [token, actionFilter, actorFilter, startDate, endDate]);

  const loadPage = (dir: "next" | "prev") => {
    if (dir === "next" && nextCursor) {
      setCursorHistory([...cursorHistory, nextCursor]);
      fetchEvents(nextCursor);
    } else if (dir === "prev" && cursorHistory.length > 0) {
      const updatedHistory = [...cursorHistory];
      updatedHistory.pop();
      setCursorHistory(updatedHistory);
      const prevCursor = updatedHistory[updatedHistory.length - 1] || "";
      fetchEvents(prevCursor);
    }
  };

  const handleOpenDetail = async (event: AuditEvent) => {
    setSelectedEvent(event);
    setDetailLoading(true);
    setEventDetail(null);
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/v1/audit-events/${event.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setEventDetail(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch detailed audit context", err);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "25px" }}>
      {error && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>{error}</div>}
      {/* Search Filter Panel */}
      <div style={{ background: "#1e293b", padding: "20px", borderRadius: "12px", border: "1px solid #334155", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Action Type</label>
          <input type="text" placeholder="Filter by action..." value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "6px", fontSize: "0.85rem", color: "#cbd5e1" }}>Actor UUID</label>
          <input type="text" placeholder="Filter by user ID..." value={actorFilter} onChange={e => setActorFilter(e.target.value)} style={{ width: "100%", padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }} />
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
              <th style={{ padding: "15px 20px" }}>Action</th>
              <th style={{ padding: "15px 20px" }}>Target Resource</th>
              <th style={{ padding: "15px 20px" }}>Result</th>
              <th style={{ padding: "15px 20px" }}>Actor User ID</th>
              <th style={{ padding: "15px 20px" }}>Timestamp</th>
              <th style={{ padding: "15px 20px" }}>Context</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading audit database...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No audit events found matching current criteria.</td></tr>
            ) : (
              events.map(ev => (
                <tr key={ev.id} style={{ borderBottom: "1px solid #334155" }}>
                  <td style={{ padding: "15px 20px" }}><strong style={{ color: "#38bdf8" }}>{ev.action}</strong></td>
                  <td style={{ padding: "15px 20px", color: "#cbd5e1" }}>{ev.resource}</td>
                  <td style={{ padding: "15px 20px" }}>
                    <span style={{
                      color: ev.result === "allow" ? "#34d399" : "#f87171",
                      textTransform: "uppercase", fontSize: "0.85rem", fontWeight: "bold"
                    }}>{ev.result}</span>
                  </td>
                  <td style={{ padding: "15px 20px" }}><code style={{ color: "#94a3b8" }}>{ev.userId.substring(0, 8)}...</code></td>
                  <td style={{ padding: "15px 20px", color: "#cbd5e1" }}>{new Date(ev.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "15px 20px" }}>
                    <button
                      onClick={() => handleOpenDetail(ev)}
                      style={{ background: "#475569", color: "white", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                    >
                      View context
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
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

      {/* Context Detail Modal */}
      {selectedEvent && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: "20px" }}>
          <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", width: "100%", maxWidth: "550px", overflow: "hidden" }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#f8fafc" }}>
                Audit Context Inspector
              </h3>
              <button onClick={() => setSelectedEvent(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>&times;</button>
            </div>
            <div style={{ padding: "24px", display: "grid", gap: "20px", maxHeight: "400px", overflowY: "auto" }}>
              {detailLoading ? (
                <div style={{ textAlign: "center", color: "#cbd5e1" }}>Decrypting transaction parameters...</div>
              ) : eventDetail ? (
                <div style={{ display: "grid", gap: "15px" }}>
                  <div>
                    <strong style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Action Signature:</strong>
                    <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", marginTop: "4px", fontSize: "0.9rem", color: "#38bdf8", border: "1px solid #334155" }}>
                      {eventDetail.action}
                    </div>
                  </div>
                  <div>
                    <strong style={{ color: "#cbd5e1", fontSize: "0.9rem" }}>Transaction Context Metadata:</strong>
                    <pre style={{ margin: "5px 0 0", background: "#0f172a", border: "1px solid #334155", padding: "15px", borderRadius: "8px", color: "#a7f3d0", fontSize: "0.85rem", overflowX: "auto" }}>
                      {JSON.stringify(eventDetail.context, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
            <div style={{ padding: "20px", borderTop: "1px solid #334155", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedEvent(null)} style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "10px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
