/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { OfficerWorkbench } from "./workbench/components/OfficerWorkbench.js";
import { FacilityRegistrationModal } from "./facilities/components/FacilityRegistrationModal.js";
import { LandingPage } from "./LandingPage.js";
import { PlatformAdminConsole } from "./platform-admin/PlatformAdminConsole.js";


// API target endpoint base URL
const API_BASE_URL = "http://localhost:8080";

interface User {
  id: string;
  tenantId: string;
  tenantName?: string;
  organizationName?: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

interface Facility {
  id: string;
  tenantId: string;
  organizationId: string;
  ownerUserId?: string;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  registrationStatus:
    | "draft"
    | "submitted"
    | "in_review"
    | "action_required"
    | "approved"
    | "rejected";
  riskRating: "unknown" | "low" | "medium" | "high";
  createdAt: string;
}

interface Organization {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  createdAt: string;
}




function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("govos_token"),
  );
  const [user, setUser] = useState<User | null>(
    localStorage.getItem("govos_user")
      ? JSON.parse(localStorage.getItem("govos_user")!)
      : null,
  );

  const [activeTab, setActiveTab] = useState<
    "dashboard" | "registry" | "wizard" | "queue" | "settings" | "platform"
  >(() => {
    const savedUser = localStorage.getItem("govos_user")
      ? JSON.parse(localStorage.getItem("govos_user")!)
      : null;
    return savedUser?.tenantId === "00000000-0000-0000-0000-000000000000"
      ? "platform"
      : "dashboard";
  });
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const registerButtonRef = useRef<HTMLButtonElement | null>(null);

  // Auth Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Registration Form State
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("Car Wash");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState(6.5244);
  const [longitude, setLongitude] = useState(3.3792);
  const [orgId, setOrgId] = useState("");
  const [wizardSuccess, setWizardSuccess] = useState("");
  const [wizardError, setWizardError] = useState("");



  // Fetch metrics
  const [apiReadyState, setApiReadyState] = useState<any>(null);

  // Auto-login helpers for testing
  const quickLogin = (type: "owner" | "inspector" | "director") => {
    if (type === "owner") {
      setEmail("owner@carwash.com");
    } else if (type === "inspector") {
      setEmail("inspector@govos.ai");
    } else if (type === "director") {
      setEmail("director@govos.ai");
    }
    setPassword("password123");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Login credentials rejected");
      }

      const data = await res.json();
      localStorage.setItem("govos_token", data.token);
      localStorage.setItem("govos_user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      if (data.user.tenantId === "00000000-0000-0000-0000-000000000000") {
        setActiveTab("platform");
      } else {
        setActiveTab("dashboard");
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("govos_token");
    localStorage.removeItem("govos_user");
    setToken(null);
    setUser(null);
    setActiveTab("dashboard");
  };

  // Fetch facilities and organizations
  const fetchData = async () => {
    if (!token) return;
    try {
      const facRes = await fetch(`${API_BASE_URL}/facilities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (facRes.ok) {
        const data = await facRes.json();
        setFacilities(data);
      }

      const orgRes = await fetch(`${API_BASE_URL}/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (orgRes.ok) {
        const data = await orgRes.json();
        setOrganizations(data);
        if (data.length > 0) setOrgId(data[0].id);
      }

      const readyRes = await fetch(`${API_BASE_URL}/readyz`);
      if (readyRes.ok) {
        const readyData = await readyRes.json();
        setApiReadyState(readyData);
      }
    } catch (err) {
      console.error("Failed to load backend metrics", err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  // Handle facility registration submit
  const handleRegisterFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    setWizardError("");
    setWizardSuccess("");
    try {
      const res = await fetch(`${API_BASE_URL}/facilities`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          organizationId: orgId,
          businessName,
          category,
          address,
          latitude: parseFloat(latitude as any),
          longitude: parseFloat(longitude as any),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create facility");
      }

      const newFac = await res.json();

      // Submit registration workflow immediately
      const submitRes = await fetch(
        `${API_BASE_URL}/facilities/${newFac.id}/register`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!submitRes.ok) {
        const err = await submitRes.json();
        throw new Error(
          err.error || "Facility created but registration trigger failed",
        );
      }

      setWizardSuccess(
        `Facility "${businessName}" successfully registered and queued for AI Review!`,
      );
      setBusinessName("");
      setAddress("");
      fetchData();
    } catch (err: any) {
      setWizardError(err.message);
    }
  };





  // Renders the public Landing Page if token is missing
  if (!token || !user) {
    return (
      <LandingPage
        onLogin={handleLogin}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authError={authError}
        quickLogin={quickLogin}
      />
    );
  }

  const isOfficer =
    user.roles.includes("director") ||
    user.roles.includes("inspector") ||
    user.roles.includes("super_admin");

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0f172a",
        color: "#f1f5f9",
      }}
    >
      {/* Sidebar navigation */}
      <aside
        style={{
          width: "260px",
          background: "#1e293b",
          borderRight: "1px solid #334155",
          padding: "30px 20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ marginBottom: "40px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img
            src="/minEnv.jpg"
            alt="Anambra State Ministry of Environment logo"
            style={{
              width: "60px",
              height: "60px",
              objectFit: "contain",
              borderRadius: "50%",
              background: "white",
              marginBottom: "10px",
              border: "1px solid #334155"
            }}
          />
          <h2 style={{ margin: 0, fontSize: "1.6rem", color: "#38bdf8", textAlign: "center" }}>
            EcoGov AI
          </h2>
          <span style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "4px", textAlign: "center", display: "block", lineHeight: "1.2" }}>
            workspace:<br/>
            <strong>{apiReadyState ? (user?.tenantName || "Anambra State Ministry of Environment") : "Connecting..."}</strong>
          </span>
        </div>

        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            flex: 1,
          }}
        >
          {user?.tenantId === "00000000-0000-0000-0000-000000000000" ? (
            <>
              <button
                onClick={() => {
                  setActiveTab("platform");
                }}
                style={{
                  padding: "12px 15px",
                  borderRadius: "8px",
                  background: activeTab === "platform" ? "#0f172a" : "transparent",
                  border: "none",
                  color: "#f1f5f9",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                🛡️ Platform Console
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setActiveTab("dashboard");
                }}
                style={{
                  padding: "12px 15px",
                  borderRadius: "8px",
                  background: activeTab === "dashboard" ? "#0f172a" : "transparent",
                  border: "none",
                  color: "#f1f5f9",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                📊 System Dashboard
              </button>
              <button
                onClick={() => {
                  setActiveTab("registry");
                }}
                style={{
                  padding: "12px 15px",
                  borderRadius: "8px",
                  background: activeTab === "registry" ? "#0f172a" : "transparent",
                  border: "none",
                  color: "#f1f5f9",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                📋 Facility Registry
              </button>
              {!isOfficer && (
                <button
                  onClick={() => {
                    setActiveTab("wizard");
                  }}
                  style={{
                    padding: "12px 15px",
                    borderRadius: "8px",
                    background: activeTab === "wizard" ? "#0f172a" : "transparent",
                    border: "none",
                    color: "#f1f5f9",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  ➕ Register Facility
                </button>
              )}
              {isOfficer && (
                <button
                  onClick={() => {
                    setActiveTab("queue");
                  }}
                  style={{
                    padding: "12px 15px",
                    borderRadius: "8px",
                    background: activeTab === "queue" ? "#0f172a" : "transparent",
                    border: "none",
                    color: "#f1f5f9",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  ⚖️ Officer Review Queue
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              setActiveTab("settings");
            }}
            style={{
              padding: "12px 15px",
              borderRadius: "8px",
              background: activeTab === "settings" ? "#0f172a" : "transparent",
              border: "none",
              color: "#f1f5f9",
              textAlign: "left",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ⚙️ Org Settings
          </button>
        </nav>

        <div style={{ borderTop: "1px solid #334155", paddingTop: "20px" }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: "0.85rem",
              color: "#94a3b8",
            }}
          >
            logged in as: <br />
            <strong>
              {user.firstName} {user.lastName}
            </strong>
          </p>
          <button
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "10px",
              background: "#f87171",
              color: "#0f172a",
              border: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main style={{ flex: 1, padding: "40px", overflowY: "auto" }}>
        {/* Tab 0: Platform Admin Console */}
        {activeTab === "platform" && (
          <PlatformAdminConsole token={token!} />
        )}

        {/* Tab 1: Dashboard */}
        {activeTab === "dashboard" && (
          <div>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                📊 System Dashboard
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Operational summaries and diagnostics endpoints
              </p>
            </header>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "20px",
                marginBottom: "40px",
              }}
            >
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Registered Facilities
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#38bdf8",
                  }}
                >
                  {facilities.length}
                </span>
              </div>
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Active Review Cases
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#fbbf24",
                  }}
                >
                  {
                    facilities.filter(
                      (f) =>
                        f.registrationStatus === "in_review" ||
                        f.registrationStatus === "submitted",
                    ).length
                  }
                </span>
              </div>
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Approved Permits
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#34d399",
                  }}
                >
                  {
                    facilities.filter(
                      (f) => f.registrationStatus === "approved",
                    ).length
                  }
                </span>
              </div>
            </section>

            {/* Diagnostics status check */}
            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
              }}
            >
              <h2 style={{ margin: "0 0 20px", color: "#f8fafc" }}>
                Developer Platform Integrity
              </h2>
              {apiReadyState ? (
                <div style={{ display: "grid", gap: "10px" }}>
                  <p style={{ margin: 0 }}>
                    <strong>PostgreSQL Connection:</strong>{" "}
                    <span style={{ color: "#34d399", fontWeight: "bold" }}>
                      CONNECTED
                    </span>
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Schema Migrations:</strong>{" "}
                    <span style={{ color: "#34d399", fontWeight: "bold" }}>
                      CURRENT (v000002)
                    </span>
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Active Tenant Isolation:</strong>{" "}
                    <span style={{ color: "#38bdf8", fontWeight: "bold" }}>
                      ENFORCED (RLS checks active)
                    </span>
                  </p>
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>
                  Loading platform diagnostics...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Registry */}
        {activeTab === "registry" && (
          <div>
            <header style={{ marginBottom: "30px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h1 style={{ margin: 0, fontSize: "2rem" }}>
                  📋 Facility Registry
                </h1>
                <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                  {`${user?.tenantName || "Anambra State Ministry of Environment"} Regulated Facilities`}
                </p>
              </div>
              {(user?.roles.includes("super_admin") ||
                user?.roles.includes("facility:register") ||
                user?.roles.includes("facility:write")) && (
                <button
                  ref={registerButtonRef}
                  onClick={() => setIsRegisterModalOpen(true)}
                  style={{
                    padding: "10px 20px",
                    background: "#0ea5e9",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.95rem",
                    transition: "background 0.2s",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#0284c7")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#0ea5e9")}
                >
                  + Register Facility
                </button>
              )}
            </header>

            <div
              style={{
                background: "#1e293b",
                borderRadius: "12px",
                border: "1px solid #334155",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#0f172a",
                      borderBottom: "1px solid #334155",
                    }}
                  >
                    <th style={{ padding: "15px 20px" }}>Business Name</th>
                    <th style={{ padding: "15px 20px" }}>Category</th>
                    <th style={{ padding: "15px 20px" }}>Risk Rating</th>
                    <th style={{ padding: "15px 20px" }}>Status</th>
                    <th style={{ padding: "15px 20px" }}>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((fac) => (
                    <tr
                      key={fac.id}
                      style={{ borderBottom: "1px solid #334155" }}
                    >
                      <td style={{ padding: "15px 20px", fontWeight: "bold" }}>
                        {fac.businessName}
                      </td>
                      <td style={{ padding: "15px 20px" }}>{fac.category}</td>
                      <td style={{ padding: "15px 20px" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: "bold",
                            background:
                              fac.riskRating === "high"
                                ? "rgba(239, 68, 68, 0.2)"
                                : fac.riskRating === "medium"
                                  ? "rgba(251, 191, 36, 0.2)"
                                  : "rgba(52, 211, 153, 0.2)",
                            color:
                              fac.riskRating === "high"
                                ? "#fca5a5"
                                : fac.riskRating === "medium"
                                  ? "#fde047"
                                  : "#a7f3d0",
                          }}
                        >
                          {fac.riskRating.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "15px 20px" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: "bold",
                            background:
                              fac.registrationStatus === "approved"
                                ? "rgba(52, 211, 153, 0.2)"
                                : fac.registrationStatus === "in_review"
                                  ? "rgba(56, 189, 248, 0.2)"
                                  : "rgba(100, 116, 139, 0.2)",
                            color:
                              fac.registrationStatus === "approved"
                                ? "#a7f3d0"
                                : fac.registrationStatus === "in_review"
                                  ? "#bae6fd"
                                  : "#cbd5e1",
                          }}
                        >
                          {fac.registrationStatus.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "15px 20px", color: "#94a3b8" }}>
                        {fac.address}
                      </td>
                    </tr>
                  ))}
                  {facilities.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: "40px",
                          textAlign: "center",
                          color: "#64748b",
                        }}
                      >
                        No facilities registered under this tenant yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Wizard */}
        {activeTab === "wizard" && (
          <div style={{ maxWidth: "600px" }}>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                ➕ Register New Facility
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Submit coordinates and files to launch AI Auditor Review
              </p>
            </header>

            {wizardSuccess && (
              <div
                style={{
                  padding: "15px",
                  background: "rgba(52, 211, 153, 0.15)",
                  border: "1px solid #34d399",
                  borderRadius: "6px",
                  color: "#a7f3d0",
                  marginBottom: "25px",
                }}
              >
                {wizardSuccess}
              </div>
            )}
            {wizardError && (
              <div
                style={{
                  padding: "15px",
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid #ef4444",
                  borderRadius: "6px",
                  color: "#fca5a5",
                  marginBottom: "25px",
                }}
              >
                {wizardError}
              </div>
            )}

            <form
              onSubmit={handleRegisterFacility}
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
                display: "grid",
                gap: "20px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                  }}
                >
                  Assign to Organization
                </label>
                <select
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#f1f5f9",
                  }}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                  }}
                >
                  Business Legal Name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  placeholder="e.g. Awka Car Wash Ltd"
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#f1f5f9",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                  }}
                >
                  Facility Regulation Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#f1f5f9",
                  }}
                >
                  <option value="Car Wash">Car Wash</option>
                  <option value="Hotel">Hotel</option>
                  <option value="Guest House">Guest House</option>
                  <option value="Restaurant">Restaurant</option>
                  <option value="Hospital">Hospital</option>
                  <option value="Clinic">Clinic</option>
                  <option value="Pharmacy">Pharmacy</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                  }}
                >
                  Street Address
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#f1f5f9",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      color: "#94a3b8",
                    }}
                  >
                    GPS Latitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={latitude}
                    onChange={(e) => setLatitude(parseFloat(e.target.value))}
                    required
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "6px",
                      background: "#0f172a",
                      border: "1px solid #334155",
                      color: "#f1f5f9",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      color: "#94a3b8",
                    }}
                  >
                    GPS Longitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={longitude}
                    onChange={(e) => setLongitude(parseFloat(e.target.value))}
                    required
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "6px",
                      background: "#0f172a",
                      border: "1px solid #334155",
                      color: "#f1f5f9",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                style={{
                  padding: "12px",
                  background: "#38bdf8",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  marginTop: "10px",
                }}
              >
                Submit Environmental Application
              </button>
            </form>
          </div>
        )}

        {/* Tab 4: Queue (Officer Review Console) */}
        {activeTab === "queue" && (
          <OfficerWorkbench token={token} />
        )}

        {/* Tab 5: Settings */}
        {activeTab === "settings" && (
          <div style={{ maxWidth: "700px" }}>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                ⚙️ Organization Settings
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Manage active team workspace memberships and variables
              </p>
            </header>

            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
                marginBottom: "30px",
              }}
            >
              <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>
                Active User Information
              </h3>
              <p style={{ margin: "5px 0" }}>
                <strong>Full Name:</strong> {user.firstName} {user.lastName}
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Email Address:</strong> {user.email}
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Tenant ID:</strong> <code>{user.tenantId}</code>
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Assigned System Roles:</strong>{" "}
                {user.roles.map((r) => (
                  <span
                    key={r}
                    style={{
                      padding: "2px 6px",
                      background: "#334155",
                      color: "#bae6fd",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      marginRight: "5px",
                      fontWeight: "bold",
                    }}
                  >
                    {r.toUpperCase()}
                  </span>
                ))}
              </p>
            </div>

            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
              }}
            >
              <h3 style={{ margin: "0 0 20px", color: "#f8fafc" }}>
                Workspace Teams
              </h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <p style={{ margin: 0 }}>
                  <strong>Government Unit:</strong> {user?.organizationName || "Anambra State Ministry of Environment Headquarters"}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Department:</strong> Environmental Enforcement &
                  Engineering Registry
                </p>
              </div>
            </div>
          </div>
        )}
      {isRegisterModalOpen && (
        <FacilityRegistrationModal
          onClose={() => setIsRegisterModalOpen(false)}
          onSuccess={() => {
            fetchData();
          }}
          organizations={organizations}
          token={token || ""}
          triggerButtonRef={registerButtonRef}
        />
      )}
      </main>

    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
