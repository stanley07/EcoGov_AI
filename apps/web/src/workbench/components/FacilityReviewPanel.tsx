import { OfficerDecisionForm } from "./OfficerDecisionForm.js";

export function FacilityReviewPanel({
  facility,
  onSubmit,
}: {
  facility: any;
  onSubmit: (decision: any) => Promise<void>;
}) {
  const review = facility.latestReview;

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
          <h3 style={{ margin: "0 0 15px", color: "#38bdf8" }}>🏢 Facility Details</h3>
          <div style={{ display: "grid", gap: "10px", fontSize: "0.95rem" }}>
            <div><strong>Business Name:</strong> {facility.businessName}</div>
            <div><strong>Submitted Category:</strong> {facility.category}</div>
            <div><strong>Address:</strong> {facility.address}</div>
            <div><strong>Coordinates:</strong> Lat {facility.latitude}, Lng {facility.longitude}</div>
            <div><strong>Status:</strong> {facility.registrationStatus.toUpperCase()}</div>
          </div>
        </div>

        {review ? (
          <div
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "10px",
              padding: "20px",
            }}
          >
            <h3 style={{ margin: "0 0 15px", color: "#fbbf24" }}>🤖 Advisory AI Review Recommendations</h3>
            <div style={{ display: "grid", gap: "12px", fontSize: "0.9rem" }}>
              <div><strong>Proposed Category:</strong> {review.classifiedCategory}</div>
              <div><strong>Category Matches:</strong> {review.categoryMatchesSubmission ? "Yes" : "No"}</div>
              <div><strong>Risk Rating:</strong> {review.preliminaryRiskRating.toUpperCase()}</div>
              <div><strong>AI Rationale:</strong> {review.rationale}</div>

              {review.detectedInconsistencies?.length > 0 && (
                <div>
                  <strong style={{ color: "#ef4444" }}>Inconsistencies:</strong>
                  <ul style={{ margin: "5px 0 0", paddingLeft: "20px" }}>
                    {review.detectedInconsistencies.map((inc: string, i: number) => (
                      <li key={i}>{inc}</li>
                    ))}
                  </ul>
                </div>
              )}

              {review.missingDocuments?.length > 0 && (
                <div>
                  <strong style={{ color: "#f59e0b" }}>Missing Documents:</strong>
                  <ul style={{ margin: "5px 0 0", paddingLeft: "20px" }}>
                    {review.missingDocuments.map((doc: string, i: number) => (
                      <li key={i}>{doc}</li>
                    ))}
                  </ul>
                </div>
              )}

              {review.permitCheck && (
                <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px" }}>
                  <strong>Permit Check:</strong> {review.permitCheck.status.toUpperCase()}
                  {review.permitCheck.permitReference && (
                    <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "2px" }}>
                      Reference: {review.permitCheck.permitReference}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: "#64748b", textAlign: "center", padding: "20px" }}>
            No AI recommendation available yet.
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
        <h3 style={{ margin: "0 0 15px", color: "#34d399" }}>⚖️ Review sign-off</h3>
        <OfficerDecisionForm
          kind="facility_registration"
          expectedVersion={facility.recordVersion}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
