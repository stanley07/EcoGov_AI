import React, { useState } from "react";

export function OfficerDecisionForm({
  kind,
  expectedVersion,
  onSubmit,
  duplicateCandidates = [],
}: {
  kind: "complaint" | "facility_registration";
  expectedVersion: number;
  onSubmit: (payload: any) => Promise<void>;
  duplicateCandidates?: any[];
}) {
  const [decision, setDecision] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [assignedDepartment, setAssignedDepartment] = useState("");
  const [confirmedCategory, setConfirmedCategory] = useState("");
  const [confirmedPriority, setConfirmedPriority] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [duplicateOfComplaintId, setDuplicateOfComplaintId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision) return;

    setSubmitting(true);
    try {
      const payload: any = {
        decision,
        expectedVersion,
        notes,
      };

      if (decision === "accept") {
        payload.assignedDepartment = assignedDepartment;
      } else if (decision === "accept_with_changes") {
        payload.confirmedCategory = confirmedCategory;
        payload.confirmedPriority = confirmedPriority;
        payload.assignedDepartment = assignedDepartment;
      } else if (decision === "reject_complaint" || decision === "reject") {
        payload.reasonCode = reasonCode;
      } else if (decision === "mark_duplicate") {
        payload.duplicateOfComplaintId = duplicateOfComplaintId;
      }

      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: "20px" }}>
      <h4 style={{ margin: "0 0 15px", color: "#38bdf8" }}>Officer Action Form</h4>

      <div style={{ display: "grid", gap: "15px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>
            Select Decision
          </label>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f1f5f9",
            }}
            required
          >
            <option value="">-- Choose Resolution Option --</option>
            {kind === "complaint" ? (
              <>
                <option value="accept">Accept AI Triage Recommendation</option>
                <option value="accept_with_changes">Accept with Override Changes</option>
                <option value="reject_complaint">Reject Citizen Complaint</option>
                <option value="mark_duplicate">Mark as Duplicate Case</option>
              </>
            ) : (
              <>
                <option value="approve">Approve Registration</option>
                <option value="request_correction">Request Correction</option>
                <option value="reject">Reject Registration</option>
              </>
            )}
          </select>
        </div>

        {/* Accept / Accept With Changes inputs */}
        {(decision === "accept" || decision === "accept_with_changes") && (
          <div>
            <label style={{ display: "block", marginBottom: "5px" }}>Assigned Department</label>
            <select
              value={assignedDepartment}
              onChange={(e) => setAssignedDepartment(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                color: "#f1f5f9",
              }}
              required
            >
              <option value="">-- Select Department --</option>
              <option value="waste_management">Waste Management</option>
              <option value="environmental_health">Environmental Health</option>
              <option value="pollution_control">Pollution Control</option>
              <option value="emergency_response">Emergency Response</option>
            </select>
          </div>
        )}

        {decision === "accept_with_changes" && (
          <>
            <div>
              <label style={{ display: "block", marginBottom: "5px" }}>Override Category</label>
              <select
                value={confirmedCategory}
                onChange={(e) => setConfirmedCategory(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#f1f5f9",
                }}
                required
              >
                <option value="">-- Select Category --</option>
                <option value="waste_dumping">Waste Dumping</option>
                <option value="air_pollution">Air Pollution</option>
                <option value="water_pollution">Water Pollution</option>
                <option value="noise_pollution">Noise Pollution</option>
                <option value="hazardous_material">Hazardous Material</option>
                <option value="illegal_discharge">Illegal Discharge</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px" }}>Override Priority</label>
              <select
                value={confirmedPriority}
                onChange={(e) => setConfirmedPriority(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#f1f5f9",
                }}
                required
              >
                <option value="">-- Select Priority --</option>
                <option value="routine">Routine</option>
                <option value="standard">Standard</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </>
        )}

        {/* Rejection input */}
        {(decision === "reject_complaint" || decision === "reject") && (
          <div>
            <label style={{ display: "block", marginBottom: "5px" }}>Rejection Reason</label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                color: "#f1f5f9",
              }}
              required
            >
              <option value="">-- Choose Reason --</option>
              <option value="out_of_scope">Out of Scope</option>
              <option value="duplicate">Duplicate Case</option>
              <option value="spam">Spam / Abuse</option>
              <option value="insufficient_information">Insufficient Information</option>
              <option value="other">Other</option>
            </select>
          </div>
        )}

        {/* Duplicate Selection */}
        {decision === "mark_duplicate" && (
          <div>
            <label style={{ display: "block", marginBottom: "5px" }}>Duplicate Target Complaint</label>
            <select
              value={duplicateOfComplaintId}
              onChange={(e) => setDuplicateOfComplaintId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                color: "#f1f5f9",
              }}
              required
            >
              <option value="">-- Select Target Complaint --</option>
              {duplicateCandidates.map((c) => (
                <option key={c.complaintId} value={c.complaintId}>
                  {c.referenceNumber} - {c.locality} ({c.category || "No Category"})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>Officer Notes / Justification</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              padding: "10px",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f1f5f9",
              boxSizing: "border-box",
            }}
            placeholder="Provide decision rationales..."
            required={decision === "accept_with_changes" || decision === "reject_complaint" || decision === "reject"}
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !decision}
          style={{
            width: "100%",
            padding: "12px",
            background: submitting ? "#475569" : "#34d399",
            color: "#0f172a",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Submitting Action..." : "Commit Decision"}
        </button>
      </div>
    </form>
  );
}
