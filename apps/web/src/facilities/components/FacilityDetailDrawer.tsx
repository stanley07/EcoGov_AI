import React, { useEffect, useState, useRef } from "react";
import { TimelineEvent } from "../../workbench/types/workbench.js";

interface FacilityDetailDrawerProps {
  facilityId: string;
  token: string;
  isOfficer: boolean;
  onClose: () => void;
}

interface FacilityDetail {
  id: string;
  tenantId: string;
  organizationId: string;
  ownerUserId?: string | null;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  registrationStatus: string;
  riskRating: string;
  createdAt: string;
  registrationId?: string | null;
  registrationSource?: string | null;
  registeredByUserId?: string | null;
  registeredBySubcontractorId?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  town?: string | null;
  lga?: string | null;
  primaryImageUrl?: string | null;
}

export function FacilityDetailDrawer({
  facilityId,
  token,
  isOfficer,
  onClose,
}: FacilityDetailDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap & Escape listener
  useEffect(() => {
    const activeBefore = document.activeElement;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'
        );
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (activeBefore instanceof HTMLElement) activeBefore.focus();
    };
  }, [onClose]);

  // Fetch detail & timeline
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`http://localhost:8080/facilities/${facilityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error("Failed to load facility details");
        }
        const data: FacilityDetail = await res.json();
        setDetail(data);

        // If registration ID is present, fetch the timeline
        if (data.registrationId) {
          const lineRes = await fetch(
            `http://localhost:8080/workbench/registrations/${data.registrationId}/timeline`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (lineRes.ok) {
            const lineData = await lineRes.json();
            setTimeline(lineData);
          }
        }
      } catch (err: any) {
        setError(err.message || "An error occurred loading details");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [facilityId, token]);

  // Redaction helper for contact info
  const redact = (val: string | null | undefined, type: "email" | "phone" | "name") => {
    if (!val) return "Not provided";
    if (isOfficer) return val; // Officers see full info

    if (type === "email") {
      const parts = val.split("@");
      if (parts.length < 2) return "***";
      const name = parts[0] || "";
      const domain = parts[1] || "";
      const visible = name.length > 2 ? name.substring(0, 2) : (name[0] || "*");
      return `${visible}***@${domain}`;
    }
    if (type === "phone") {
      const cleaned = val.trim();
      if (cleaned.length > 4) {
        return `${cleaned.substring(0, 4)}*******${cleaned.substring(cleaned.length - 2)}`;
      }
      return "****";
    }
    // Name
    const trimmed = val.trim();
    if (trimmed.length > 3) {
      return `${trimmed.substring(0, 3)}***`;
    }
    return "***";
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div onClick={handleBackdropClick} style={backdropStyle}>
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Facility Detail Panel"
        style={drawerStyle}
      >
        {/* Drawer Header */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.5rem" }}>🏢</span>
            <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: "bold" }}>
              Facility Profile Details
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close details"
            style={closeBtnStyle}
          >
            &times;
          </button>
        </div>

        {loading ? (
          <div style={loaderContainerStyle}>
            <div style={spinnerStyle} />
            <p style={{ color: "#94a3b8" }}>Loading facility profile...</p>
          </div>
        ) : error || !detail ? (
          <div style={errorContainerStyle}>
            <span style={{ fontSize: "2rem" }}>⚠️</span>
            <p>{error || "Facility not found"}</p>
            <button onClick={onClose} style={actionBtnStyle}>Close Panel</button>
          </div>
        ) : (
          <div style={contentStyle}>
            {/* Facility Image Header inside drawer */}
            <div style={{
              width: "100%",
              height: "160px",
              borderRadius: "8px",
              overflow: "hidden",
              marginBottom: "15px",
              border: "1px solid #334155",
              background: "#0f172a",
              position: "relative"
            }}>
              <img
                src={detail.primaryImageUrl || "/facility_placeholder.jpg"}
                alt={`${detail.businessName} facility`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  if (target.src !== "/facility_placeholder.jpg") {
                    target.src = "/facility_placeholder.jpg";
                  }
                }}
              />
            </div>

            {/* Business Title Card */}
            <div style={cardStyle}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.4rem", color: "#f8fafc" }}>
                {detail.businessName}
              </h3>
              <div style={badgeRowStyle}>
                <span style={{ ...badgeStyle, background: "#1e293b", color: "#38bdf8", borderColor: "#0ea5e9" }}>
                  {detail.category.replace("_", " ").toUpperCase()}
                </span>
                <span
                  style={{
                    ...badgeStyle,
                    background:
                      detail.riskRating === "high"
                        ? "rgba(239, 68, 68, 0.15)"
                        : detail.riskRating === "medium"
                          ? "rgba(251, 191, 36, 0.15)"
                          : "rgba(16, 185, 129, 0.15)",
                    color:
                      detail.riskRating === "high"
                        ? "#fca5a5"
                        : detail.riskRating === "medium"
                          ? "#fde047"
                          : "#a7f3d0",
                    borderColor:
                      detail.riskRating === "high"
                        ? "#ef4444"
                        : detail.riskRating === "medium"
                          ? "#f59e0b"
                          : "#10b981",
                  }}
                >
                  RISK: {detail.riskRating.toUpperCase()}
                </span>
                <span
                  style={{
                    ...badgeStyle,
                    background:
                      detail.registrationStatus === "approved"
                        ? "rgba(16, 185, 129, 0.15)"
                        : detail.registrationStatus === "rejected"
                          ? "rgba(239, 68, 68, 0.15)"
                          : "rgba(56, 189, 248, 0.15)",
                    color:
                      detail.registrationStatus === "approved"
                        ? "#a7f3d0"
                        : detail.registrationStatus === "rejected"
                          ? "#fca5a5"
                          : "#bae6fd",
                    borderColor:
                      detail.registrationStatus === "approved"
                        ? "#10b981"
                        : detail.registrationStatus === "rejected"
                          ? "#ef4444"
                          : "#38bdf8",
                  }}
                >
                  {detail.registrationStatus.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Basic Info Section */}
            <div style={sectionStyle}>
              <h4 style={sectionHeaderStyle}>📋 Registration Source & Metadata</h4>
              <div style={gridStyle}>
                <div>
                  <div style={labelStyle}>Registration Source</div>
                  <div style={valueStyle}>{detail.registrationSource ? detail.registrationSource.toUpperCase() : "LEGACY"}</div>
                </div>
                <div>
                  <div style={labelStyle}>Date Registered</div>
                  <div style={valueStyle}>{new Date(detail.createdAt).toLocaleDateString()}</div>
                </div>
                {detail.registrationId && (
                  <div>
                    <div style={labelStyle}>Registration Case ID</div>
                    <div style={valueStyle}><code>{detail.registrationId}</code></div>
                  </div>
                )}
                {detail.ownerUserId && (
                  <div>
                    <div style={labelStyle}>Owner User Reference</div>
                    <div style={valueStyle}><code>{detail.ownerUserId}</code></div>
                  </div>
                )}
              </div>
            </div>

            {/* Location Section */}
            <div style={sectionStyle}>
              <h4 style={sectionHeaderStyle}>📍 Geographic Location</h4>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
                <div>
                  <p style={{ margin: "0 0 10px", color: "#cbd5e1" }}>
                    <strong>Address:</strong> {detail.address}
                  </p>
                  <p style={{ margin: "5px 0", color: "#cbd5e1" }}>
                    <strong>Town/City:</strong> {detail.town || "Awka"}
                  </p>
                  <p style={{ margin: "5px 0", color: "#cbd5e1" }}>
                    <strong>LGA Name:</strong> {detail.lga || "Awka South"}
                  </p>
                  <p style={{ margin: "5px 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                    <strong>GPS Coordinates:</strong> {detail.latitude.toFixed(6)}, {detail.longitude.toFixed(6)}
                  </p>
                </div>

                {/* Mock Map Coordinate Preview */}
                <div style={mockMapStyle}>
                  <div style={mapGridStyle}>
                    <div style={mapMarkerStyle} />
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "#94a3b8", display: "block", textAlign: "center", marginTop: "4px" }}>
                    Anambra GIS Plot
                  </span>
                </div>
              </div>
            </div>

            {/* Contact Details Section */}
            <div style={sectionStyle}>
              <h4 style={sectionHeaderStyle}>📞 Contact Information</h4>
              <div style={gridStyle}>
                <div>
                  <div style={labelStyle}>Contact Representative</div>
                  <div style={valueStyle}>{redact(detail.contactPerson, "name")}</div>
                </div>
                <div>
                  <div style={labelStyle}>Contact Email</div>
                  <div style={valueStyle}>{redact(detail.contactEmail, "email")}</div>
                </div>
                <div>
                  <div style={labelStyle}>Contact Phone</div>
                  <div style={valueStyle}>{redact(detail.contactPhone, "phone")}</div>
                </div>
              </div>
              {!isOfficer && (
                <div style={redactedWarningStyle}>
                  💡 Contact fields are redacted for subcontractor/public roles. Please contact an ASMOE officer for details.
                </div>
              )}
            </div>

            {/* Authoritative Timeline */}
            <div style={sectionStyle}>
              <h4 style={sectionHeaderStyle}>⌛ Workflow Progress History</h4>
              {timeline.length === 0 ? (
                <div style={emptyTimelineStyle}>
                  No active registration workflow history available for legacy/imported records.
                </div>
              ) : (
                <div style={timelineContainerStyle}>
                  {timeline.map((event, idx) => {
                    const isExpanded = expandedStepId === event.eventId;
                    return (
                      <div key={event.eventId} style={timelineItemStyle}>
                        <div style={timelineMarkerLineStyle}>
                          <div
                            style={{
                              ...timelineBulletStyle,
                              background: event.status === "completed" ? "#10b981" : event.status === "failed" ? "#ef4444" : "#f59e0b",
                            }}
                          />
                          {idx < timeline.length - 1 && <div style={timelineVerticalConnectorStyle} />}
                        </div>
                        <div style={timelineContentCardStyle}>
                          <div
                            onClick={() => setExpandedStepId(isExpanded ? null : event.eventId)}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                          >
                            <div>
                              <strong style={{ color: "#f1f5f9" }}>{event.title}</strong>
                              <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "2px" }}>
                                {event.summary}
                              </div>
                            </div>
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontSize: "0.7rem",
                                fontWeight: "bold",
                                background:
                                  event.status === "completed"
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : event.status === "failed"
                                      ? "rgba(239, 68, 68, 0.15)"
                                      : "rgba(245, 158, 11, 0.15)",
                                color:
                                  event.status === "completed"
                                    ? "#a7f3d0"
                                    : event.status === "failed"
                                      ? "#fca5a5"
                                      : "#fde047",
                              }}
                            >
                              {event.status.toUpperCase()}
                            </span>
                          </div>

                          {isExpanded && (
                            <div style={timelineExpandedDetailStyle}>
                              <div><strong>Occurred At:</strong> {new Date(event.occurredAt).toLocaleString()}</div>
                              <div><strong>Actor Type:</strong> {event.actorType.toUpperCase()}</div>
                              {event.metadata && (
                                <div style={{ background: "#0f172a", padding: "8px", borderRadius: "4px", marginTop: "8px" }}>
                                  <pre style={{ margin: 0, overflowX: "auto", fontSize: "0.75rem", color: "#38bdf8" }}>
                                    {JSON.stringify(event.metadata, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Styling Constants
const backdropStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(15, 23, 42, 0.7)",
  backdropFilter: "blur(4px)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 1000,
};

const drawerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "500px",
  height: "100%",
  background: "#0f172a",
  borderLeft: "1px solid #334155",
  boxShadow: "-10px 0 25px -5px rgba(0, 0, 0, 0.5)",
  display: "flex",
  flexDirection: "column",
  color: "#f8fafc",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "20px 24px",
  borderBottom: "1px solid #334155",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  fontSize: "2rem",
  cursor: "pointer",
  lineHeight: "1",
};

const loaderContainerStyle: React.CSSProperties = {
  flexGrow: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
};

const spinnerStyle: React.CSSProperties = {
  width: "40px",
  height: "40px",
  border: "3px solid #1e293b",
  borderTopColor: "#38bdf8",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

const errorContainerStyle: React.CSSProperties = {
  flexGrow: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "16px",
  color: "#fca5a5",
  padding: "24px",
  textAlign: "center",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "#475569",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer",
};

const contentStyle: React.CSSProperties = {
  flexGrow: 1,
  overflowY: "auto",
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const cardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "12px",
  padding: "20px",
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const badgeStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: "4px",
  fontSize: "0.75rem",
  fontWeight: "bold",
  border: "1px solid",
};

const sectionStyle: React.CSSProperties = {
  borderBottom: "1px solid #1e293b",
  paddingBottom: "24px",
};

const sectionHeaderStyle: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: "1rem",
  color: "#38bdf8",
  fontWeight: "bold",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "16px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#94a3b8",
  marginBottom: "4px",
};

const valueStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: "600",
  color: "#e2e8f0",
};

const redactedWarningStyle: React.CSSProperties = {
  marginTop: "12px",
  background: "rgba(56, 189, 248, 0.15)",
  border: "1px solid #38bdf8",
  borderRadius: "6px",
  padding: "10px",
  fontSize: "0.8rem",
  color: "#bae6fd",
};

const mockMapStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  padding: "8px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const mapGridStyle: React.CSSProperties = {
  height: "70px",
  background: "radial-gradient(circle, #334155 10%, transparent 11%)",
  backgroundSize: "8px 8px",
  position: "relative",
  borderRadius: "4px",
  border: "1px solid #475569",
};

const mapMarkerStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "#10b981",
  boxShadow: "0 0 8px 4px rgba(16, 185, 129, 0.5)",
};

const emptyTimelineStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  padding: "16px",
  fontSize: "0.85rem",
  color: "#64748b",
  textAlign: "center",
};

const timelineContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const timelineItemStyle: React.CSSProperties = {
  display: "flex",
  gap: "16px",
};

const timelineMarkerLineStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const timelineBulletStyle: React.CSSProperties = {
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  marginTop: "4px",
};

const timelineVerticalConnectorStyle: React.CSSProperties = {
  width: "2px",
  flexGrow: 1,
  background: "#334155",
  margin: "4px 0",
};

const timelineContentCardStyle: React.CSSProperties = {
  flexGrow: 1,
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  padding: "12px 16px",
  marginBottom: "16px",
};

const timelineExpandedDetailStyle: React.CSSProperties = {
  marginTop: "12px",
  paddingTop: "12px",
  borderTop: "1px solid #334155",
  fontSize: "0.8rem",
  color: "#94a3b8",
  display: "grid",
  gap: "6px",
};
