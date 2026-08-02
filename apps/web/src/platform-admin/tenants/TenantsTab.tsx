import React, { useState } from "react";

const API_BASE_URL = "http://localhost:8080";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: "active" | "suspended" | "archived";
  sessionVersion: number;
  version: number;
  createdAt: string;
  dailyCostLimitMicrounits?: string;
  concurrentExecutionLimit?: number;
}

interface Stats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  pendingInvitations: number;
}

interface TenantsTabProps {
  token: string;
  stats: Stats;
  tenants: Tenant[];
  loading: boolean;
  onRefresh: () => void;
  openWizard: () => void;
}

export function TenantsTab({ token, stats, tenants, loading, onRefresh, openWizard }: TenantsTabProps) {
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [modalType, setModalType] = useState<"quotas" | "limits" | null>(null);
  const [dailyCostLimit, setDailyCostLimit] = useState("");
  const [concurrentLimit, setConcurrentLimit] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const handleSuspend = async (tenant: Tenant) => {
    const reason = prompt("Enter suspension justification reason (mandatory):");
    if (!reason) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants/${tenant.id}/suspend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason, expectedVersion: tenant.version, expectedStatus: tenant.status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to suspend tenant");
      }
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async (tenant: Tenant) => {
    const reason = prompt("Enter reactivation justification reason (mandatory):");
    if (!reason) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants/${tenant.id}/reactivate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason, expectedVersion: tenant.version, expectedStatus: tenant.status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reactivate tenant");
      }
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openConfigModal = (tenant: Tenant, type: "quotas" | "limits") => {
    setSelectedTenant(tenant);
    setModalType(type);
    setActionReason("");
    setActionError("");
    if (type === "quotas") {
      setDailyCostLimit(tenant.dailyCostLimitMicrounits || "10000000");
    } else {
      setConcurrentLimit(String(tenant.concurrentExecutionLimit || 5));
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant || !actionReason) {
      setActionError("Reason justification is required");
      return;
    }

    setSubmitting(true);
    setActionError("");

    try {
      const endpoint = modalType === "quotas" ? "quotas" : "runtime-limits";
      const body = modalType === "quotas"
        ? { dailyCostLimitMicrounits: parseInt(dailyCostLimit), reason: actionReason, expectedVersion: selectedTenant.version }
        : { concurrentExecutionLimit: parseInt(concurrentLimit), reason: actionReason, expectedVersion: selectedTenant.version };

      const res = await fetch(`${API_BASE_URL}/platform-admin/tenants/${selectedTenant.id}/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update configuration");
      }

      setModalType(null);
      setSelectedTenant(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "30px" }}>
      {/* Metrics Summary */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
        {[
          { label: "Total Tenants", val: stats.totalTenants, color: "#38bdf8" },
          { label: "Active Tenants", val: stats.activeTenants, color: "#34d399" },
          { label: "Suspended Tenants", val: stats.suspendedTenants, color: "#f87171" },
          { label: "Pending Invitations", val: stats.pendingInvitations, color: "#fbbf24" }
        ].map((c, i) => (
          <div
            key={i}
            style={{
              background: "rgba(30, 41, 59, 0.6)",
              backdropFilter: "blur(12px)",
              padding: "24px",
              borderRadius: "12px",
              border: "1px solid #334155"
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
      <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", overflow: "hidden" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>🏢 Government Tenants Registry</h2>
          <button
            onClick={openWizard}
            style={{
              background: "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            + Provision Tenant
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#0f172a", color: "#94a3b8", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "15px 20px" }}>Tenant Name</th>
                <th style={{ padding: "15px 20px" }}>Slug</th>
                <th style={{ padding: "15px 20px" }}>Daily Budget</th>
                <th style={{ padding: "15px 20px" }}>Concurrency</th>
                <th style={{ padding: "15px 20px" }}>Status</th>
                <th style={{ padding: "15px 20px" }}>Created At</th>
                <th style={{ padding: "15px 20px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    Loading tenants database...
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    No government tenants provisioned.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #334155", background: t.status === "suspended" ? "#181f30" : "transparent" }}>
                    <td style={{ padding: "15px 20px", fontWeight: "bold" }}>{t.name}</td>
                    <td style={{ padding: "15px 20px" }}><code style={{ color: "#38bdf8" }}>{t.slug}</code></td>
                    <td style={{ padding: "15px 20px" }}>
                      <span style={{ color: "#34d399", fontWeight: "600" }}>
                        ${((parseInt(t.dailyCostLimitMicrounits || "0")) / 1000000).toFixed(2)}
                      </span>
                      <button
                        onClick={() => openConfigModal(t, "quotas")}
                        style={{ marginLeft: "10px", background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "0.85rem" }}
                      >
                        ✏️ Edit
                      </button>
                    </td>
                    <td style={{ padding: "15px 20px" }}>
                      <span>{t.concurrentExecutionLimit || 5} concurrent</span>
                      <button
                        onClick={() => openConfigModal(t, "limits")}
                        style={{ marginLeft: "10px", background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "0.85rem" }}
                      >
                        ✏️ Edit
                      </button>
                    </td>
                    <td style={{ padding: "15px 20px" }}>
                      <span style={{ color: t.status === "active" ? "#34d399" : "#f87171", fontWeight: "bold", textTransform: "uppercase", fontSize: "0.85rem" }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: "15px 20px", color: "#94a3b8" }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: "15px 20px" }}>
                      {t.status === "active" ? (
                        <button
                          onClick={() => handleSuspend(t)}
                          disabled={submitting}
                          style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(t)}
                          disabled={submitting}
                          style={{ background: "#064e3b", color: "#a7f3d0", border: "1px solid #065f46", padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer" }}
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

      {/* Quota & Runtime Limits Modal */}
      {modalType && selectedTenant && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", width: "100%", maxWidth: "500px", overflow: "hidden" }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#f8fafc" }}>
                {modalType === "quotas" ? `Configure Daily Quota: ${selectedTenant.name}` : `Configure Runtime Limits: ${selectedTenant.name}`}
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer" }}>&times;</button>
            </div>
            <form onSubmit={handleSaveConfig} style={{ padding: "24px", display: "grid", gap: "20px" }}>
              {actionError && <div style={{ background: "#450a0a", color: "#fca5a5", padding: "10px", borderRadius: "6px", fontSize: "0.9rem" }}>{actionError}</div>}
              {modalType === "quotas" ? (
                <div>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>Daily Cost Limit (Microunits)</label>
                  <input
                    type="number"
                    value={dailyCostLimit}
                    onChange={(e) => setDailyCostLimit(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}
                    required
                  />
                  <small style={{ color: "#94a3b8", marginTop: "4px", display: "block" }}>1,000,000 microunits = $1.00 USD</small>
                </div>
              ) : (
                <div>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>Concurrent Executions Limit</label>
                  <input
                    type="number"
                    value={concurrentLimit}
                    onChange={(e) => setConcurrentLimit(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}
                    required
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "#cbd5e1" }}>Justification Reason (Mandatory)</label>
                <input
                  type="text"
                  placeholder="e.g. Budget increase for Q3 environmental auditing"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "white" }}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" onClick={() => setModalType(null)} style={{ background: "#475569", border: "none", color: "white", padding: "10px 20px", borderRadius: "6px", cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "10px 20px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}>
                  {submitting ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
