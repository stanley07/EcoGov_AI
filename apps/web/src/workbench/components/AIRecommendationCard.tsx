export interface AIReviewData {
  classifiedCategory: string;
  recommendedPriority: string;
  recommendedDepartment: string;
  summary: string;
  potentialHazards: string[];
  confidenceScore: number;
  requiresImmediateHumanAttention: boolean;
  attentionReasons: string[];
  duplicateAssessment?: {
    status: string;
    rationale: string;
    candidateComplaintIds: string[];
  };
}

export function AIRecommendationCard({ review }: { review: AIReviewData }) {
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: "10px",
        padding: "20px",
        marginTop: "20px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h4 style={{ margin: 0, color: "#38bdf8", fontSize: "1.1rem" }}>
          🤖 Advisory AI Triage Recommendation
        </h4>
        <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
          Confidence: {(review.confidenceScore * 100).toFixed(0)}%
        </span>
      </header>

      <div style={{ display: "grid", gap: "12px", fontSize: "0.9rem" }}>
        <div>
          <strong>Proposed Category:</strong> {review.classifiedCategory}
        </div>
        <div>
          <strong>Proposed Priority:</strong> {review.recommendedPriority.toUpperCase()}
        </div>
        <div>
          <strong>Proposed Department:</strong> {review.recommendedDepartment}
        </div>
        <div>
          <strong>Summary Analysis:</strong>
          <p style={{ margin: "5px 0 0", color: "#cbd5e1", lineHeight: "1.4" }}>{review.summary}</p>
        </div>

        {review.potentialHazards.length > 0 && (
          <div>
            <strong>Potential Hazards:</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "5px" }}>
              {review.potentialHazards.map((h, i) => (
                <span
                  key={i}
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "#fca5a5",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                  }}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}

        {review.duplicateAssessment && (
          <div style={{ borderTop: "1px solid #1e293b", paddingTop: "12px", marginTop: "5px" }}>
            <strong style={{ color: "#f59e0b" }}>Duplicate Check:</strong> {review.duplicateAssessment.status.toUpperCase()}
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#94a3b8" }}>
              {review.duplicateAssessment.rationale}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
