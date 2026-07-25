import { useState, useEffect } from "react";
import { OfficerDecisionForm } from "./OfficerDecisionForm.js";
import { AIRecommendationCard } from "./AIRecommendationCard.js";

export function ComplaintReviewPanel({
  complaint,
  triageReview,
  token,
  onSubmit,
}: {
  complaint: any;
  triageReview: any;
  token: string | null;
  onSubmit: (decision: any) => Promise<void>;
}) {
  const [contactInfo, setContactInfo] = useState<string | null>(null);
  const [revealReasonCode, setRevealReasonCode] = useState("");
  const [revealNotes, setRevealNotes] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");

  const [duplicateCandidates, setDuplicateCandidates] = useState<any[]>([]);

  // Clear contact info state when complaint record changes (Correction 4)
  useEffect(() => {
    setContactInfo(null);
    setRevealReasonCode("");
    setRevealNotes("");
    setRevealError("");
    fetchDuplicateCandidates();
  }, [complaint.id]);

  const fetchDuplicateCandidates = async () => {
    try {
      const res = await fetch(`http://localhost:8080/workbench/complaints/${complaint.id}/duplicate-candidates`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setDuplicateCandidates(data.candidates || []);
      }
    } catch (err) {
      console.error("Failed to load duplicate candidates", err);
    }
  };

  const handleRevealContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revealReasonCode) return;

    setRevealing(true);
    setRevealError("");
    try {
      const res = await fetch(`http://localhost:8080/workbench/complaints/${complaint.id}/contact-reveal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reasonCode: revealReasonCode,
          reason: revealNotes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setContactInfo(data.citizenContact);
      } else {
        const errData = await res.json();
        setRevealError(errData.error || "Failed to reveal contact information.");
      }
    } catch (err) {
      setRevealError("Network error. Failed to disclose contact details.");
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "30px",
      }}
    >
      {/* Left Column: Official Evidence and AI Review */}
      <div style={{ display: "grid", gap: "20px" }}>
        <div
          style={{
            background: "#1e293b",
            padding: "20px",
            borderRadius: "10px",
            border: "1px solid #334155",
          }}
        >
          <h3 style={{ margin: "0 0 15px", color: "#38bdf8" }}>📋 Complaint Details</h3>
          <div style={{ display: "grid", gap: "10px", fontSize: "0.95rem" }}>
            <div><strong>Reference Number:</strong> {complaint.referenceNumber}</div>
            <div><strong>Subject:</strong> {complaint.subject}</div>
            <div><strong>Original Description:</strong> {complaint.description}</div>
            <div><strong>Incident Location:</strong> {complaint.location}</div>
            <div><strong>Is Emergency:</strong> {complaint.isEmergency ? "🔴 YES (Escalated)" : "No"}</div>
            {complaint.emergencyRuleCodes?.length > 0 && (
              <div>
                <strong>Matched Emergency Rules:</strong>{" "}
                {complaint.emergencyRuleCodes.join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* Secure Audited Contact Disclosure (Correction 1, 3, 4) */}
        <div
          style={{
            background: "#1e293b",
            padding: "20px",
            borderRadius: "10px",
            border: "1px solid #334155",
          }}
        >
          <h4 style={{ margin: "0 0 10px", color: "#38bdf8" }}>👤 Citizen Contact Information</h4>
          {contactInfo ? (
            <div
              style={{
                background: "rgba(52, 211, 153, 0.15)",
                border: "1px solid #34d399",
                borderRadius: "6px",
                padding: "15px",
                color: "#a7f3d0",
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#34d399", marginBottom: "5px" }}>
                🔒 Contact Disclosed (Audited). This request has been logged.
              </div>
              <strong>Plaintext Details:</strong> {contactInfo}
            </div>
          ) : (
            <form onSubmit={handleRevealContact} style={{ display: "grid", gap: "10px" }}>
              <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                Contact information is encrypted. You must provide a disclosure reason to view it.
              </div>
              <select
                value={revealReasonCode}
                onChange={(e) => setRevealReasonCode(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#f1f5f9",
                }}
                required
              >
                <option value="">-- Choose Disclosure Justification Code --</option>
                <option value="case_follow_up">Case Follow-Up</option>
                <option value="request_more_information">Request More Information</option>
                <option value="assignment_coordination">Assignment Coordination</option>
                <option value="authorized_investigation">Authorized Investigation</option>
                <option value="other">Other Justification</option>
              </select>

              <textarea
                value={revealNotes}
                onChange={(e) => setRevealNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#f1f5f9",
                  boxSizing: "border-box",
                }}
              />

              {revealError && <div style={{ color: "#ef4444", fontSize: "0.85rem" }}>{revealError}</div>}

              <button
                type="submit"
                disabled={revealing || !revealReasonCode}
                style={{
                  padding: "10px",
                  background: revealing ? "#475569" : "#fbbf24",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: revealing ? "not-allowed" : "pointer",
                }}
              >
                {revealing ? "Decrypting..." : "🔑 Reveal Contact Details"}
              </button>
            </form>
          )}
        </div>

        {triageReview ? (
          <AIRecommendationCard review={triageReview} />
        ) : (
          <div style={{ color: "#64748b", textAlign: "center", padding: "20px" }}>
            No AI triage review recommendation generated.
          </div>
        )}
      </div>

      {/* Right Column: Decision Action Form */}
      <div
        style={{
          background: "#1e293b",
          padding: "20px",
          borderRadius: "10px",
          border: "1px solid #334155",
          height: "fit-content",
        }}
      >
        <h3 style={{ margin: "0 0 15px", color: "#34d399" }}>⚖️ Officer Review Console</h3>
        <OfficerDecisionForm
          kind="complaint"
          expectedVersion={complaint.version || 1}
          onSubmit={onSubmit}
          duplicateCandidates={duplicateCandidates}
        />
      </div>
    </div>
  );
}
