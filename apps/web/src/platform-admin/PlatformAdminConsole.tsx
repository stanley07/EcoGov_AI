import React, { useEffect, useState } from "react";
import { TenantsTab } from "./tenants/TenantsTab.js";
import { RegistryTab } from "./registry/RegistryTab.js";
import { ExecutionsTab } from "./executions/ExecutionsTab.js";
import { UsageTab } from "./usage/UsageTab.js";
import { HealthTab } from "./health/HealthTab.js";
import { AuditTab } from "./audit/AuditTab.js";

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
  dailyCostLimitMicrounits?: string;
  concurrentExecutionLimit?: number;
}

interface Stats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  pendingInvitations: number;
}

type TabType = "tenants" | "registry" | "executions" | "usage" | "health" | "audit";

export function PlatformAdminConsole({ token }: PlatformAdminConsoleProps) {
  const savedUser = localStorage.getItem("govos_user")
    ? JSON.parse(localStorage.getItem("govos_user")!)
    : null;

  if (!savedUser || savedUser.tenantId !== "00000000-0000-0000-0000-000000000000") {
    return (
      <div
        style={{
          background: "#450a0a",
          border: "1px solid #7f1d1d",
          color: "#fca5a5",
          padding: "30px",
          borderRadius: "12px",
          textAlign: "center",
          maxWidth: "600px",
          margin: "40px auto"
        }}
      >
        <h2 style={{ margin: "0 0 10px 0" }}>⛔ Access Denied</h2>
        <p style={{ margin: 0 }}>You do not have the required administrative permissions to access the Platform Control Plane.</p>
      </div>
    );
  }

  const [activeSubTab, setActiveSubTab] = useState<TabType>(() => {
    const hash = window.location.hash.replace("#", "");
    if (["tenants", "registry", "executions", "usage", "health", "audit"].includes(hash)) {
      return hash as TabType;
    }
    return "tenants";
  });

  const [stats, setStats] = useState<Stats>({
    totalTenants: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    pendingInvitations: 0
  });
  const [tenants, setTenants] = useState<Tenant[]>([]);
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

      const [statsRes, tenantsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/platform-admin/statistics`, { headers }),
        fetch(`${API_BASE_URL}/platform-admin/tenants`, { headers })
      ]);

      if (!statsRes.ok || !tenantsRes.ok) {
        throw new Error("Failed to fetch administrative platform console data");
      }

      setStats(await statsRes.json());
      setTenants(await tenantsRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsoleData();
  }, [token]);

  useEffect(() => {
    window.location.hash = activeSubTab;
  }, [activeSubTab]);

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
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          name: tenantName,
          slug: tenantSlug,
          type: tenantType,
          adminName,
          adminEmail
        })
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

  const tabs: { type: TabType; label: string; icon: string }[] = [
    { type: "tenants", label: "Tenants Management", icon: "🏢" },
    { type: "registry", label: "Registry Management", icon: "📋" },
    { type: "executions", label: "Execution Inspection", icon: "🔍" },
    { type: "usage", label: "Cost & Usage", icon: "📊" },
    { type: "health", label: "Operational Health", icon: "📡" },
    { type: "audit", label: "Audit Trails", icon: "📜" }
  ];

  return (
    <div style={{ display: "grid", gap: "25px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "2.2rem", fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.025em" }}>
            🛡️ GovOS Platform Control Plane
          </h1>
          <p style={{ color: "#94a3b8", marginTop: "6px", fontSize: "1.05rem" }}>
            Security & Administration operational control center
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", padding: "15px", borderRadius: "8px" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tabs navigation bar */}
      <div
        role="tablist"
        aria-label="Platform Admin Console Tabs"
        style={{
          display: "flex",
          borderBottom: "1px solid #334155",
          gap: "5px",
          paddingBottom: "1px"
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.type}
            role="tab"
            aria-selected={activeSubTab === tab.type}
            aria-controls={`panel-${tab.type}`}
            id={`tab-${tab.type}`}
            tabIndex={activeSubTab === tab.type ? 0 : -1}
            onClick={() => setActiveSubTab(tab.type)}
            style={{
              padding: "12px 20px",
              background: activeSubTab === tab.type ? "#1e293b" : "transparent",
              border: "none",
              borderBottom: activeSubTab === tab.type ? "2px solid #38bdf8" : "2px solid transparent",
              color: activeSubTab === tab.type ? "#38bdf8" : "#94a3b8",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "0.95rem",
              transition: "all 0.2s",
              borderRadius: "6px 6px 0 0",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div
        role="tabpanel"
        id={`panel-${activeSubTab}`}
        aria-labelledby={`tab-${activeSubTab}`}
        style={{ minHeight: "400px" }}
      >
        {activeSubTab === "tenants" && (
          <TenantsTab
            token={token}
            stats={stats}
            tenants={tenants}
            loading={loading}
            onRefresh={fetchConsoleData}
            openWizard={openWizard}
          />
        )}
        {activeSubTab === "registry" && (
          <RegistryTab token={token} />
        )}
        {activeSubTab === "executions" && (
          <ExecutionsTab token={token} />
        )}
        {activeSubTab === "usage" && (
          <UsageTab token={token} />
        )}
        {activeSubTab === "health" && (
          <HealthTab token={token} />
        )}
        {activeSubTab === "audit" && (
          <AuditTab token={token} />
        )}
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
            padding: "20px"
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
              overflow: "hidden"
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px",
                borderBottom: "1px solid #334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
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
                  cursor: "pointer"
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
                      borderRadius: "2px"
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
                        boxSizing: "border-box"
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
                        boxSizing: "border-box"
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
                        color: "white"
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
                        cursor: "pointer"
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
                        boxSizing: "border-box"
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
                        boxSizing: "border-box"
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
                        cursor: "pointer"
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
                        cursor: "pointer"
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
                      textAlign: "left"
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
                    Copy the invitation link. Share it with the tenant administrator so they can activate their account.
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
                        cursor: "pointer"
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
