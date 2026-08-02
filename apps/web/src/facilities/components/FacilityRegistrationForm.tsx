import React, { useState, useEffect } from "react";
import { registerFacility } from "../api/facilitiesApi.js";
import { FacilityRegistrationPayload } from "../types/facility.js";
import { validateRegistrationForm, FormErrors } from "../schemas/facilityRegistrationSchema.js";

interface FacilityRegistrationFormProps {
  organizations: Array<{ id: string; name: string }>;
  token: string;
  isOfficer: boolean;
  onSuccess: (referenceNumber: string) => void;
  onCancel: () => void;
  onViewFacility?: (facilityId: string) => void;
}

export function FacilityRegistrationForm({
  organizations,
  token,
  isOfficer,
  onSuccess,
  onCancel,
  onViewFacility,
}: FacilityRegistrationFormProps) {
  // Step state: 1 (Basic), 2 (Location), 3 (Contact), 4 (Review)
  const [step, setStep] = useState<number>(1);
  
  // Form values state
  const [formData, setFormData] = useState({
    organizationId: organizations[0]?.id || "",
    businessName: "",
    category: "car_wash",
    address: "",
    latitude: 6.1524, // Anambra approximation
    longitude: 6.7862,
    description: "",
    town: "",
    lga: "",
    contactPerson: "",
    contactEmail: "",
    contactPhone: "",
    permitNumber: "",
    registrationNotes: "",
  });

  // Unique client submission key for idempotency
  const [clientSubmissionId, setClientSubmissionId] = useState<string>("");
  
  // Last payload string to check for changes on retry
  const [lastAttemptedPayload, setLastAttemptedPayload] = useState<string>("");

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});
  
  // API loading / error states
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Duplicate conflict state
  const [duplicateConflict, setDuplicateConflict] = useState<{
    existingFacilityId: string;
    confidence: string;
  } | null>(null);

  // Officer override justification
  const [overrideReason, setOverrideReason] = useState<string>("");

  // 1. Load draft or generate submission ID on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem("govos_facility_draft");
    const savedSubmissionId = localStorage.getItem("govos_facility_submission_id");
    
    if (savedDraft) {
      try {
        setFormData(JSON.parse(savedDraft));
      } catch (e) {
        console.error("Failed to parse saved draft");
      }
    }
    
    if (savedSubmissionId) {
      setClientSubmissionId(savedSubmissionId);
    } else {
      const newId = `sub-${Math.random().toString(36).substring(2)}-${Date.now()}`;
      setClientSubmissionId(newId);
      localStorage.setItem("govos_facility_submission_id", newId);
    }
  }, []);

  // 2. Save draft to localStorage on change, and check if payload modified
  const updateField = (name: string, value: any) => {
    const nextFormData = { ...formData, [name]: value };
    setFormData(nextFormData);
    localStorage.setItem("govos_facility_draft", JSON.stringify(nextFormData));

    // Clear inline validation error
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }

    // Idempotency: if we had a prior attempt and user modifies payload, rotate submission key
    if (lastAttemptedPayload) {
      const currentString = JSON.stringify(nextFormData);
      if (currentString !== lastAttemptedPayload) {
        const newId = `sub-${Math.random().toString(36).substring(2)}-${Date.now()}`;
        setClientSubmissionId(newId);
        localStorage.setItem("govos_facility_submission_id", newId);
        setLastAttemptedPayload("");
        setDuplicateConflict(null);
        setApiError(null);
      }
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    const parsedValue = name === "latitude" || name === "longitude" ? parseFloat(value) || 0 : value;
    updateField(name, parsedValue);
  };

  // 3. Clear draft files
  const clearDraft = () => {
    localStorage.removeItem("govos_facility_draft");
    localStorage.removeItem("govos_facility_submission_id");
  };

  const triggerAutofill = () => {
    const rand = Math.floor(Math.random() * 900) + 100;
    const nextFormData = {
      organizationId: organizations[0]?.id || "",
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
    };
    setFormData(nextFormData);
    localStorage.setItem("govos_facility_draft", JSON.stringify(nextFormData));
    setStep(4);
  };

  // 4. Validate current step before proceeding
  const validateStep = (currentStep: number): boolean => {
    const allErrors = validateRegistrationForm(formData);
    const stepErrors: FormErrors = {};

    if (currentStep === 1) {
      if (allErrors.businessName) stepErrors.businessName = allErrors.businessName;
      if (allErrors.category) stepErrors.category = allErrors.category;
    } else if (currentStep === 2) {
      if (allErrors.address) stepErrors.address = allErrors.address;
      if (allErrors.town) stepErrors.town = allErrors.town;
      if (allErrors.lga) stepErrors.lga = allErrors.lga;
      if (allErrors.latitude) stepErrors.latitude = allErrors.latitude;
      if (allErrors.longitude) stepErrors.longitude = allErrors.longitude;
    } else if (currentStep === 3) {
      if (allErrors.contactPerson) stepErrors.contactPerson = allErrors.contactPerson;
      if (allErrors.contactInfo) stepErrors.contactInfo = allErrors.contactInfo;
      if (allErrors.contactEmail) stepErrors.contactEmail = allErrors.contactEmail;
      if (allErrors.contactPhone) stepErrors.contactPhone = allErrors.contactPhone;
    }

    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    setStep((prev) => prev - 1);
  };

  // 5. Final Submit
  const executeRegistration = async (useOverride: boolean = false) => {
    setLoading(true);
    setApiError(null);

    const payload: FacilityRegistrationPayload = {
      ...formData,
      clientSubmissionId,
      ...(useOverride ? { overrideReason } : {}),
    };

    try {
      // Capture payload snapshot to detect modification on retry
      setLastAttemptedPayload(JSON.stringify(formData));

      const res = await registerFacility(payload, token);
      clearDraft();
      sessionStorage.setItem("demo_facility_id", res.facilityId);
      sessionStorage.setItem("demo_registration_id", res.registrationId);
      sessionStorage.setItem("demo_step", "8");
      onSuccess(res.referenceNumber);
    } catch (err: any) {
      if (err.status === 409 && err.existingFacilityId) {
        // Business Duplicate match found
        setDuplicateConflict({
          existingFacilityId: err.existingFacilityId,
          confidence: err.confidence || "high",
        });
      } else {
        setApiError(err.message || "Failed to submit facility registration");
      }
    } finally {
      setLoading(false);
    }
  };


  const handleCancelConflict = () => {
    setDuplicateConflict(null);
    setOverrideReason("");
    setStep(1);
  };

  const categories = [
    { value: "car_wash", label: "Car Wash" },
    { value: "manufacturing", label: "Manufacturing" },
    { value: "waste_management", label: "Waste Management" },
    { value: "hospitality", label: "Hospitality" },
    { value: "fuel_station", label: "Fuel Station" },
    { value: "chemical_processing", label: "Chemical Processing" },
    { value: "construction", label: "Construction" },
    { value: "healthcare", label: "Healthcare" },
    { value: "agriculture", label: "Agriculture" },
    { value: "other", label: "Other" },
  ];

  const lgas = [
    "Aguata", "Awka North", "Awka South", "Anambra East", "Anambra West",
    "Anaocha", "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North",
    "Idemili South", "Ihiala", "Njikoka", "Nnewi North", "Nnewi South",
    "Ogbaru", "Onitsha North", "Onitsha South", "Orumba North", "Orumba South", "Oyi"
  ];

  // Render Duplicate Conflict alert card
  if (duplicateConflict) {
    return (
      <div style={duplicateContainerStyle}>
        <div style={duplicateHeaderStyle}>
          <span style={{ fontSize: "2rem" }}>⚠️</span>
          <h3 style={{ margin: 0, fontSize: "1.25rem", color: "#fca5a5" }}>
            Potential Duplicate Facility Detected
          </h3>
        </div>
        <p style={{ margin: "10px 0", color: "#cbd5e1", fontSize: "0.95rem", lineHeight: "1.5" }}>
          A facility with matching business name, street address, and Local Government Area already exists in the system.
        </p>

        <div style={duplicateMetaStyle}>
          <div><strong>Existing ID:</strong> <code>{duplicateConflict.existingFacilityId}</code></div>
          <div style={{ marginTop: "4px" }}><strong>Confidence Match:</strong> <span style={{ color: "#ef4444", fontWeight: "bold" }}>{duplicateConflict.confidence.toUpperCase()}</span></div>
        </div>

        <div style={{ display: "flex", gap: "10px", margin: "16px 0" }}>
          {onViewFacility && (
            <button
              onClick={() => onViewFacility(duplicateConflict.existingFacilityId)}
              style={actionBtnStyle}
            >
              👁️ View Existing Facility
            </button>
          )}
          <button
            onClick={handleCancelConflict}
            style={cancelBtnStyle}
          >
            Cancel Registration
          </button>
        </div>

        {isOfficer ? (
          <div style={overrideSectionStyle}>
            <label htmlFor="overrideReason" style={{ display: "block", marginBottom: "8px", fontWeight: "bold", color: "#f8fafc", fontSize: "0.9rem" }}>
              Override Justification (Required - min. 10 characters) *
            </label>
            <textarea
              id="overrideReason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Provide a detailed explanation of why this facility registration is not a duplicate (e.g., separate independent annex office, pre-verified expansion)."
              rows={3}
              style={textareaStyle}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
              <span style={{ fontSize: "0.8rem", color: overrideReason.trim().length >= 10 ? "#34d399" : "#94a3b8" }}>
                Characters: {overrideReason.trim().length} / 10 min
              </span>
              <button
                onClick={() => executeRegistration(true)}
                disabled={loading || overrideReason.trim().length < 10}
                style={{
                  ...submitBtnStyle,
                  opacity: loading || overrideReason.trim().length < 10 ? 0.5 : 1,
                  cursor: loading || overrideReason.trim().length < 10 ? "not-allowed" : "pointer"
                }}
              >
                {loading ? "Submitting Override..." : "Continue With Override"}
              </button>
            </div>
          </div>
        ) : (
          <div style={subcontractorWarningStyle}>
            <p style={{ margin: 0, fontWeight: "bold", color: "#fca5a5" }}>
              🔒 Subcontractor Restrictions Active
            </p>
            <p style={{ margin: "5px 0 0", color: "#cbd5e1", fontSize: "0.85rem", lineHeight: "1.4" }}>
              Subcontractors are not authorized to override potential duplicate matches. Please contact the Anambra State regulatory desk or an officer to review this submission. Your entered draft data remains saved.
            </p>
          </div>
        )}
        
        {apiError && (
          <div style={errorContainerStyle}>
            ⚠️ {apiError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Step {step} of 4</span>
        <button
          type="button"
          onClick={triggerAutofill}
          style={{
            padding: "6px 12px",
            background: "#10b981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "0.8rem",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          ⚡ Autofill Mock Data
        </button>
      </div>
      {/* Wizard Progress Steps Header */}
      <div style={stepsHeaderStyle}>
        {[1, 2, 3, 4].map((s) => (
          <React.Fragment key={s}>
            <button
              onClick={() => s < step && setStep(s)}
              disabled={s >= step}
              style={{
                ...stepCircleStyle,
                background: s === step ? "#0ea5e9" : s < step ? "#0f766e" : "#1e293b",
                borderColor: s === step ? "#38bdf8" : s < step ? "#14b8a6" : "#475569",
                color: s <= step ? "#f8fafc" : "#64748b",
                cursor: s < step ? "pointer" : "default"
              }}
            >
              {s}
            </button>
            {s < 4 && <div style={{ ...stepLineStyle, background: s < step ? "#14b8a6" : "#334155" }} />}
          </React.Fragment>
        ))}
      </div>

      <div style={stepLabelContainerStyle}>
        <span style={{ color: step === 1 ? "#38bdf8" : "#94a3b8" }}>1. Basics</span>
        <span style={{ color: step === 2 ? "#38bdf8" : "#94a3b8" }}>2. Location</span>
        <span style={{ color: step === 3 ? "#38bdf8" : "#94a3b8" }}>3. Contact</span>
        <span style={{ color: step === 4 ? "#38bdf8" : "#94a3b8" }}>4. Review</span>
      </div>

      {apiError && (
        <div style={errorContainerStyle}>
          ⚠️ {apiError}
        </div>
      )}

      {/* STEP 1: Basic Details */}
      {step === 1 && (
        <div style={formGridStyle}>
          <div>
            <label htmlFor="organizationId" style={labelStyle}>Target Office / Department *</label>
            <select
              id="organizationId"
              name="organizationId"
              value={formData.organizationId}
              onChange={handleChange}
              style={selectStyle}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="businessName" style={labelStyle}>Business Name *</label>
            <input
              id="businessName"
              type="text"
              name="businessName"
              value={formData.businessName}
              onChange={handleChange}
              placeholder="e.g. Awka Recycling Center"
              style={errors.businessName ? inputErrorStyle : inputStyle}
            />
            {errors.businessName && <span style={errorTextStyle}>{errors.businessName}</span>}
          </div>

          <div>
            <label htmlFor="category" style={labelStyle}>Facility Category *</label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              style={selectStyle}
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="description" style={labelStyle}>Business Operations Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="nature of activities, generated waste streams..."
              rows={3}
              style={textareaStyle}
            />
          </div>

          <div style={actionRowStyle}>
            <button onClick={onCancel} type="button" style={cancelBtnStyle}>Cancel</button>
            <button onClick={handleNext} type="button" style={nextBtnStyle}>Next step</button>
          </div>
        </div>
      )}

      {/* STEP 2: Geography & Location */}
      {step === 2 && (
        <div style={formGridStyle}>
          <div>
            <label htmlFor="address" style={labelStyle}>Street Address *</label>
            <input
              id="address"
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="e.g. 24 Zik Avenue"
              style={errors.address ? inputErrorStyle : inputStyle}
            />
            {errors.address && <span style={errorTextStyle}>{errors.address}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label htmlFor="town" style={labelStyle}>Town / City *</label>
              <input
                id="town"
                type="text"
                name="town"
                value={formData.town}
                onChange={handleChange}
                placeholder="e.g. Awka"
                style={errors.town ? inputErrorStyle : inputStyle}
              />
              {errors.town && <span style={errorTextStyle}>{errors.town}</span>}
            </div>

            <div>
              <label htmlFor="lga" style={labelStyle}>Local Government Area (LGA) *</label>
              <select
                id="lga"
                name="lga"
                value={formData.lga}
                onChange={handleChange}
                style={errors.lga ? inputErrorStyle : selectStyle}
              >
                <option value="">-- Select LGA --</option>
                {lgas.map((lgaName) => (
                  <option key={lgaName} value={lgaName}>{lgaName}</option>
                ))}
              </select>
              {errors.lga && <span style={errorTextStyle}>{errors.lga}</span>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label htmlFor="latitude" style={labelStyle}>GPS Latitude *</label>
              <input
                id="latitude"
                type="number"
                step="0.000001"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                style={errors.latitude ? inputErrorStyle : inputStyle}
              />
              {errors.latitude && <span style={errorTextStyle}>{errors.latitude}</span>}
            </div>

            <div>
              <label htmlFor="longitude" style={labelStyle}>GPS Longitude *</label>
              <input
                id="longitude"
                type="number"
                step="0.000001"
                name="longitude"
                value={formData.longitude}
                onChange={handleChange}
                style={errors.longitude ? inputErrorStyle : inputStyle}
              />
              {errors.longitude && <span style={errorTextStyle}>{errors.longitude}</span>}
            </div>
          </div>

          <div style={actionRowStyle}>
            <button onClick={handlePrev} type="button" style={prevBtnStyle}>Back</button>
            <button onClick={handleNext} type="button" style={nextBtnStyle}>Next step</button>
          </div>
        </div>
      )}

      {/* STEP 3: Contact & Identifiers */}
      {step === 3 && (
        <div style={formGridStyle}>
          <div>
            <label htmlFor="contactPerson" style={labelStyle}>Contact Person *</label>
            <input
              id="contactPerson"
              type="text"
              name="contactPerson"
              value={formData.contactPerson}
              onChange={handleChange}
              placeholder="e.g. Chief Emeka"
              style={errors.contactPerson ? inputErrorStyle : inputStyle}
            />
            {errors.contactPerson && <span style={errorTextStyle}>{errors.contactPerson}</span>}
          </div>

          {errors.contactInfo && (
            <div style={errorsAlertStyle}>{errors.contactInfo}</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label htmlFor="contactEmail" style={labelStyle}>Contact Email</label>
              <input
                id="contactEmail"
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleChange}
                placeholder="e.g. emeka@refining.com"
                style={errors.contactEmail ? inputErrorStyle : inputStyle}
              />
              {errors.contactEmail && <span style={errorTextStyle}>{errors.contactEmail}</span>}
            </div>

            <div>
              <label htmlFor="contactPhone" style={labelStyle}>Contact Phone</label>
              <input
                id="contactPhone"
                type="text"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleChange}
                placeholder="e.g. +234 803 000 0000"
                style={errors.contactPhone ? inputErrorStyle : inputStyle}
              />
              {errors.contactPhone && <span style={errorTextStyle}>{errors.contactPhone}</span>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label htmlFor="permitNumber" style={labelStyle}>Permit Reference (Optional)</label>
              <input
                id="permitNumber"
                type="text"
                name="permitNumber"
                value={formData.permitNumber}
                onChange={handleChange}
                placeholder="e.g. ASMOE-CAR-2026"
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="registrationNotes" style={labelStyle}>Internal Notes</label>
              <input
                id="registrationNotes"
                type="text"
                name="registrationNotes"
                value={formData.registrationNotes}
                onChange={handleChange}
                placeholder="Remarks, source validation..."
                style={inputStyle}
              />
            </div>
          </div>

          <div style={actionRowStyle}>
            <button onClick={handlePrev} type="button" style={prevBtnStyle}>Back</button>
            <button onClick={handleNext} type="button" style={nextBtnStyle}>Review application</button>
          </div>
        </div>
      )}

      {/* STEP 4: Review Details */}
      {step === 4 && (
        <div style={formGridStyle}>
          <h3 style={{ margin: "0 0 10px", color: "#38bdf8", borderBottom: "1px solid #334155", paddingBottom: "8px" }}>
            Application Summary
          </h3>

          <div style={summaryContainerStyle}>
            <div style={summarySectionStyle}>
              <div style={summaryRowHeaderStyle}>
                <h4 style={{ margin: 0 }}>Basics</h4>
                <button onClick={() => setStep(1)} style={editBtnStyle}>Edit</button>
              </div>
              <div style={summaryItemStyle}><strong>Office/Dept ID:</strong> {formData.organizationId}</div>
              <div style={summaryItemStyle}><strong>Business Name:</strong> {formData.businessName}</div>
              <div style={summaryItemStyle}><strong>Category:</strong> {formData.category.toUpperCase()}</div>
              {formData.description && <div style={summaryItemStyle}><strong>Description:</strong> {formData.description}</div>}
            </div>

            <div style={summarySectionStyle}>
              <div style={summaryRowHeaderStyle}>
                <h4 style={{ margin: 0 }}>Geography</h4>
                <button onClick={() => setStep(2)} style={editBtnStyle}>Edit</button>
              </div>
              <div style={summaryItemStyle}><strong>Address:</strong> {formData.address}</div>
              <div style={summaryItemStyle}><strong>Town/City:</strong> {formData.town}</div>
              <div style={summaryItemStyle}><strong>LGA:</strong> {formData.lga}</div>
              <div style={summaryItemStyle}><strong>GPS Coordinates:</strong> {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}</div>
            </div>

            <div style={summarySectionStyle}>
              <div style={summaryRowHeaderStyle}>
                <h4 style={{ margin: 0 }}>Contact Info</h4>
                <button onClick={() => setStep(3)} style={editBtnStyle}>Edit</button>
              </div>
              <div style={summaryItemStyle}><strong>Contact Person:</strong> {formData.contactPerson}</div>
              {formData.contactEmail && <div style={summaryItemStyle}><strong>Email:</strong> {formData.contactEmail}</div>}
              {formData.contactPhone && <div style={summaryItemStyle}><strong>Phone:</strong> {formData.contactPhone}</div>}
              {formData.permitNumber && <div style={summaryItemStyle}><strong>Permit Reference:</strong> {formData.permitNumber}</div>}
              {formData.registrationNotes && <div style={summaryItemStyle}><strong>Internal Remarks:</strong> {formData.registrationNotes}</div>}
            </div>
          </div>

          <div style={actionRowStyle}>
            <button onClick={handlePrev} type="button" style={prevBtnStyle}>Back</button>
            <button
              onClick={() => executeRegistration(false)}
              disabled={loading}
              style={{
                ...submitBtnStyle,
                background: "#10b981",
                cursor: loading ? "not-allowed" : "pointer"
              }}
            >
              {loading ? "Submitting application..." : "Confirm & Submit Application"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Styling Constants
const stepsHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  margin: "0 auto 10px"
};

const stepCircleStyle: React.CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "50%",
  border: "2px solid",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: "bold",
  fontSize: "0.95rem",
  transition: "all 0.3s"
};

const stepLineStyle: React.CSSProperties = {
  flexGrow: 1,
  height: "3px",
  margin: "0 10px",
  transition: "background 0.3s"
};

const stepLabelContainerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "0.8rem",
  fontWeight: "600",
  marginBottom: "30px",
  padding: "0 4px"
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontWeight: "600",
  fontSize: "0.9rem",
  color: "#cbd5e1"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: "6px",
  color: "#f8fafc",
  fontSize: "0.95rem",
  boxSizing: "border-box"
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#ef4444"
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: "6px",
  color: "#f8fafc",
  fontSize: "0.95rem",
  boxSizing: "border-box"
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: "6px",
  color: "#f8fafc",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  resize: "vertical",
  boxSizing: "border-box"
};

const errorTextStyle: React.CSSProperties = {
  color: "#ef4444",
  fontSize: "0.8rem",
  marginTop: "4px",
  display: "block"
};

const formGridStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px"
};

const errorsAlertStyle: React.CSSProperties = {
  color: "#ef4444",
  fontSize: "0.85rem",
  padding: "8px",
  background: "rgba(239, 68, 68, 0.15)",
  borderRadius: "4px",
  border: "1px solid #ef4444"
};

const errorContainerStyle: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.15)",
  color: "#fca5a5",
  padding: "12px",
  borderRadius: "6px",
  fontSize: "0.9rem",
  border: "1px solid #ef4444",
  marginBottom: "16px"
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  marginTop: "16px",
  borderTop: "1px solid #334155",
  paddingTop: "16px"
};

const nextBtnStyle: React.CSSProperties = {
  padding: "10px 24px",
  background: "#0ea5e9",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

const prevBtnStyle: React.CSSProperties = {
  padding: "10px 24px",
  background: "#475569",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "10px 24px",
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid #475569",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

const submitBtnStyle: React.CSSProperties = {
  padding: "10px 24px",
  background: "#0ea5e9",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

const summaryContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px"
};

const summarySectionStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "8px",
  padding: "16px"
};

const summaryRowHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #334155",
  paddingBottom: "8px",
  marginBottom: "12px"
};

const summaryItemStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "#cbd5e1",
  marginBottom: "6px"
};

const editBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#38bdf8",
  fontSize: "0.8rem",
  fontWeight: "bold",
  cursor: "pointer"
};

// Duplicate Conflict UI Styles
const duplicateContainerStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #ef4444",
  borderRadius: "12px",
  padding: "24px",
  color: "#f8fafc"
};

const duplicateHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  borderBottom: "1px solid #334155",
  paddingBottom: "12px"
};

const duplicateMetaStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "6px",
  padding: "12px 16px",
  fontSize: "0.9rem",
  fontFamily: "monospace",
  color: "#cbd5e1",
  margin: "12px 0"
};

const actionBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#0ea5e9",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontWeight: "bold",
  cursor: "pointer"
};

const overrideSectionStyle: React.CSSProperties = {
  marginTop: "20px",
  borderTop: "1px solid #334155",
  paddingTop: "20px"
};

const subcontractorWarningStyle: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.15)",
  border: "1px solid #ef4444",
  borderRadius: "6px",
  padding: "16px",
  marginTop: "20px"
};
