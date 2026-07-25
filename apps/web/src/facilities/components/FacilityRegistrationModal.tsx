import React, { useEffect, useRef, useState } from "react";
import { FacilityRegistrationForm } from "./FacilityRegistrationForm.js";
import { useFacilityRegistration } from "../hooks/useFacilityRegistration.js";

interface FacilityRegistrationModalProps {
  onClose: () => void;
  onSuccess: () => void;
  organizations: Array<{ id: string; name: string }>;
  token: string;
  triggerButtonRef: React.RefObject<HTMLButtonElement | null>;
}

export function FacilityRegistrationModal({
  onClose,
  onSuccess,
  organizations,
  token,
  triggerButtonRef,
}: FacilityRegistrationModalProps) {
  const { register, loading, error } = useFacilityRegistration();
  const [successInfo, setSuccessInfo] = useState<{ referenceNumber: string } | null>(null);
  
  // Create a unique clientSubmissionId on mount to handle request idempotency on retry
  const clientSubmissionIdRef = useRef(`sub-${Math.random().toString(36).substring(2)}-${Date.now()}`);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap and Escape listener
  useEffect(() => {
    // Save current active element
    const activeElementBeforeModal = document.activeElement;

    // Focus close button initially
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to triggering button
      if (triggerButtonRef && triggerButtonRef.current) {
        triggerButtonRef.current.focus();
      } else if (activeElementBeforeModal instanceof HTMLElement) {
        activeElementBeforeModal.focus();
      }
    };
  }, [onClose, triggerButtonRef]);

  const handleSubmit = async (formData: any) => {
    try {
      const payload = {
        ...formData,
        clientSubmissionId: clientSubmissionIdRef.current,
      };
      const res = await register(payload, token);
      setSuccessInfo({ referenceNumber: res.referenceNumber });
      onSuccess();
    } catch (err) {
      // Handled by hook
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(15, 23, 42, 0.8)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: "12px",
          width: "90%",
          maxWidth: "600px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)",
          color: "#f8fafc",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 id="modal-title" style={{ margin: 0, fontSize: "1.5rem" }}>
            🏢 Register New Facility
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: "1.5rem",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            &times;
          </button>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", color: "#ef4444", padding: "12px", borderRadius: "6px", marginBottom: "16px", fontSize: "0.9rem" }}>
            ⚠️ {error}
          </div>
        )}

        {successInfo ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🎉</div>
            <h3 style={{ margin: "0 0 8px" }}>Registration Submitted!</h3>
            <p style={{ color: "#94a3b8", marginBottom: "20px" }}>
              The facility has been successfully registered on the ASMOE Portal.
            </p>
            <div style={{ background: "#1e293b", padding: "12px", borderRadius: "6px", fontFamily: "monospace", fontSize: "1.1rem", border: "1px solid #475569", display: "inline-block" }}>
              Reference: {successInfo.referenceNumber}
            </div>
            <div style={{ marginTop: "24px" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "10px 24px",
                  background: "#0ea5e9",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <FacilityRegistrationForm
            organizations={organizations}
            onSubmit={handleSubmit}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
