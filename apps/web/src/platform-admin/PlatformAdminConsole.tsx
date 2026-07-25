import React, { useEffect, useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface PlatformAdminConsoleProps {
  token: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: "active" | "suspended" | "archived";
  sessionVersion: number;
  version: number;
  createdAt: string;
}

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

interface Stats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  pendingInvitations: number;
}

export function PlatformAdminConsole({ token }: PlatformAdminConsoleProps) {
  const [stats, setStats] = useState<Stats>({
    totalTenants: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    pendingInvitations: 0,
  });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Provisioning Wizard Modal state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantType, setTenantType] = useState("state");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [provisionResult, setProvisionResult] = useState<any>(null);
  const [provisionError, setProvisionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchConsoleData = async () => {
    try {
      setLoading(true);
      setError("");

      const headers = { Authorization: `Bearer ${token}` };

      const [statsRes, tenantsRes, auditRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/statistics`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/tenants`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/audit-events`, { headers }),
      ]);

      if (!statsRes.ok || !tenantsRes.ok || !auditRes.ok) {
        throw new Error("Failed to fetch administrative platform console data");
      }

      const statsData = await statsRes.json();
      const tenantsData = await tenantsRes.json();
      const auditData = await auditRes.json();

      setStats(statsData);
      setTenants(tenantsData);
      setAuditEvents(auditData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsoleData();
  }, [token]);

  const handleSuspend = async (tenantId: string) => {
    if (!confirm("Are you sure you want to suspend this government tenant? All active user sessions will be invalidated immediately.")) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants/${tenantId}/suspend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to suspend tenant");
      }
      fetchConsoleData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReactivate = async (tenantId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants/${tenantId}/reactivate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reactivate tenant");
      }
      fetchConsoleData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setProvisionError("");

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          name: tenantName,
          slug: tenantSlug,
          type: tenantType,
          adminName,
          adminEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to provision tenant");
      }

      setProvisionResult(data);
      setWizardStep(3);
      fetchConsoleData();
    } catch (err: any) {
      setProvisionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openWizard = () => {
    setTenantName("");
    setTenantSlug("");
    setTenantType("state");
    setAdminName("");
    setAdminEmail("");
    setProvisionResult(null);
    setProvisionError("");
    setWizardStep(1);
    setIsWizardOpen(true);
  };

  const autoGenerateSlug = (name: string) => {
    setTenantName(name);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    setTenantSlug(slug);
  };

  return (
    <div style={{ padding: "40px", maxWidth: "1200px", margin: "0 auto", display: "grid", gap: "30px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "2.2rem", fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.025em" }}>
            🛡️ GovOS Platform Control Plane
          </h1>
          <p style={{ color: "#94a3b8", marginTop: "6px", fontSize: "1.05rem" }}>
            Multi-tenant Government Operations Security & Provisioning Console
          </p>
        </div>
        <button
          onClick={openWizard}
          style={{
            background: "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "12px 24px",
            fontWeight: "bold",
            fontSize: "0.95rem",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
            transition: "all 0.2s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 6px 16px rgba(2, 132, 199, 0.4)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(2, 132, 199, 0.3)";
          }}
        >
          + Provision Government Tenant
        </button>
      </div>

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Metrics Summary */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
        {[
          { label: "Total Tenants", val: stats.totalTenants, color: "#38bdf8" },
          { label: "Active Tenants", val: stats.activeTenants, color: "#34d399" },
          { label: "Suspended Tenants", val: stats.suspendedTenants, color: "#f87171" },
          { label: "Pending Invitations", val: stats.pendingInvitations, color: "#fbbf24" },
        ].map((c, i) => (
          <div
            key={i}
            style={{
              background: "rgba(30, 41, 59, 0.6)",
              backdropFilter: "blur(12px)",
              padding: "24px",
              borderRadius: "12px",
              border: "1px solid #334155",
            }}
          >
            <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {c.label}
            </h3>
            <span style={{ fontSize: "2.8rem", fontWeight: 800, color: c.color, display: "block", marginTop: "10px", lineHeight: "1" }}>
              {loading ? "..." : c.val}
            </span>
          </div>
        ))}
      </section>

      {/* Tenants Table */}
      <div
        style={{
          background: "#1e293b",
          borderRadius: "12px",
          border: "1px solid #334155",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px", borderBottom: "1px solid #334155" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>🏢 Government Tenants</h2>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#0f172a", color: "#94a3b8", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "15px 20px" }}>Tenant Name</th>
                <th style={{ padding: "15px 20px" }}>Slug / Code</th>
                <th style={{ padding: "15px 20px" }}>Type</th>
                <th style={{ padding: "15px 20px" }}>Status</th>
                <th style={{ padding: "15px 20px" }}>Created At</th>
                <th style={{ padding: "15px 20px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    Loading tenants database...
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    No government tenants provisioned yet.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #334155", background: t.status === "suspended" ? "#181f30" : "transparent" }}>
                    <td style={{ padding: "15px 20px", fontWeight: "bold" }}>{t.name}</td>
                    <td style={{ padding: "15px 20px" }}><code style={{ color: "#38bdf8" }}>{t.slug}</code></td>
                    <td style={{ padding: "15px 20px" }}>
                      <span style={{ textTransform: "capitalize", background: "#334155", padding: "3px 8px", borderRadius: "4px", fontSize: "0.8rem" }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "15px 20px" }}>
                      <span
                        style={{
                          color: t.status === "active" ? "#34d399" : "#f87171",
                          fontWeight: "bold",
                          textTransform: "uppercase",
                          fontSize: "0.85rem",
                        }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: "15px 20px", color: "#94a3b8" }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: "15px 20px" }}>
                      {t.status === "active" ? (
                        <button
                          onClick={() => handleSuspend(t.id)}
                          style={{
                            background: "#7f1d1d",
                            color: "#fca5a5",
                            border: "1px solid #991b1b",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "0.85rem",
                            cursor: "pointer",
                          }}
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(t.id)}
                          style={{
                            background: "#064e3b",
                            color: "#a7f3d0",
                            border: "1px solid #065f46",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "0.85rem",
                            cursor: "pointer",
                          }}
                        >
                          Reactivate
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

      {/* Audit Log Timeline */}
      <div
        style={{
          background: "#1e293b",
          borderRadius: "12px",
          border: "1px solid #334155",
          padding: "24px",
        }}
      >
        <h2 style={{ margin: "0 0 20px", fontSize: "1.25rem", color: "#f8fafc" }}>📜 Platform Audit History</h2>
        <div style={{ display: "grid", gap: "15px", maxHeight: "300px", overflowY: "auto", paddingRight: "10px" }}>
          {auditEvents.length === 0 ? (
            <p style={{ color: "#64748b", margin: 0 }}>No audit trails recorded yet.</p>
          ) : (
            auditEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  background: "#0f172a",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #334155",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong style={{ color: "#38bdf8" }}>{event.action}</strong>
                  <span style={{ color: "#64748b", margin: "0 10px" }}>|</span>
                  <span style={{ color: "#cbd5e1" }}>{event.resource}</span>
                </div>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                  {new Date(event.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Provisioning Wizard Modal */}
      {isWizardOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              border: "1px solid #334155",
              width: "100%",
              maxWidth: "550px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px",
                borderBottom: "1px solid #334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#f8fafc" }}>
                Provision New Government Tenant
              </h3>
              <button
                onClick={() => setIsWizardOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  fontSize: "1.4rem",
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: "30px" }}>
              {/* Wizard Steps indicator */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "25px" }}>
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    style={{
                      flex: 1,
                      height: "4px",
                      background: wizardStep >= step ? "#38bdf8" : "#334155",
                      borderRadius: "2px",
                    }}
                  />
                ))}
              </div>

              {provisionError && (
                <div style={{ background: "#450a0a", color: "#fca5a5", padding: "10px", borderRadius: "6px", marginBottom: "15px", fontSize: "0.9rem" }}>
                  {provisionError}
                </div>
              )}

              {/* Step 1: Tenant Profile */}
              {wizardStep === 1 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!tenantName || !tenantSlug) {
                      setProvisionError("Tenant Name and Slug are required.");
                      return;
                    }
                    setWizardStep(2);
                  }}
                  style={{ display: "grid", gap: "20px" }}
                >
                  <div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>
                      Government Tenant Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Anambra State Ministry of Environment"
                      value={tenantName}
                      onChange={(e) => autoGenerateSlug(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "white",
                        boxSizing: "border-box",
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>
                      Unique Slug / Identifier
                    </label>
                    <input
                      type="text"
                      placeholder="anambra-state-ministry-of-environment"
                      value={tenantSlug}
                      onChange={(e) => setTenantSlug(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "white",
                        boxSizing: "border-box",
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>
                      Tenant Type
                    </label>
                    <select
                      value={tenantType}
                      onChange={(e) => setTenantType(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "white",
                      }}
                    >
                      <option value="state">State Government</option>
                      <option value="federal">Federal Agency</option>
                      <option value="local">Local Government Area</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                    <button
                      type="submit"
                      style={{
                        background: "#38bdf8",
                        color: "#0f172a",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      Next: Tenant Admin
                    </button>
                  </div>
                </form>
              )}

              {/* Step 2: Tenant Admin */}
              {wizardStep === 2 && (
                <form onSubmit={handleProvision} style={{ display: "grid", gap: "20px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>
                      Administrator Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Chukwuma Soludo"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "white",
                        boxSizing: "border-box",
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>
                      Administrator Email Address
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. soludo@anambra.gov.ng"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "white",
                        boxSizing: "border-box",
                      }}
                      required
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      style={{
                        background: "#475569",
                        color: "white",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{
                        background: "#34d399",
                        color: "#0f172a",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      {submitting ? "Provisioning..." : "Provision Tenant"}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: Success Screen */}
              {wizardStep === 3 && provisionResult && (
                <div style={{ display: "grid", gap: "20px", textAlign: "center" }}>
                  <div style={{ fontSize: "3rem" }}>🎉</div>
                  <h4 style={{ margin: 0, color: "#34d399", fontSize: "1.2rem" }}>
                    Tenant Successfully Provisioned!
                  </h4>
                  <p style={{ color: "#cbd5e1", margin: 0, fontSize: "0.95rem" }}>
                    Government space <strong>{provisionResult.tenant?.name}</strong> has been created.
                  </p>
                  
                  <div
                    style={{
                      background: "#0f172a",
                      padding: "15px",
                      borderRadius: "8px",
                      border: "1px solid #334155",
                      textAlign: "left",
                    }}
                  >
                    <strong style={{ color: "#94a3b8", display: "block", marginBottom: "5px", fontSize: "0.85rem" }}>
                      ACTIVATION INVITATION LINK
                    </strong>
                    <code style={{ wordBreak: "break-all", color: "#38bdf8", display: "block" }}>
                      {`${window.location.origin}/activate?token=${provisionResult.invitation?.token}`}
                    </code>
                  </div>

                  <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: 0 }}>
                    Copy the invitation link above. Share it with the tenant administrator so they can set up their secure login credentials.
                  </p>

                  <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
                    <button
                      onClick={() => setIsWizardOpen(false)}
                      style={{
                        background: "#38bdf8",
                        color: "#0f172a",
                        border: "none",
                        padding: "10px 24px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
