import React, { useState } from "react";
import { usePlatformStatistics } from "./public/hooks/usePlatformStatistics.js";

interface LandingPageProps {
  onLogin: (e: React.FormEvent) => Promise<void>;
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  authError: string;
  quickLogin: (type: "owner" | "inspector" | "director") => void;
}

export function LandingPage({
  onLogin,
  email,
  setEmail,
  password,
  setPassword,
  authError,
  quickLogin,
}: LandingPageProps) {
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [actionAlert, setActionAlert] = useState<string | null>(null);
  const { loading, error, data, retry } = usePlatformStatistics();

  const handleAction = (label: string) => {
    setActionAlert(
      `The "${label}" feature is coming soon in the next release. For this demo, please log in to access the registered facilities dashboard.`,
    );
  };

  const handleRegisterClick = () => {
    setIsLoginModalOpen(true);
    setActionAlert(
      "To register a facility, please log in with your account. You can use the Quick Access Stubs in the login form.",
    );
  };

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        background: "#f8fafc",
        color: "#0f172a",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        margin: 0,
        padding: 0,
      }}
    >
      <style>{`
        .landing-action:focus-visible { outline: 3px solid #facc15; outline-offset: 3px; }
        .landing-header-nav { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 640px) {
          .landing-header-inner { align-items: flex-start !important; flex-wrap: wrap; }
          .landing-header-nav { width: 100%; justify-content: flex-start; }
          .landing-header-nav .landing-action { flex: 1 1 145px; text-align: center; }
          .landing-hero-actions .landing-action { width: 100%; min-width: 0 !important; }
        }
      `}</style>
      {/* Header */}
      <header
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          className="landing-header-inner"
          style={{
            maxWidth: "1200px",
            width: "100%",
            margin: "0 auto",
            padding: "15px 20px",
            boxSizing: "border-box",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Ministry branding remains in the header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <img
              src="/minEnv.jpg"
              alt="Anambra State Ministry of Environment Logo"
              style={{
                width: "48px",
                height: "48px",
                objectFit: "contain",
                borderRadius: "50%",
                border: "1px solid #cbd5e1",
                flexShrink: 0,
              }}
            />

            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "1.1rem",
                  fontWeight: 800,
                  color: "#1e293b",
                  letterSpacing: "-0.025em",
                }}
              >
                Anambra State Government
              </h1>

              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#16a34a",
                  fontWeight: 600,
                }}
              >
                Ministry of Environment
              </p>
            </div>
          </div>

          <nav className="landing-header-nav" aria-label="Public navigation">
            <button type="button" className="landing-action" onClick={handleRegisterClick} style={{ minHeight: "44px", padding: "10px 12px", background: "transparent", color: "#166534", border: "1px solid #bbf7d0", borderRadius: "7px", fontWeight: 700, cursor: "pointer" }}>Facility Registration</button>
            <a className="landing-action" href="#/subcontractor-apply" style={{ minHeight: "44px", boxSizing: "border-box", display: "inline-flex", alignItems: "center", padding: "10px 12px", color: "#166534", borderRadius: "7px", fontWeight: 700, textDecoration: "none" }}>Become a Subcontractor</a>
            <a className="landing-action" href="#/verify-licence" style={{ minHeight: "44px", boxSizing: "border-box", display: "inline-flex", alignItems: "center", padding: "10px 12px", color: "#1e3a8a", borderRadius: "7px", fontWeight: 700, textDecoration: "none" }}>Verify Licence</a>
            <button type="button" className="landing-action" onClick={() => setIsLoginModalOpen(true)} style={{ minHeight: "44px", padding: "10px 20px", background: "#16a34a", color: "#ffffff", border: "none", borderRadius: "7px", fontWeight: 700, cursor: "pointer" }}>Login</button>
          </nav>
        </div>
      </header>

      {/* Alert Banner */}
      {actionAlert && (
        <div
          role="status"
          style={{
            background: "#eff6ff",
            borderBottom: "1px solid #bfdbfe",
            color: "#1e40af",
            padding: "12px 20px",
            fontSize: "0.9rem",
            textAlign: "center",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>ℹ️ {actionAlert}</span>

          <button
            type="button"
            className="landing-action"
            aria-label="Close notification"
            onClick={() => setActionAlert(null)}
            style={{
              background: "none",
              border: "none",
              color: "#1e40af",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section
        style={{
          width: "100%",
          minHeight: "610px",
          padding: "60px 20px 70px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {/* Only the centre hero uses the Anambra State Government Seal */}
        <img
          src="/anambra-state-government.png"
          alt="Government of Anambra State Seal"
          style={{
            display: "block",
            width: "140px",
            height: "140px",
            maxWidth: "100%",
            objectFit: "contain",
            margin: "0 auto 24px",
            background: "transparent",
            border: "none",
            boxShadow: "none",
            flexShrink: 0,
          }}
        />

        <span
          style={{
            background: "#dcfce7",
            color: "#15803d",
            padding: "7px 20px",
            borderRadius: "999px",
            fontSize: "0.85rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            display: "inline-block",
            marginBottom: "28px",
          }}
        >
          EcoGov AI Platform
        </span>

        <h2
          style={{
            width: "100%",
            maxWidth: "950px",
            fontSize: "clamp(2.4rem, 5vw, 4rem)",
            fontWeight: 900,
            color: "#0f172a",
            margin: "0 auto 24px",
            lineHeight: 1.08,
            letterSpacing: "-0.04em",
            textAlign: "center",
          }}
        >
          Anambra State Environmental
          <br />
          <span style={{ color: "#16a34a" }}>
            Compliance Portal
          </span>
        </h2>

        <p
          style={{
            width: "100%",
            maxWidth: "820px",
            fontSize: "clamp(1rem, 2vw, 1.2rem)",
            color: "#475569",
            margin: "0 auto 40px",
            lineHeight: 1.7,
            textAlign: "center",
          }}
        >
          Welcome to the official environmental management platform of the
          Anambra State Ministry of Environment. Register regulated facilities,
          report environmental incidents, monitor compliance, and manage
          inspections through one intelligent platform.
        </p>

        {/* Primary Calls to Action */}
        <div
          className="landing-hero-actions"
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "15px",
            flexWrap: "wrap",
            marginBottom: "50px",
          }}
        >
          <button
            type="button"
            className="landing-action"
            aria-label="Register Your Facility"
            onClick={handleRegisterClick}
            style={{
              minWidth: "265px",
              padding: "16px 32px",
              background: "#16a34a",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontSize: "1.05rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 6px -1px rgba(22, 163, 74, 0.2)",
              transition:
                "transform 0.2s, box-shadow 0.2s, background 0.2s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "#15803d";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "#16a34a";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Register Your Facility
          </button>

          <a
            className="landing-action"
            href="#/subcontractor-apply"
            aria-label="Become a Licensed Subcontractor"
            style={{
              minWidth: "315px",
              padding: "16px 32px",
              background: "#1e3a8a",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontSize: "1.05rem",
              fontWeight: 700,
              textDecoration: "none",
              boxSizing: "border-box",
              boxShadow: "0 4px 6px -1px rgba(30, 58, 138, 0.2)",
              transition:
                "transform 0.2s, box-shadow 0.2s, background 0.2s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "#1e40af";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "#1e3a8a";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Become a Licensed Subcontractor
          </a>

          <a className="landing-action" href="#/verify-licence" aria-label="Verify Licence" style={{ minWidth: "210px", minHeight: "56px", padding: "14px 28px", boxSizing: "border-box", display: "inline-flex", justifyContent: "center", alignItems: "center", color: "#1e3a8a", background: "#ffffff", border: "2px solid #1e3a8a", borderRadius: "8px", fontSize: "1.05rem", fontWeight: 700, textDecoration: "none" }}>
            Verify Licence
          </a>
        </div>

        {/* Public subcontractor acquisition section */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "24px 30px",
            maxWidth: "750px",
            width: "100%",
            boxSizing: "border-box",
            margin: "0 auto 40px auto",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
            textAlign: "left"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ fontSize: "1.5rem" }}>💼</span>
            <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "#1e293b" }}>
              Become an Environmental Operations Partner
            </h3>
          </div>
          <p style={{ margin: "0 0 20px 0", fontSize: "0.9rem", color: "#64748b", lineHeight: 1.5 }}>
            Apply to join the EcoGov AI subcontractor network. Approved operators can receive a digital licence, assigned operational territory, access to facility registration tools, and a performance scorecard.
          </p>
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 24px", margin: "0 0 22px", paddingLeft: "22px", color: "#334155", lineHeight: 1.5 }}>
            <li>Digital subcontractor licence</li>
            <li>Assigned LGA or cluster operations</li>
            <li>AI-assisted onboarding and screening</li>
            <li>Facility registration access</li>
            <li>Performance and quality scorecards</li>
            <li>Public QR licence verification</li>
          </ul>
          <p style={{ margin: "0 0 18px", color: "#475569", fontSize: "0.85rem", lineHeight: 1.6 }}>
            Subject to screening and officer approval. Territory assignment where approved. Licence issued after successful approval and payment verification.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a
              className="landing-action"
              href="#/subcontractor-apply"
              aria-label="Apply as a Subcontractor"
              style={{
                flex: 1,
                minWidth: "160px",
                padding: "12px 18px",
                minHeight: "44px",
                background: "#16a34a",
                color: "#ffffff",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "0.85rem",
                textDecoration: "none",
                textAlign: "center",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#15803d")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#16a34a")}
            >
              Apply as a Subcontractor
            </a>
            <a
              className="landing-action"
              href="#/subcontractor-apply"
              style={{
                flex: 1,
                minWidth: "160px",
                padding: "12px 18px",
                background: "#1e3a8a",
                color: "#ffffff",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "0.85rem",
                textDecoration: "none",
                textAlign: "center",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#1e40af")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#1e3a8a")}
            >
              📝 Continue Saved Draft
            </a>
            <a
              className="landing-action"
              href="#/marketplace/status"
              style={{
                flex: 1,
                minWidth: "160px",
                padding: "12px 18px",
                background: "#64748b",
                color: "#ffffff",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "0.85rem",
                textDecoration: "none",
                textAlign: "center",
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#475569")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#64748b")}
            >
              🔍 Check Status
            </a>
          </div>
        </div>

        {/* Secondary Actions */}
        <div
          style={{
            width: "100%",
            maxWidth: "900px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "22px",
            color: "#64748b",
            fontSize: "0.9rem",
            fontWeight: 600,
            flexWrap: "wrap",
            borderTop: "1px solid #e2e8f0",
            paddingTop: "25px",
          }}
        >
          <button
            type="button"
            onClick={() => setIsLoginModalOpen(true)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "#16a34a",
              font: "inherit",
            }}
          >
            🔑 Account Sign In
          </button>

          <span aria-hidden="true">•</span>

          <a
            className="landing-action"
            href="#/subcontractor-apply"
            style={{
              color: "#16a34a",
              textDecoration: "none",
            }}
          >
            💼 Apply as Subcontractor
          </a>

          <span aria-hidden="true">•</span>

          <a
            className="landing-action"
            href="#/marketplace/status"
            style={{
              color: "#64748b",
              textDecoration: "none",
            }}
          >
            🔍 Subcontractor Status
          </a>

          <span aria-hidden="true">•</span>

          <button
            type="button"
            onClick={() => handleAction("Track Registration")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "#64748b",
              font: "inherit",
            }}
          >
            🔍 Track Registration Status
          </button>

          <span aria-hidden="true">•</span>

          <button
            type="button"
            onClick={() => handleAction("Verify Permit")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "#64748b",
              font: "inherit",
            }}
          >
            📜 Verify Permit ID
          </button>

          <span aria-hidden="true">•</span>

          <button
            type="button"
            onClick={() => handleAction("View Guidelines")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "#64748b",
              font: "inherit",
            }}
          >
            📋 Environmental Guidelines
          </button>
        </div>
      </section>

      {/* Platform Services */}
      <section
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e2e8f0",
          borderBottom: "1px solid #e2e8f0",
          padding: "80px 20px",
        }}
      >
        <div
          style={{
            maxWidth: "1100px",
            margin: "0 auto",
          }}
        >
          <h3
            style={{
              fontSize: "1.8rem",
              fontWeight: 800,
              textAlign: "center",
              margin: "0 0 50px",
              color: "#0f172a",
            }}
          >
            Platform Features &amp; Services
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              gap: "30px",
            }}
          >
            {/* Businesses */}
            <article
              style={{
                background: "#f8fafc",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                🏭
              </span>

              <h4
                style={{
                  fontSize: "1.2rem",
                  margin: "15px 0 10px",
                  color: "#1e293b",
                  fontWeight: 700,
                }}
              >
                For Businesses
              </h4>

              <p
                style={{
                  color: "#475569",
                  fontSize: "0.95rem",
                  lineHeight: 1.5,
                }}
              >
                Ensure your operations are fully regulated and compliant with
                state environmental guidelines.
              </p>

              <ul
                style={{
                  paddingLeft: "20px",
                  color: "#475569",
                  fontSize: "0.9rem",
                  lineHeight: 1.8,
                }}
              >
                <li>Register regulated facilities</li>
                <li>Apply for environmental permits online</li>
                <li>Track AI-assisted compliance reviews</li>
                <li>View inspection notices and enforcement actions</li>
              </ul>
            </article>

            {/* Citizens */}
            <article
              style={{
                background: "#f8fafc",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                👥
              </span>

              <h4
                style={{
                  fontSize: "1.2rem",
                  margin: "15px 0 10px",
                  color: "#1e293b",
                  fontWeight: 700,
                }}
              >
                For Citizens
              </h4>

              <p
                style={{
                  color: "#475569",
                  fontSize: "0.95rem",
                  lineHeight: 1.5,
                }}
              >
                Report and track environmental issues affecting communities and
                natural habitats.
              </p>

              <ul
                style={{
                  paddingLeft: "20px",
                  color: "#475569",
                  fontSize: "0.9rem",
                  lineHeight: 1.8,
                }}
              >
                <li>Report pollution and illegal waste dumping</li>
                <li>Track investigation and resolution status</li>
                <li>Access environmental advisories and guidelines</li>
                <li>Engage with community environmental programmes</li>
              </ul>
            </article>

            {/* Officers */}
            <article
              style={{
                background: "#f8fafc",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                👮
              </span>

              <h4
                style={{
                  fontSize: "1.2rem",
                  margin: "15px 0 10px",
                  color: "#1e293b",
                  fontWeight: 700,
                }}
              >
                For Environmental Officers
              </h4>

              <p
                style={{
                  color: "#475569",
                  fontSize: "0.95rem",
                  lineHeight: 1.5,
                }}
              >
                Use AI-assisted tools to accelerate review, inspection and
                regulatory compliance activities.
              </p>

              <ul
                style={{
                  paddingLeft: "20px",
                  color: "#475569",
                  fontSize: "0.9rem",
                  lineHeight: 1.8,
                }}
              >
                <li>AI-assisted registration and risk reviews</li>
                <li>Durable workflows and complete audit trails</li>
                <li>Digital field inspection scheduling</li>
                <li>Environmental compliance analytics</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section
        style={{
          padding: "80px 20px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            maxWidth: "1000px",
            margin: "0 auto",
          }}
        >
          <h3
            style={{
              fontSize: "1.8rem",
              fontWeight: 800,
              color: "#0f172a",
              margin: "0 0 50px",
            }}
          >
            EcoGov AI Platform Statistics
          </h3>

          {loading && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                gap: "30px",
              }}
            >
              {[1, 2, 3, 4].map((i) => (
                <div key={i} style={{ opacity: 0.6 }}>
                  <div
                    style={{
                      height: "50px",
                      background: "#e2e8f0",
                      borderRadius: "8px",
                      width: "120px",
                      margin: "0 auto 10px",
                    }}
                  />
                  <div
                    style={{
                      height: "20px",
                      background: "#cbd5e1",
                      borderRadius: "4px",
                      width: "160px",
                      margin: "0 auto",
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{ padding: "20px", color: "#e11d48", fontWeight: "600" }}>
              <p style={{ margin: "0 0 10px" }}>Live platform statistics are temporarily unavailable.</p>
              <button
                onClick={retry}
                style={{
                  padding: "8px 18px",
                  background: "#16a34a",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "600",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                🔄 Retry Loading
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                gap: "30px",
              }}
            >
              {[
                [data.registeredFacilities, data.registeredFacilities === 1 ? "Registered Facility" : "Registered Facilities"],
                [data.inspectionsCompleted, data.inspectionsCompleted === 1 ? "Inspection Completed" : "Inspections Completed"],
                [data.citizenReports, data.citizenReports === 1 ? "Citizen Report" : "Citizen Reports"],
                [`${data.complianceRate}%`, "Compliance Rate"],
              ].map(([value, label]) => (
                <div key={label}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "3.2rem",
                      fontWeight: 900,
                      color: "#16a34a",
                      lineHeight: 1.1,
                    }}
                  >
                    {typeof value === "number" ? new Intl.NumberFormat("en-NG").format(value) : value}
                  </span>

                  <span
                    style={{
                      fontSize: "0.95rem",
                      color: "#64748b",
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: "#0f172a",
          color: "#94a3b8",
          padding: "60px 20px 40px",
          marginTop: "auto",
          borderTop: "1px solid #334155",
        }}
      >
        <div
          style={{
            maxWidth: "1100px",
            margin: "0 auto 40px",
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
            gap: "40px",
          }}
        >
          <div>
            <h5
              style={{
                color: "#ffffff",
                fontSize: "1rem",
                margin: "0 0 15px",
                fontWeight: 700,
              }}
            >
              Anambra Ministry of Environment
            </h5>

            <p
              style={{
                fontSize: "0.85rem",
                lineHeight: 1.6,
              }}
            >
              Headquarters:
              <br />
              Anambra State Ministry of Environment,
              <br />
              Jerome Udoji Secretariat Complex,
              <br />
              Awka, Anambra State, Nigeria.
            </p>
          </div>

          <div>
            <h5
              style={{
                color: "#ffffff",
                fontSize: "1rem",
                margin: "0 0 15px",
                fontWeight: 700,
              }}
            >
              Contact Support
            </h5>

            <p
              style={{
                fontSize: "0.85rem",
                lineHeight: 1.6,
              }}
            >
              Phone: +234 (0) 806 471 2936
              <br />
              Email: ezebo001@gmail.com
            </p>
          </div>

          <div>
            <h5
              style={{
                color: "#ffffff",
                fontSize: "1rem",
                margin: "0 0 15px",
                fontWeight: 700,
              }}
            >
              Legal &amp; Policy
            </h5>

            <p
              style={{
                fontSize: "0.85rem",
                lineHeight: 1.8,
              }}
            >
              <span style={{ cursor: "pointer", display: "block" }}>
                Privacy Policy
              </span>

              <span style={{ cursor: "pointer", display: "block" }}>
                Terms of Service
              </span>

              <span style={{ cursor: "pointer", display: "block" }}>
                Environmental Law Registry
              </span>
            </p>
          </div>
        </div>

        <div
          style={{
            maxWidth: "1100px",
            margin: "0 auto",
            borderTop: "1px solid #334155",
            paddingTop: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.8rem",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <span>
            &copy; {new Date().getFullYear()} Anambra State Government. All
            rights reserved.
          </span>

          <span>
            Powered by <strong>EcoGov AI</strong>
          </span>
        </div>
      </footer>

      {/* Login Modal */}
      {isLoginModalOpen && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsLoginModalOpen(false);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-modal-title"
            style={{
              background: "#1e293b",
              color: "#f8fafc",
              padding: "40px",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "420px",
              border: "1px solid #334155",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.5)",
              position: "relative",
              boxSizing: "border-box",
            }}
          >
            <button
              type="button"
              aria-label="Close login modal"
              onClick={() => setIsLoginModalOpen(false)}
              style={{
                position: "absolute",
                top: "15px",
                right: "15px",
                background: "none",
                border: "none",
                color: "#94a3b8",
                fontSize: "1.5rem",
                cursor: "pointer",
              }}
            >
              &times;
            </button>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginBottom: "25px",
              }}
            >
              {/* Ministry logo remains in login modal */}
              <img
                src="/minEnv.jpg"
                alt="Anambra State Ministry of Environment Logo"
                style={{
                  width: "70px",
                  height: "70px",
                  objectFit: "contain",
                  borderRadius: "50%",
                  background: "#ffffff",
                  marginBottom: "12px",
                  border: "2px solid #334155",
                }}
              />

              <h3
                id="login-modal-title"
                style={{
                  textAlign: "center",
                  margin: "0 0 5px",
                  fontSize: "1.6rem",
                  color: "#10b981",
                  fontWeight: 700,
                }}
              >
                EcoGov AI Login
              </h3>

              <p
                style={{
                  textAlign: "center",
                  color: "#94a3b8",
                  margin: 0,
                  fontSize: "0.85rem",
                }}
              >
                Anambra Environmental Regulation Portal
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                style={{
                  padding: "10px 15px",
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid #ef4444",
                  borderRadius: "6px",
                  color: "#fca5a5",
                  fontSize: "0.9rem",
                  marginBottom: "20px",
                }}
              >
                {authError}
              </div>
            )}

            <form
              onSubmit={onLogin}
              style={{
                display: "grid",
                gap: "15px",
              }}
            >
              <div>
                <label
                  htmlFor="login-email"
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                  }}
                >
                  Email Address
                </label>

                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
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
                  htmlFor="login-password"
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                  }}
                >
                  Password
                </label>

                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
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

              <button
                type="submit"
                style={{
                  padding: "12px",
                  background: "#10b981",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 700,
                  cursor: "pointer",
                  marginTop: "10px",
                }}
              >
                Sign In
              </button>
            </form>

            {/* Quick Access Stubs */}
            <div
              style={{
                marginTop: "25px",
                borderTop: "1px solid #334155",
                paddingTop: "15px",
              }}
            >
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: "0.8rem",
                  color: "#64748b",
                  textAlign: "center",
                }}
              >
                Quick Access Stubs
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "8px",
                }}
              >
                {(
                  [
                    ["owner", "Owner"],
                    ["inspector", "Inspector"],
                    ["director", "Director"],
                  ] as const
                ).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => quickLogin(type)}
                    style={{
                      padding: "8px",
                      background: "#334155",
                      border: "none",
                      borderRadius: "4px",
                      color: "#f1f5f9",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
