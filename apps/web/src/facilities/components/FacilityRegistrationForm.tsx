import React, { useState } from "react";
import { FacilityRegistrationPayload } from "../types/facility.js";
import { validateRegistrationForm, FormErrors } from "../schemas/facilityRegistrationSchema.js";

interface FacilityRegistrationFormProps {
  organizations: Array<{ id: string; name: string }>;
  onSubmit: (data: Omit<FacilityRegistrationPayload, "clientSubmissionId">) => void;
  loading: boolean;
}

export function FacilityRegistrationForm({
  organizations,
  onSubmit,
  loading,
}: FacilityRegistrationFormProps) {
  const [formData, setFormData] = useState({
    organizationId: organizations[0]?.id || "",
    businessName: "",
    category: "car_wash",
    address: "",
    latitude: 6.1524, // Anambra central approximations
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

  const [errors, setErrors] = useState<FormErrors>({});

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "latitude" || name === "longitude" ? parseFloat(value) || 0 : value,
    }));
    // Clear error inline
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateRegistrationForm(formData);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    onSubmit(formData);
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

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Organization */}
      <div>
        <label htmlFor="organizationId" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
          Target Office / Department *
        </label>
        <select
          id="organizationId"
          name="organizationId"
          value={formData.organizationId}
          onChange={handleChange}
          style={selectStyle}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Business Name */}
        <div>
          <label htmlFor="businessName" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Business Name *
          </label>
          <input
            id="businessName"
            type="text"
            name="businessName"
            value={formData.businessName}
            onChange={handleChange}
            placeholder="e.g. Onitsha Refining Hub"
            style={errors.businessName ? inputErrorStyle : inputStyle}
          />
          {errors.businessName && <span style={errorTextStyle}>{errors.businessName}</span>}
        </div>

        {/* Category */}
        <div>
          <label htmlFor="category" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Facility Category *
          </label>
          <select
            id="category"
            name="category"
            value={formData.category}
            onChange={handleChange}
            style={selectStyle}
          >
            {categories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
          Business Activity Description
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Describe the nature of operations, environmental impacts..."
          style={textareaStyle}
          rows={3}
        />
      </div>

      {/* Address */}
      <div>
        <label htmlFor="address" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
          Street Address *
        </label>
        <input
          id="address"
          type="text"
          name="address"
          value={formData.address}
          onChange={handleChange}
          placeholder="e.g. 15 Enugu-Onitsha Expressway"
          style={errors.address ? inputErrorStyle : inputStyle}
        />
        {errors.address && <span style={errorTextStyle}>{errors.address}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Town */}
        <div>
          <label htmlFor="town" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Town / City *
          </label>
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

        {/* LGA */}
        <div>
          <label htmlFor="lga" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Local Government Area (LGA) *
          </label>
          <select
            id="lga"
            name="lga"
            value={formData.lga}
            onChange={handleChange}
            style={errors.lga ? inputErrorStyle : selectStyle}
          >
            <option value="">-- Select LGA --</option>
            {lgas.map((lgaName) => (
              <option key={lgaName} value={lgaName}>
                {lgaName}
              </option>
            ))}
          </select>
          {errors.lga && <span style={errorTextStyle}>{errors.lga}</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Latitude */}
        <div>
          <label htmlFor="latitude" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Latitude *
          </label>
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

        {/* Longitude */}
        <div>
          <label htmlFor="longitude" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Longitude *
          </label>
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

      {/* Contact Person */}
      <div>
        <label htmlFor="contactPerson" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
          Contact Person *
        </label>
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
        <div style={{ color: "#ef4444", fontSize: "0.85rem", padding: "8px", background: "#fef2f2", borderRadius: "4px" }}>
          {errors.contactInfo}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Contact Email */}
        <div>
          <label htmlFor="contactEmail" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Contact Email
          </label>
          <input
            id="contactEmail"
            type="email"
            name="contactEmail"
            value={formData.contactEmail}
            onChange={handleChange}
            placeholder="e.g. emeka@domain.com"
            style={errors.contactEmail ? inputErrorStyle : inputStyle}
          />
          {errors.contactEmail && <span style={errorTextStyle}>{errors.contactEmail}</span>}
        </div>

        {/* Contact Phone */}
        <div>
          <label htmlFor="contactPhone" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Contact Phone
          </label>
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
        {/* Permit Number */}
        <div>
          <label htmlFor="permitNumber" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Permit Reference (Optional)
          </label>
          <input
            id="permitNumber"
            type="text"
            name="permitNumber"
            value={formData.permitNumber}
            onChange={handleChange}
            placeholder="e.g. ASMOE-WMP-2026-8902"
            style={inputStyle}
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="registrationNotes" style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.9rem" }}>
            Internal Notes / Remarks
          </label>
          <input
            id="registrationNotes"
            type="text"
            name="registrationNotes"
            value={formData.registrationNotes}
            onChange={handleChange}
            placeholder="e.g. Assisting walk-in applicant"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 24px",
            background: "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "background 0.2s",
          }}
        >
          {loading ? "Submitting..." : "Submit Registration"}
        </button>
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: "6px",
  color: "#f8fafc",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#ef4444",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: "6px",
  color: "#f8fafc",
  fontSize: "0.95rem",
  boxSizing: "border-box",
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
  boxSizing: "border-box",
};

const errorTextStyle: React.CSSProperties = {
  color: "#ef4444",
  fontSize: "0.8rem",
  marginTop: "4px",
  display: "block",
};
