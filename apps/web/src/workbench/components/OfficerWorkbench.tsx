import { useState, useEffect } from "react";
import { Timeline } from "./Timeline.js";
import { ComplaintReviewPanel } from "./ComplaintReviewPanel.js";
import { FacilityReviewPanel } from "./FacilityReviewPanel.js";
import { EmergencyBanner } from "./EmergencyBanner.js";
import { WorkbenchMetrics, WorkbenchQueueItem, TimelineEvent } from "../types/workbench.js";

export function OfficerWorkbench({ token }: { token: string | null }) {
  const [metrics, setMetrics] = useState<WorkbenchMetrics | null>(null);

  // Queue lists and cursor pagination state
  const [emergencyItems, setEmergencyItems] = useState<WorkbenchQueueItem[]>([]);
  const [standardItems, setStandardItems] = useState<WorkbenchQueueItem[]>([]);
  const [emergencyCursor, setEmergencyCursor] = useState<string | null>(null);
  const [standardCursor, setStandardCursor] = useState<string | null>(null);

  // Active Review State
  const [selectedItem, setSelectedItem] = useState<WorkbenchQueueItem | null>(null);
  const [selectedComplaintDetails, setSelectedComplaintDetails] = useState<any>(null);
  const [selectedTriageReview, setSelectedTriageReview] = useState<any>(null);
  const [selectedFacilityDetails, setSelectedFacilityDetails] = useState<any>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // CAS Error Modal State
  const [casError, setCasError] = useState<string | null>(null);

  useEffect(() => {
    fetchMetrics();
    fetchQueues(true);
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await fetch("http://localhost:8080/workbench/metrics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error("Failed to load metrics", err);
    }
  };

  const fetchQueues = async (reset = false) => {
    try {
      // 1. Fetch Emergency Queue (only complaints)
      const eUrl = `http://localhost:8080/workbench/queue?queue=emergency&pageSize=10${
        !reset && emergencyCursor ? `&cursor=${emergencyCursor}` : ""
      }`;
      const eRes = await fetch(eUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (eRes.ok) {
        const data = await eRes.json();
        if (reset) {
          setEmergencyItems(data.items);
        } else {
          setEmergencyItems((prev) => [...prev, ...data.items]);
        }
        setEmergencyCursor(data.nextCursor);
      }

      // 2. Fetch Standard Queue (standard complaints & registrations)
      const sUrl = `http://localhost:8080/workbench/queue?queue=standard&pageSize=15${
        !reset && standardCursor ? `&cursor=${standardCursor}` : ""
      }`;
      const sRes = await fetch(sUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (sRes.ok) {
        const data = await sRes.json();
        if (reset) {
          setStandardItems(data.items);
        } else {
          setStandardItems((prev) => [...prev, ...data.items]);
        }
        setStandardCursor(data.nextCursor);
      }
    } catch (err) {
      console.error("Failed to load queues", err);
    }
  };

  const handleSelectRecord = async (item: WorkbenchQueueItem) => {
    setSelectedItem(item);
    setLoadingDetails(true);
    setSelectedComplaintDetails(null);
    setSelectedTriageReview(null);
    setSelectedFacilityDetails(null);
    setTimelineEvents([]);
    setCasError(null);

    try {
      if (item.kind === "complaint") {
        // Fetch complaint details
        const compRes = await fetch(`http://localhost:8080/complaints/${item.complaintId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (compRes.ok) {
          const data = await compRes.json();
          setSelectedComplaintDetails(data);
        }

        // Fetch triage AI review
        const triRes = await fetch(`http://localhost:8080/complaints/${item.complaintId}/triage`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (triRes.ok) {
          const data = await triRes.json();
          setSelectedTriageReview(data);
        }

        // Fetch timeline
        const lineRes = await fetch(`http://localhost:8080/workbench/complaints/${item.complaintId}/timeline`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (lineRes.ok) {
          const data = await lineRes.json();
          setTimelineEvents(data);
        }
      } else {
        // Fetch facility details
        const facRes = await fetch(`http://localhost:8080/workbench/registrations/${item.facilityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (facRes.ok) {
          const data = await facRes.json();
          setSelectedFacilityDetails(data);
        }

        // Fetch timeline
        const lineRes = await fetch(`http://localhost:8080/workbench/registrations/${item.facilityId}/timeline`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (lineRes.ok) {
          const data = await lineRes.json();
          setTimelineEvents(data);
        }
      }
    } catch (err) {
      console.error("Failed to load details", err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDecisionSubmit = async (payload: any) => {
    const isComplaint = selectedItem?.kind === "complaint";
    const url = isComplaint
      ? `http://localhost:8080/complaints/${selectedItem?.complaintId}/triage`
      : `http://localhost:8080/facilities/${selectedItem?.facilityId}/review`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        setCasError("This record has already been updated by another officer. Please refresh your queue.");
        return;
      }

      if (res.ok) {
        // Reset selected item and refresh queue
        setSelectedItem(null);
        fetchMetrics();
        fetchQueues(true);
      } else {
        const errData = await res.json();
        alert(errData.error || "Decision submission failed.");
      }
    } catch (err) {
      alert("Network error occurred during submission.");
    }
  };

  const handleCloseCasModal = () => {
    setCasError(null);
    setSelectedItem(null);
    fetchMetrics();
    fetchQueues(true);
  };

  return (
    <div>
      {/* 1. Scoped Operational Summary Metrics Dashboard */}
      {metrics && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "20px",
            marginBottom: "30px",
          }}
        >
          {[
            { label: "Pending Reviews", val: metrics.pendingReviews },
            { label: "Critical Emergencies", val: metrics.emergencyReviews, alert: metrics.emergencyReviews > 0 },
            { label: "Completed (24h)", val: metrics.completedToday },
            { label: "AI Pending Recommendations", val: metrics.aiRecommendationsPending },
          ].map((m, i) => (
            <div
              key={i}
              style={{
                background: "#1e293b",
                padding: "20px",
                borderRadius: "10px",
                border: m.alert ? "1px solid #ef4444" : "1px solid #334155",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "5px" }}>{m.label}</div>
              <div style={{ fontSize: "2rem", fontWeight: "bold", color: m.alert ? "#f87171" : "#38bdf8" }}>
                {m.val}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Main Review Console (Side-by-side or Queue table view) */}
      {!selectedItem ? (
        <div>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0 }}>📋 Scoped Officer Queue</h2>
              <p style={{ margin: "5px 0 0", color: "#94a3b8" }}>Paginated list of outstanding compliance requests</p>
            </div>
            <button
              onClick={() => fetchQueues(true)}
              style={{
                padding: "10px 15px",
                background: "#334155",
                color: "#f1f5f9",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              🔄 Refresh Queue
            </button>
          </header>

          {/* 2. Critical Emergency Queue Section (ordered oldest first) */}
          <section style={{ marginBottom: "30px" }}>
            <h3 style={{ color: "#f87171", borderBottom: "1px solid #7f1d1d", paddingBottom: "8px" }}>
              🚨 Emergency Priority Cases
            </h3>
            {emergencyItems.length === 0 ? (
              <div style={{ padding: "20px", background: "#111827", color: "#64748b", borderRadius: "8px" }}>
                No active emergency cases needing immediate attention.
              </div>
            ) : (
              <div style={{ background: "#1e293b", borderRadius: "8px", border: "1px solid #334155", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "#0f172a", borderBottom: "1px solid #334155" }}>
                      <th style={{ padding: "12px 20px" }}>Reference</th>
                      <th style={{ padding: "12px 20px" }}>Priority</th>
                      <th style={{ padding: "12px 20px" }}>Date Submitted</th>
                      <th style={{ padding: "12px 20px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emergencyItems.map((item) => (
                      <tr key={item.kind === "complaint" ? item.complaintId : item.facilityId} style={{ borderBottom: "1px solid #334155" }}>
                        <td style={{ padding: "12px 20px", fontWeight: "bold" }}>{item.referenceNumber}</td>
                        <td style={{ padding: "12px 20px" }}>
                          <span style={{ background: "#7f1d1d", color: "#fca5a5", padding: "3px 8px", borderRadius: "4px", fontSize: "0.8rem", fontWeight: "bold" }}>
                            CRITICAL EMERGENCY
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px" }}>{new Date(item.submittedAt).toLocaleString()}</td>
                        <td style={{ padding: "12px 20px" }}>
                          <button
                            onClick={() => handleSelectRecord(item)}
                            style={{ padding: "8px 12px", background: "#fbbf24", color: "#0f172a", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }}
                          >
                            Verify & Act
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3. Standard Queue Section */}
          <section>
            <h3 style={{ color: "#38bdf8", borderBottom: "1px solid #1e293b", paddingBottom: "8px" }}>
              📥 Standard Queue Items
            </h3>
            {standardItems.length === 0 ? (
              <div style={{ padding: "20px", background: "#111827", color: "#64748b", borderRadius: "8px" }}>
                Standard queue is empty.
              </div>
            ) : (
              <div style={{ background: "#1e293b", borderRadius: "8px", border: "1px solid #334155", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "#0f172a", borderBottom: "1px solid #334155" }}>
                      <th style={{ padding: "12px 20px" }}>Reference</th>
                      <th style={{ padding: "12px 20px" }}>Kind</th>
                      <th style={{ padding: "12px 20px" }}>Date Submitted</th>
                      <th style={{ padding: "12px 20px" }}>Status</th>
                      <th style={{ padding: "12px 20px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standardItems.map((item) => {
                      const ref = item.kind === "complaint" ? item.referenceNumber : item.referenceNumber;
                      return (
                        <tr key={item.kind === "complaint" ? item.complaintId : item.facilityId} style={{ borderBottom: "1px solid #334155" }}>
                          <td style={{ padding: "12px 20px", fontWeight: "bold" }}>{ref}</td>
                          <td style={{ padding: "12px 20px" }}>
                            {item.kind === "complaint" ? "Complaint" : "Facility Registration"}
                          </td>
                          <td style={{ padding: "12px 20px" }}>{new Date(item.submittedAt).toLocaleString()}</td>
                          <td style={{ padding: "12px 20px" }}>
                            <span style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", padding: "3px 8px", borderRadius: "4px", fontSize: "0.8rem", fontWeight: "bold" }}>
                              {item.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: "12px 20px" }}>
                            <button
                              onClick={() => handleSelectRecord(item)}
                              style={{ padding: "8px 12px", background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }}
                            >
                              Verify AI Review
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        // Side-by-side Review Panel View
        <div>
          <button
            onClick={() => setSelectedItem(null)}
            style={{
              marginBottom: "20px",
              padding: "8px 15px",
              background: "#334155",
              color: "#f1f5f9",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ← Back to Queue List
          </button>

          {loadingDetails ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
              Loading audit and recommendation evidence details...
            </div>
          ) : (
            <div>
              {selectedItem.kind === "complaint" && selectedComplaintDetails && (
                <>
                  {selectedComplaintDetails.isEmergency && (
                    <EmergencyBanner message="This citizen complaint matched deterministic emergency criteria and bypasses standard AI-delay queues." />
                  )}
                  <ComplaintReviewPanel
                    complaint={selectedComplaintDetails}
                    triageReview={selectedTriageReview}
                    token={token}
                    onSubmit={handleDecisionSubmit}
                  />
                </>
              )}

              {selectedItem.kind === "facility_registration" && selectedFacilityDetails && (
                <FacilityReviewPanel
                  facility={selectedFacilityDetails}
                  onSubmit={handleDecisionSubmit}
                />
              )}

              {/* Normalized Timeline event logs */}
              {timelineEvents.length > 0 && <Timeline events={timelineEvents} />}
            </div>
          )}
        </div>
      )}

      {/* CAS Concurrency Conflict warning Dialog (Correction 11) */}
      {casError && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#1e293b",
              border: "2px solid #ef4444",
              borderRadius: "12px",
              padding: "30px",
              maxWidth: "500px",
              textAlign: "center",
            }}
          >
            <h3 style={{ color: "#ef4444", margin: "0 0 15px" }}>⚠️ Concurrency Conflict</h3>
            <p style={{ color: "#cbd5e1", lineHeight: "1.5", marginBottom: "20px" }}>{casError}</p>
            <button
              onClick={handleCloseCasModal}
              style={{
                padding: "10px 20px",
                background: "#ef4444",
                color: "#f1f5f9",
                border: "none",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Refresh Workbench Queue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
