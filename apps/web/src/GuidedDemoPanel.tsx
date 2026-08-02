import React, { useState, useEffect } from "react";

interface GuidedDemoPanelProps {
  token: string | null;
  onNavigateTab: (tab: "dashboard" | "registry" | "wizard" | "queue" | "settings" | "platform" | "subcontractor-apply" | "subcontractor-status") => void;
  onSetSelectedFacilityId: (facilityId: string | null) => void;
  onRefreshData: () => void;
}

export function GuidedDemoPanel({
  token,
  onNavigateTab,
  onSetSelectedFacilityId,
  onRefreshData,
}: GuidedDemoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showEvidence, setShowEvidence] = useState(true);
  
  // Demo states persisted in sessionStorage to survive page reloads
  const [step, setStep] = useState<number>(() => {
    return Number(sessionStorage.getItem("demo_step")) || 1;
  });
  const [appId, setAppId] = useState<string>(() => {
    return sessionStorage.getItem("demo_app_id") || "";
  });
  const [accessToken, setAccessToken] = useState<string>(() => {
    return sessionStorage.getItem("demo_access_token") || "";
  });
  const [licenceCode, setLicenceCode] = useState<string>(() => {
    return sessionStorage.getItem("demo_licence_code") || "";
  });
  const [subcontractorId, setSubcontractorId] = useState<string>(() => {
    return sessionStorage.getItem("demo_subcontractor_id") || "";
  });
  const [facilityId, setFacilityId] = useState<string>(() => {
    return sessionStorage.getItem("demo_facility_id") || "";
  });
  const [registrationId, setRegistrationId] = useState<string>(() => {
    return sessionStorage.getItem("demo_registration_id") || "";
  });
  const [aiAuditResult, setAiAuditResult] = useState<string>(() => {
    return sessionStorage.getItem("demo_ai_audit_result") || "";
  });
  const [officerApproved, setOfficerApproved] = useState<boolean>(() => {
    return sessionStorage.getItem("demo_officer_approved") === "true";
  });
  const [aiDetails, setAiDetails] = useState<any>(() => {
    const saved = sessionStorage.getItem("demo_ai_details");
    return saved ? JSON.parse(saved) : null;
  });

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Sync state changes to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("demo_step", step.toString());
    sessionStorage.setItem("demo_app_id", appId);
    sessionStorage.setItem("demo_access_token", accessToken);
    sessionStorage.setItem("demo_licence_code", licenceCode);
    sessionStorage.setItem("demo_subcontractor_id", subcontractorId);
    sessionStorage.setItem("demo_facility_id", facilityId);
    sessionStorage.setItem("demo_registration_id", registrationId);
    sessionStorage.setItem("demo_ai_audit_result", aiAuditResult);
    sessionStorage.setItem("demo_officer_approved", officerApproved ? "true" : "false");
    sessionStorage.setItem("demo_ai_details", aiDetails ? JSON.stringify(aiDetails) : "");
  }, [step, appId, accessToken, licenceCode, subcontractorId, facilityId, registrationId, aiAuditResult, officerApproved, aiDetails]);

  // Poll sessionStorage to pick up wizard form submits in real-time
  useEffect(() => {
    const timer = setInterval(() => {
      const savedStep = Number(sessionStorage.getItem("demo_step")) || 1;
      const savedFacId = sessionStorage.getItem("demo_facility_id") || "";
      const savedRegId = sessionStorage.getItem("demo_registration_id") || "";
      if (savedStep !== step) setStep(savedStep);
      if (savedFacId !== facilityId) setFacilityId(savedFacId);
      if (savedRegId !== registrationId) setRegistrationId(savedRegId);
    }, 500);
    return () => clearInterval(timer);
  }, [step, facilityId, registrationId]);

  const resetDemo = () => {
    if (window.confirm("Are you sure you want to reset the guided demo journey?")) {
      setStep(1);
      setAppId("");
      setAccessToken("");
      setLicenceCode("");
      setSubcontractorId("");
      setFacilityId("");
      setRegistrationId("");
      setAiAuditResult("");
      setOfficerApproved(false);
      setAiDetails(null);
      setMsg("Demo journey reset successfully.");
      setErr(null);
      onNavigateTab("dashboard");
    }
  };

  const showSuccess = (text: string) => {
    setMsg(text);
    setErr(null);
    setTimeout(() => setMsg(null), 6000);
  };

  const showError = (text: string) => {
    setErr(text);
    setMsg(null);
  };

  // STEP 1: Submit Application
  const handleAutoSubmitApplication = async () => {
    setLoading(true);
    setErr(null);
    try {
      const rand = Math.floor(Math.random() * 9000) + 1000;
      const payload = {
        tenantId: "c8c95022-fdfb-4029-9e8a-81a1d13f9c6d", // Standard demo tenant
        businessName: `Anambra Waste Solutions Ltd (${rand})`,
        registrationNumber: `RC-${rand}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        taxIdentifier: `TAX-${rand}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        contactEmail: `contact@solutions${rand}.com`,
        contactPhone: `+234 803 111 ${rand}`,
        operatingAddress: `${rand} Zik Avenue, Awka`,
        experienceYears: 6,
        licenseType: "waste_management"
      };

      const res = await fetch("http://localhost:8080/marketplace/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to create application");
      }

      const data = await res.json();
      setAppId(data.applicationId);
      setAccessToken(data.accessToken);
      sessionStorage.setItem("subcontractor_token", data.accessToken);

      // Auto-upload a required document
      const docPayload = {
        accessToken: data.accessToken,
        documentType: "corporate_registration",
        filename: "cac_certificate.pdf",
        mimeType: "application/pdf",
        sizeBytes: 102450,
        contentHash: "sha256-demo-hash-12345"
      };
      
      const docRes = await fetch(`http://localhost:8080/marketplace/applications/${data.applicationId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docPayload)
      });
      if (!docRes.ok) throw new Error("Document declaration failed");

      // Submit application
      const submitRes = await fetch(`http://localhost:8080/marketplace/applications/${data.applicationId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: data.accessToken, expectedVersion: 2 })
      });
      if (!submitRes.ok) throw new Error("Application submission transition failed");

      showSuccess("Draft filled, CAC certificate uploaded, and application submitted!");
      setStep(2);
    } catch (err: any) {
      showError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: AI Screening check
  const handleCheckAIScreen = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`http://localhost:8080/marketplace/applications/${appId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken })
      });
      if (!res.ok) throw new Error("Failed to fetch application status");
      const data = await res.json();
      
      const doc = data.documents[0];
      if (doc && doc.scanStatus === "passed" && doc.verificationStatus === "verified") {
        showSuccess("Document scanner has completed clean integrity verification!");
        setStep(3);
      } else {
        showSuccess("Application queried. Document scanner is reviewing the files.");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 3: Approve application as Officer
  const handleApproveAsOfficer = async () => {
    if (!token) {
      showError("Please log in as an Officer (e.g. director@govos.ai) first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`http://localhost:8080/marketplace/applications/${appId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          expectedVersion: 3,
          decisionReason: "Verified compliance history and credentials verified by AI Screening audit.",
          screeningResultId: "scr-12345"
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Approval request failed");
      }
      showSuccess("Subcontractor application approved! Invoice generated successfully.");
      setStep(4);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 4: Pay Invoice
  const handlePayInvoice = async () => {
    setLoading(true);
    setErr(null);
    try {
      // 1. Trigger Stripe checkout session
      const checkRes = await fetch(`http://localhost:8080/marketplace/applications/${appId}/checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, expectedVersion: 4 })
      });
      if (!checkRes.ok) {
        const body = await checkRes.json();
        throw new Error(body.error || "Checkout session failed");
      }
      const checkData = await checkRes.json();
      const checkoutSessionId = checkData.checkoutSessionId;

      // 2. Call the demo complete route we added to complete Stripe payment webhook
      const webhookRes = await fetch("http://localhost:8080/marketplace/payments/demo-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutSessionId })
      });
      if (!webhookRes.ok) {
        const body = await webhookRes.json();
        throw new Error(body.error || "Stripe webhook simulation failed");
      }
      showSuccess("Stripe webhook simulation completed! Monorepo ledger updated.");
      setStep(5);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 5: Retrieve Licence
  const handleRetrieveLicence = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`http://localhost:8080/marketplace/applications/${appId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken })
      });
      if (!res.ok) throw new Error("Failed to fetch licence status");
      const data = await res.json();
      if (data.licenceCode) {
        setLicenceCode(data.licenceCode);
        setSubcontractorId(data.subcontractorId);
        showSuccess(`Active Licence generated! Code: ${data.licenceCode}`);
        setStep(6);
      } else {
        throw new Error(`State: ${data.status}. License not generated yet.`);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 6: Assign LGAs
  const handleAssignLGAs = async () => {
    if (!token) {
      showError("Please log in as an Officer first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      // 1. Fetch LGAs
      const regionsRes = await fetch("http://localhost:8080/marketplace/regions", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!regionsRes.ok) throw new Error("Failed to load regions");
      const regions = await regionsRes.json();
      const firstLga = regions.lgas[0];
      if (!firstLga) throw new Error("No LGAs available for this tenant");

      // 2. Assign LGA
      const res = await fetch("http://localhost:8080/marketplace/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          subcontractorId,
          assignmentType: "lga",
          targetId: firstLga.id,
          startsAt: new Date().toISOString()
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "LGA territory assignment failed");
      }
      showSuccess(`Territory LGA '${firstLga.name}' successfully assigned to Subcontractor!`);
      setStep(7);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 7: Auto-register Facility
  const handleAutoRegisterFacility = async () => {
    setLoading(true);
    setErr(null);
    try {
      const rand = Math.floor(Math.random() * 900) + 100;
      const payload = {
        organizationId: "7d938b8c-529a-4122-bd54-52d6a599ad39",
        businessName: `Anambra Car Wash Hub (${rand})`,
        category: "car_wash",
        address: `${rand} Enugu-Onitsha Expressway, Awka`,
        latitude: 6.2045,
        longitude: 6.8923,
        description: "Standard environmental compliance car washing and recycling center",
        town: "Awka",
        lga: "Awka South",
        contactPerson: "Engr. Nnamdi",
        contactEmail: `nnamdi@wash${rand}.com`,
        contactPhone: `+234 803 777 ${rand}`,
        permitNumber: `ASMOE-CW-${rand}`,
        registrationNotes: "Registered via guided developer dashboard",
        clientSubmissionId: `sub-${Math.random().toString(36).substring(2)}-${Date.now()}`
      };

      const res = await fetch("http://localhost:8080/facilities/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Facility registration failed");
      }
      const data = await res.json();
      setFacilityId(data.facilityId);
      setRegistrationId(data.registrationId);
      showSuccess(`Facility registered and queued! ID: ${data.facilityId.substring(0, 8)}`);
      setStep(8);
      onRefreshData();
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 9: Inspect AI review
  const handleInspectAIReview = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`http://localhost:8080/workbench/registrations/${facilityId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch workflow details");
      const data = await res.json();
      
      const aiReviews = data.aiReviews || [];
      if (aiReviews.length > 0) {
        const item = aiReviews[0];
        const response = JSON.parse(item.responsePayload);
        setAiAuditResult(response.preliminaryRiskRating.toUpperCase());
        setAiDetails({
          id: item.id,
          agentName: item.agentName,
          modelProvider: item.modelProvider || "deterministic",
          modelName: item.modelName || "deterministic-simulator",
          executionStatus: item.executionStatus || "completed",
          riskRating: response.preliminaryRiskRating || "low",
          confidence: response.confidence || "high",
          recommendation: response.classifiedCategory || "car_wash",
          timestamp: item.createdAt || new Date().toISOString()
        });
        showSuccess(`AI Auditor analysis ready! riskRating: ${response.preliminaryRiskRating.toUpperCase()}`);
        setStep(10);
      } else {
        showSuccess("AI screen triggered. Analyzing coordinates, permit databases, and LGA clusters...");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // STEP 10: Officer decision
  const handleOfficerApproveFacility = async () => {
    if (!token) {
      showError("Please log in as an Officer first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`http://localhost:8080/facilities/${registrationId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          decision: "approve",
          notes: "Approved after verifying clean AI screening recommendations and valid permit reference matches.",
          version: 1,
          officialRiskRating: "low"
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Facility approval decision failed");
      }
      setOfficerApproved(true);
      showSuccess("Facility registration APPROVED! Status updated in registry.");
      setStep(11);
      onRefreshData();
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // CSS Styles
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: isOpen ? 0 : "-400px",
    width: "380px",
    height: "100%",
    background: "rgba(15, 23, 42, 0.95)",
    backdropFilter: "blur(16px)",
    borderLeft: "1px solid #1e293b",
    boxShadow: "-10px 0 30px rgba(0, 0, 0, 0.5)",
    transition: "right 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
    color: "#f8fafc",
    fontFamily: "sans-serif"
  };

  const toggleBtnStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    padding: "12px 24px",
    background: "#0ea5e9",
    color: "white",
    border: "none",
    borderRadius: "30px",
    boxShadow: "0 4px 14px rgba(14, 165, 233, 0.4)",
    fontWeight: "bold",
    cursor: "pointer",
    zIndex: 1999,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "transform 0.2s"
  };

  const stepsContainerStyle: React.CSSProperties = {
    flexGrow: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  };

  const stepCardStyle = (isActive: boolean, isCompleted: boolean) => ({
    background: isActive ? "rgba(14, 165, 233, 0.1)" : "#0f172a",
    border: `1px solid ${isActive ? "#0ea5e9" : isCompleted ? "#0f766e" : "#1e293b"}`,
    borderRadius: "8px",
    padding: "12px",
    opacity: isCompleted ? 0.75 : 1,
    transition: "all 0.2s"
  });

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={toggleBtnStyle}
        onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        🧭 Guided Demo Journey
      </button>

      <div style={panelStyle}>
        <div style={{ padding: "20px", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#38bdf8" }}>🧭 Journey Walkthrough</h3>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>End-to-End Investor Presentation</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.5rem", cursor: "pointer" }}
          >
            &times;
          </button>
        </div>

        {msg && (
          <div style={{ background: "rgba(16, 185, 129, 0.15)", color: "#a7f3d0", padding: "10px 20px", fontSize: "0.85rem", borderBottom: "1px solid #10b981" }}>
            ✅ {msg}
          </div>
        )}
        {err && (
          <div style={{ background: "rgba(239, 68, 68, 0.15)", color: "#fca5a5", padding: "10px 20px", fontSize: "0.85rem", borderBottom: "1px solid #ef4444" }}>
            ⚠️ {err}
          </div>
        )}

        <div style={stepsContainerStyle}>
          {/* STEP 1 */}
          <div style={stepCardStyle(step === 1, step > 1)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 1 ? "#38bdf8" : "#94a3b8" }}>1. Subcontractor Apply</strong>
              <span style={{ fontSize: "0.75rem", color: step > 1 ? "#34d399" : "#64748b" }}>{step > 1 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Applicant enters corporate details & uploads compliance files.
            </p>
            {step === 1 && (
              <button onClick={handleAutoSubmitApplication} disabled={loading} style={actionBtnStyle}>
                {loading ? "Submitting..." : "⚡ Auto-Submit Application"}
              </button>
            )}
          </div>

          {/* STEP 2 */}
          <div style={stepCardStyle(step === 2, step > 2)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 2 ? "#38bdf8" : "#94a3b8" }}>2. Document Scan Verification</strong>
              <span style={{ fontSize: "0.75rem", color: step > 2 ? "#34d399" : "#64748b" }}>{step > 2 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Document scanner scans file integrity. Verification is a precondition for AI screening.
            </p>
            {step === 2 && (
              <button onClick={handleCheckAIScreen} disabled={loading} style={actionBtnStyle}>
                🔍 Run File Integrity Scan
              </button>
            )}
          </div>

          {/* STEP 3 */}
          <div style={stepCardStyle(step === 3, step > 3)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 3 ? "#38bdf8" : "#94a3b8" }}>3. Officer Review & Approval</strong>
              <span style={{ fontSize: "0.75rem", color: step > 3 ? "#34d399" : "#64748b" }}>{step > 3 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Officer approves application based on AI screening result.
            </p>
            {step === 3 && (
              <button onClick={handleApproveAsOfficer} disabled={loading} style={actionBtnStyle}>
                👔 Approve as Officer
              </button>
            )}
          </div>

          {/* STEP 4 */}
          <div style={stepCardStyle(step === 4, step > 4)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 4 ? "#38bdf8" : "#94a3b8" }}>4. Invoice & Payment</strong>
              <span style={{ fontSize: "0.75rem", color: step > 4 ? "#34d399" : "#64748b" }}>{step > 4 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Simulated payment processed through the production webhook reconciliation architecture.
            </p>
            {step === 4 && (
              <button onClick={handlePayInvoice} disabled={loading} style={actionBtnStyle}>
                💳 Pay Application Fee ($500)
              </button>
            )}
          </div>

          {/* STEP 5 */}
          <div style={stepCardStyle(step === 5, step > 5)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 5 ? "#38bdf8" : "#94a3b8" }}>5. Licence Generation</strong>
              <span style={{ fontSize: "0.75rem", color: step > 5 ? "#34d399" : "#64748b" }}>{step > 5 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Retrieve verifiable licence token from the secure ledger.
            </p>
            {step === 5 && (
              <button onClick={handleRetrieveLicence} disabled={loading} style={actionBtnStyle}>
                📜 Retrieve Licence Code
              </button>
            )}
          </div>

          {/* STEP 6 */}
          <div style={stepCardStyle(step === 6, step > 6)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 6 ? "#38bdf8" : "#94a3b8" }}>6. Territory Assignment</strong>
              <span style={{ fontSize: "0.75rem", color: step > 6 ? "#34d399" : "#64748b" }}>{step > 6 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Officer delegates regional enforcement over Anambra LGA.
            </p>
            {step === 6 && (
              <button onClick={handleAssignLGAs} disabled={loading} style={actionBtnStyle}>
                🗺️ Assign Anambra LGAs
              </button>
            )}
          </div>

          {/* STEP 7 */}
          <div style={stepCardStyle(step === 7, step > 7)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 7 ? "#38bdf8" : "#94a3b8" }}>7. Subcontractor Registration</strong>
              <span style={{ fontSize: "0.75rem", color: step > 7 ? "#34d399" : "#64748b" }}>{step > 7 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Licensed subcontractor registers facility under assigned LGA.
            </p>
            {step === 7 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button
                  onClick={() => { onNavigateTab("wizard"); setIsOpen(false); }}
                  style={{ ...actionBtnStyle, background: "#475569" }}
                >
                  ➕ Open actual OE-1B wizard
                </button>
                <button onClick={handleAutoRegisterFacility} disabled={loading} style={actionBtnStyle}>
                  ⚡ Auto-Register Facility (Bypass)
                </button>
              </div>
            )}
          </div>

          {/* STEP 8 */}
          <div style={stepCardStyle(step === 8, step > 8)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 8 ? "#38bdf8" : "#94a3b8" }}>8. Facility Registry & Drawer</strong>
              <span style={{ fontSize: "0.75rem", color: step > 8 ? "#34d399" : "#64748b" }}>{step > 8 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Open registry list and show the sliding detail drawer.
            </p>
            {step === 8 && (
              <button
                onClick={() => { onNavigateTab("registry"); onSetSelectedFacilityId(facilityId); setIsOpen(false); setStep(9); }}
                style={actionBtnStyle}
              >
                👁️ Open Registry Detail
              </button>
            )}
          </div>

          {/* STEP 9 */}
          <div style={stepCardStyle(step === 9, step > 9)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 9 ? "#38bdf8" : "#94a3b8" }}>9. AI-assisted Review</strong>
              <span style={{ fontSize: "0.75rem", color: step > 9 ? "#34d399" : "#64748b" }}>{step > 9 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              AI Auditor reviews geographical constraints and risk.
            </p>
            {step === 9 && (
              <button onClick={handleInspectAIReview} disabled={loading} style={actionBtnStyle}>
                🤖 Inspect AI Recommendations
              </button>
            )}
          </div>

          {/* STEP 10 */}
          <div style={stepCardStyle(step === 10, step > 10)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 10 ? "#38bdf8" : "#94a3b8" }}>10. Officer Action</strong>
              <span style={{ fontSize: "0.75rem", color: step > 10 ? "#34d399" : "#64748b" }}>{step > 10 ? "✓ DONE" : "PENDING"}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Officer approves facility, updating state in database registry.
            </p>
            {step === 10 && (
              <button onClick={handleOfficerApproveFacility} disabled={loading} style={actionBtnStyle}>
                ⚖️ Officer Approve Facility
              </button>
            )}
          </div>

          {/* STEP 11 */}
          <div style={stepCardStyle(step === 11, false)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.9rem", color: step === 11 ? "#38bdf8" : "#94a3b8" }}>11. Compliance Analytics</strong>
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>READY</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
              Verify new subcontractor onboarded, license issued, revenue collected, and facility acquired.
            </p>
            {step === 11 && (
              <button onClick={() => { onNavigateTab("dashboard"); setIsOpen(false); }} style={actionBtnStyle}>
                📊 View Analytics Dashboard
              </button>
            )}
          </div>
        </div>

        {/* Live Demo Evidence Panel */}
        <div style={{ padding: "10px 20px", background: "#0f172a", borderTop: "1px solid #1e293b" }}>
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            style={{
              width: "100%",
              background: "none",
              border: "none",
              color: "#38bdf8",
              fontSize: "0.8rem",
              fontWeight: "bold",
              cursor: "pointer",
              textAlign: "left",
              padding: "4px 0",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <span>{showEvidence ? "▼" : "▶"} Live Transaction Evidence</span>
            <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Technical Audit Trail</span>
          </button>

          {showEvidence && (
            <div style={{ maxHeight: "180px", overflowY: "auto", background: "#090d16", borderRadius: "6px", padding: "8px", marginTop: "6px", fontFamily: "monospace", fontSize: "0.7rem", color: "#34d399", border: "1px solid #1e293b" }}>
              <div>• App ID: {appId ? `"${appId.substring(0, 16)}..."` : "not_created"}</div>
              <div>• Scan Integrity: {step > 2 ? "PASSED" : "PENDING"}</div>
              <div>• Officer Approval: {step > 3 ? "RECORDED" : "PENDING"}</div>
              <div>• Ledger Status: {step > 4 ? "RECONCILED" : "UNPAID"}</div>
              <div>• Licence Code: {licenceCode ? `"${licenceCode}"` : "PENDING"}</div>
              <div>• Territory Assigned: {step > 6 ? "Awka South" : "PENDING"}</div>
              <div>• Facility ID: {facilityId ? `"${facilityId.substring(0, 16)}..."` : "PENDING"}</div>
              <div>• AI Facility Risk: {aiAuditResult ? `"${aiAuditResult}"` : "PENDING"}</div>
              <div>• Officer Decision: {officerApproved ? "APPROVED" : "PENDING"}</div>
              {aiDetails && (
                <div style={{ marginTop: "6px", borderTop: "1px dashed #334155", paddingTop: "6px", color: "#60a5fa" }}>
                  <div style={{ fontWeight: "bold", marginBottom: "2px" }}>🤖 Governed AI Execution:</div>
                  <div>• AI Exec ID: {aiDetails.id ? `"${aiDetails.id.substring(0, 8)}..."` : "not_created"}</div>
                  <div>• Agent: {aiDetails.agentName}</div>
                  <div>• Provider: {aiDetails.modelProvider}</div>
                  <div>• Model: {aiDetails.modelName}</div>
                  <div>• Exec Status: {aiDetails.executionStatus}</div>
                  <div>• Risk Rating: {aiDetails.riskRating}</div>
                  <div>• Confidence: {aiDetails.confidence}</div>
                  <div>• Recommendation: {aiDetails.recommendation}</div>
                  <div>• Timestamp: {new Date(aiDetails.timestamp).toLocaleTimeString()}</div>
                </div>
              )}
              <div style={{ color: "#94a3b8", marginTop: "4px" }}>Active session: c8c95022-fdfb-4029-9e8a-81a1d13f9c6d</div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: "20px", borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between", gap: "10px" }}>
          <button onClick={resetDemo} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid #f87171", color: "#f87171", borderRadius: "6px", fontSize: "0.85rem", fontWeight: "bold", cursor: "pointer" }}>
            Reset Journey
          </button>
          <button onClick={() => setIsOpen(false)} style={{ flex: 1, padding: "10px", background: "#475569", border: "none", color: "white", borderRadius: "6px", fontSize: "0.85rem", fontWeight: "bold", cursor: "pointer" }}>
            Close Panel
          </button>
        </div>
      </div>
    </>
  );
}

const actionBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#0ea5e9",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  fontSize: "0.8rem",
  cursor: "pointer",
  transition: "background 0.2s"
};
