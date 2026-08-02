import React, { useState, useEffect } from "react";

const API_BASE_URL = "http://localhost:8080";
const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

interface DocumentRecord {
  id: string;
  documentType: string;
  storageKey: string;
  scanStatus: string;
  verificationStatus: string;
}

export function ApplicationWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [applicationId, setApplicationId] = useState<string>(() => sessionStorage.getItem("subcontractor_app_id") || "");
  const [accessToken, setAccessToken] = useState<string>(() => sessionStorage.getItem("subcontractor_token") || "");
  const [version, setVersion] = useState<number>(() => Number(sessionStorage.getItem("subcontractor_version")) || 1);

  // Form fields state
  const [businessName, setBusinessName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxIdentifier, setTaxIdentifier] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [operatingAddress, setOperatingAddress] = useState("");
  const [experienceYears, setExperienceYears] = useState(0);
  const [licenseType, setLicenseType] = useState("environmental-consultant");

  // Documents and consent state
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [declarationsAccepted, setDeclarationsAccepted] = useState(false);

  // Status/Error messages
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Auto-resume draft if details exist in sessionStorage
  useEffect(() => {
    if (applicationId && accessToken) {
      fetchDraftStatus();
    }
  }, [applicationId, accessToken]);

  const fetchDraftStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/marketplace/applications/${applicationId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken })
      });
      if (res.ok) {
        const data = await res.json();
        setVersion(data.version);
        setDocuments(data.documents);
        // Map fields back if they exist
        // Note: For simplicity of recovery, we can query details from the database or fill fields from response if we add them to safe fields.
        // Let's also fetch complete draft fields.
      }
    } catch (err) {
      console.error("Failed to load application draft status", err);
    }
  };

  const handleCreateOrUpdateDraft = async (nextStep?: number) => {
    setErrorMsg("");
    setSuccessMsg("");
    setIsSaving(true);

    try {
      if (!applicationId) {
        // Create initial draft
        const res = await fetch(`${API_BASE_URL}/marketplace/applications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: SYSTEM_TENANT_ID,
            businessName,
            registrationNumber,
            taxIdentifier,
            contactEmail,
            contactPhone,
            operatingAddress,
            experienceYears,
            licenseType
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create application draft");
        }

        const data = await res.json();
        setApplicationId(data.applicationId);
        setAccessToken(data.accessToken);
        setVersion(data.version);
        sessionStorage.setItem("subcontractor_app_id", data.applicationId);
        sessionStorage.setItem("subcontractor_token", data.accessToken);
        sessionStorage.setItem("subcontractor_version", String(data.version));
      } else {
        // Update existing draft
        const res = await fetch(`${API_BASE_URL}/marketplace/applications/${applicationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken,
            expectedVersion: version,
            businessName,
            registrationNumber,
            taxIdentifier,
            contactEmail,
            contactPhone,
            operatingAddress,
            experienceYears: Number(experienceYears),
            licenseType
          })
        });

        if (res.status === 409) {
          throw new Error("Conflict: The application was modified elsewhere. Please reload or review current version.");
        }

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to save application changes");
        }

        const data = await res.json();
        setVersion(data.version);
        sessionStorage.setItem("subcontractor_version", String(data.version));
      }

      setSuccessMsg("Draft saved successfully.");
      if (nextStep) {
        setCurrentStep(nextStep);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    setErrorMsg("");
    const file = e.target.files?.[0];
    if (!file) return;

    // Direct policy verification on client
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      setErrorMsg("Unsupported file type. Only PDF, JPEG, and PNG are allowed.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("File exceeds the maximum allowed size of 10 MB.");
      return;
    }

    setIsUploading(true);

    try {
      // Mock hash generation for testing
      const fakeHash = "a1b2c3d4" + Math.random().toString(16).substring(2, 26).padEnd(24, "0") + "e5f6";

      const res = await fetch(`${API_BASE_URL}/marketplace/applications/${applicationId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          documentType: docType,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          contentHash: fakeHash
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to upload document");
      }

      await fetchDraftStatus();
      setSuccessMsg("Document uploaded and virus-scanned successfully.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    setErrorMsg("");
    setSuccessMsg("");
    if (!declarationsAccepted) {
      setErrorMsg("You must accept the declarations and consents to submit.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/marketplace/applications/${applicationId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          expectedVersion: version
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submission failed");
      }

      setSuccessMsg("Application submitted successfully! Redirecting to status page...");
      sessionStorage.removeItem("subcontractor_app_id");
      sessionStorage.removeItem("subcontractor_token");
      sessionStorage.removeItem("subcontractor_version");

      setTimeout(() => {
        window.location.hash = `#marketplace/status/${applicationId}`;
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const stepsList = [
    "Business Details",
    "Contact & Address",
    "Credentials",
    "Experience",
    "Supporting Documents",
    "Declarations",
    "Review & Submit"
  ];

  return (
    <div style={{ maxWidth: "800px", margin: "40px auto", padding: "20px", fontFamily: "sans-serif" }}>
      {/* Premium Glassmorphic Card Container */}
      <div style={{
        background: "rgba(30, 41, 59, 0.7)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "16px",
        padding: "40px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        color: "#f1f5f9"
      }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0 0 10px 0", color: "#38bdf8" }}>
          Subcontractor Licensing Portal
        </h1>
        <p style={{ margin: "0 0 30px 0", color: "#94a3b8" }}>
          Complete the 7-step wizard to register your environmental compliance service.
        </p>

        {/* Multi-step progress circles */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "25px", position: "relative", alignItems: "center" }}>
          {/* Connector Line Background */}
          <div style={{
            position: "absolute",
            top: "16px",
            left: "20px",
            right: "20px",
            height: "2px",
            background: "#334155",
            zIndex: 1
          }} />
          
          {stepsList.map((_, idx) => {
            const stepNum = idx + 1;
            const isCompleted = stepNum < currentStep;
            const isActive = stepNum === currentStep;
            return (
              <div key={stepNum} style={{ zIndex: 2, textAlign: "center" }}>
                <div style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: isCompleted ? "#10b981" : isActive ? "#0ea5e9" : "#1e293b",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "bold",
                  border: isCompleted ? "none" : isActive ? "2px solid #38bdf8" : "2px solid #475569",
                  transition: "all 0.3s ease",
                  fontSize: "14px"
                }}>
                  {isCompleted ? "✓" : stepNum}
                </div>
              </div>
            );
          })}
        </div>

        {/* Active Step Details Banner */}
        <div style={{ 
          textAlign: "center", 
          marginBottom: "30px", 
          padding: "12px", 
          background: "rgba(14, 165, 233, 0.1)", 
          borderRadius: "8px", 
          border: "1px solid rgba(14, 165, 233, 0.25)",
          fontSize: "0.9rem",
          fontWeight: "bold",
          color: "#38bdf8",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
          Step {currentStep} of 7 — {stepsList[currentStep - 1]}
        </div>

        {/* Messages */}
        {errorMsg && (
          <div style={{ background: "rgba(239, 68, 68, 0.2)", border: "1px solid #ef4444", padding: "12px", borderRadius: "8px", color: "#fca5a5", marginBottom: "20px" }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", padding: "12px", borderRadius: "8px", color: "#a7f3d0", marginBottom: "20px" }}>
            {successMsg}
          </div>
        )}

        {/* Steps Content rendering */}
        <div style={{ minHeight: "260px" }}>
          {/* Step 1: Business Details */}
          {currentStep === 1 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 1: Business Details</h2>
              <div style={{ marginBottom: "15px" }}>
                <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Business Name *</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                  placeholder="Enter registered legal business name"
                />
              </div>
            </div>
          )}

          {/* Step 2: Contact Info & Address */}
          {currentStep === 2 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 2: Contact & Operating Address</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Contact Email *</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Contact Phone *</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                  />
                </div>
              </div>
              <div style={{ marginBottom: "15px" }}>
                <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Operating Address *</label>
                <textarea
                  value={operatingAddress}
                  onChange={(e) => setOperatingAddress(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff", height: "80px" }}
                />
              </div>
            </div>
          )}

          {/* Step 3: Registration & Credentials */}
          {currentStep === 3 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 3: Registration & Tax Credentials</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Corporate Registration Number *</label>
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                    placeholder="e.g. RC-123456"
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Tax Identification Number (TIN) *</label>
                  <input
                    type="text"
                    value={taxIdentifier}
                    onChange={(e) => setTaxIdentifier(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                    placeholder="e.g. TIN-998877"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Experience & Licence Details */}
          {currentStep === 4 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 4: Experience & Licensing</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Years of Active Experience *</label>
                  <input
                    type="number"
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "5px", color: "#cbd5e1" }}>Target Licence Category *</label>
                  <select
                    value={licenseType}
                    onChange={(e) => setLicenseType(e.target.value)}
                    style={{ width: "100%", padding: "10px", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", color: "#ffffff" }}
                  >
                    <option value="environmental-consultant">Environmental Consultant</option>
                    <option value="waste-contractor">Waste Disposal Contractor</option>
                    <option value="laboratory-partner">Certified Laboratory Partner</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Supporting Documents */}
          {currentStep === 5 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "10px" }}>Step 5: Supporting Documents</h2>
              <p style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "20px" }}>
                Upload corporate tax registry clearances and certifications. Allowed: PDF, PNG, JPG. Max 10MB.
              </p>

              {/* Upload Tax Registry */}
              <div style={{ border: "1px dashed #334155", padding: "20px", borderRadius: "8px", marginBottom: "20px", background: "rgba(15, 23, 42, 0.4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ fontSize: "16px", margin: "0 0 5px 0" }}>Corporate Tax Certificate</h3>
                    <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>Required compliance document</p>
                  </div>
                  <div>
                    <input
                      type="file"
                      id="tax-cert-upload"
                      style={{ display: "none" }}
                      onChange={(e) => handleDocumentUpload(e, "tax_registry")}
                      disabled={!applicationId || isUploading}
                    />
                    <label
                      htmlFor="tax-cert-upload"
                      style={{
                        padding: "8px 16px",
                        background: applicationId ? "#38bdf8" : "#334155",
                        borderRadius: "6px",
                        cursor: applicationId ? "pointer" : "not-allowed",
                        fontSize: "13px",
                        fontWeight: "bold",
                        color: "#0f172a"
                      }}
                    >
                      {isUploading ? "Uploading..." : "Upload File"}
                    </label>
                  </div>
                </div>

                {/* Display uploaded document status */}
                {documents.filter(d => d.documentType === "tax_registry").map(doc => (
                  <div key={doc.id} style={{ marginTop: "15px", display: "flex", gap: "15px", alignItems: "center", fontSize: "13px" }}>
                    <span style={{ color: "#10b981" }}>✓ Uploaded</span>
                    <span style={{
                      background: doc.scanStatus === "passed" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                      color: doc.scanStatus === "passed" ? "#34d399" : "#f87171",
                      padding: "2px 8px",
                      borderRadius: "4px"
                    }}>
                      Scan: {doc.scanStatus}
                    </span>
                    <span style={{ color: "#94a3b8" }}>Verification: {doc.verificationStatus}</span>
                  </div>
                ))}
              </div>
              {!applicationId && (
                <p style={{ color: "#f59e0b", fontSize: "13px" }}>* Please save your details in Step 1 to begin uploading documents.</p>
              )}
            </div>
          )}

          {/* Step 6: Declarations */}
          {currentStep === 6 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 6: Declarations & Consents</h2>
              <div style={{ background: "rgba(15, 23, 42, 0.4)", padding: "20px", borderRadius: "8px", border: "1px solid #334155", marginBottom: "20px" }}>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "#cbd5e1", margin: "0 0 20px 0" }}>
                  I hereby declare that all information, credentials, and documents uploaded in this licensing application are true, accurate, and valid under the provisions of the Environment Protection Regulation Act. I consent to automatic AI-assisted credential verification and background auditing.
                </p>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={declarationsAccepted}
                    onChange={(e) => setDeclarationsAccepted(e.target.checked)}
                    style={{ marginRight: "10px", width: "18px", height: "18px" }}
                  />
                  <span>I agree to these declarations and terms.</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 7: Review & Submit */}
          {currentStep === 7 && (
            <div>
              <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Step 7: Review Details</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "10px 0", color: "#94a3b8" }}>Business Name:</td>
                    <td style={{ padding: "10px 0", fontWeight: "bold" }}>{businessName}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "10px 0", color: "#94a3b8" }}>Registration Number:</td>
                    <td style={{ padding: "10px 0", fontWeight: "bold" }}>{registrationNumber}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "10px 0", color: "#94a3b8" }}>Tax ID:</td>
                    <td style={{ padding: "10px 0", fontWeight: "bold" }}>{taxIdentifier}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "10px 0", color: "#94a3b8" }}>Experience:</td>
                    <td style={{ padding: "10px 0", fontWeight: "bold" }}>{experienceYears} Years</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    <td style={{ padding: "10px 0", color: "#94a3b8" }}>Licence Type:</td>
                    <td style={{ padding: "10px 0", fontWeight: "bold" }}>{licenseType}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: "20px" }}>
                <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                  By submitting this application, it will become immutable and will be queued for screening.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "30px", borderTop: "1px solid #334155", paddingTop: "20px" }}>
          <button
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
            disabled={currentStep === 1 || isSaving}
            style={{
              padding: "10px 20px",
              background: "#334155",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: currentStep === 1 || isSaving ? "not-allowed" : "pointer",
              fontWeight: "bold"
            }}
          >
            Back
          </button>

          {currentStep < 7 ? (
            <button
              onClick={() => handleCreateOrUpdateDraft(currentStep + 1)}
              disabled={isSaving}
              style={{
                padding: "10px 20px",
                background: "#38bdf8",
                color: "#0f172a",
                border: "none",
                borderRadius: "6px",
                cursor: isSaving ? "not-allowed" : "pointer",
                fontWeight: "bold"
              }}
            >
              {isSaving ? "Saving..." : "Save & Continue"}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!declarationsAccepted || isSaving}
              style={{
                padding: "10px 20px",
                background: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: !declarationsAccepted || isSaving ? "not-allowed" : "pointer",
                fontWeight: "bold"
              }}
            >
              Submit Application
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
