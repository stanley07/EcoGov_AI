import { SubcontractorApplicationStatus } from "@govos/domain";

export function validateApplicationTransition(
  current: SubcontractorApplicationStatus,
  target: SubcontractorApplicationStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<SubcontractorApplicationStatus, SubcontractorApplicationStatus[]> = {
    draft: ["submitted", "withdrawn"],
    submitted: ["screening_queued", "withdrawn"],
    screening_queued: ["screening_in_progress", "withdrawn"],
    screening_in_progress: ["awaiting_officer_review", "screening_failed", "withdrawn"],
    screening_failed: ["screening_queued", "withdrawn"],
    awaiting_officer_review: ["approved", "rejected", "more_information_required", "withdrawn"],
    more_information_required: ["submitted", "withdrawn"],
    approved: ["invoice_pending"],
    invoice_pending: ["payment_pending"],
    payment_pending: ["payment_confirmed", "expired"],
    payment_confirmed: ["licence_issued"],
    licence_issued: ["expired"],
    withdrawn: ["draft"],
    rejected: [],
    expired: []
  };
  return (allowed[current] || []).includes(target);
}

export type InvoiceStatus = "unpaid" | "pending" | "paid" | "void" | "expired" | "refunded" | "partially_refunded";

export function validateInvoiceTransition(
  current: InvoiceStatus,
  target: InvoiceStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
    unpaid: ["pending", "void"],
    pending: ["paid", "expired", "void"],
    paid: ["refunded", "partially_refunded"],
    void: [],
    expired: [],
    refunded: [],
    partially_refunded: []
  };
  return (allowed[current] || []).includes(target);
}

export type PaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refunded" | "partially_refunded" | "reversed";

export function validatePaymentTransition(
  current: PaymentStatus,
  target: PaymentStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<PaymentStatus, PaymentStatus[]> = {
    created: ["pending", "succeeded", "failed", "cancelled"],
    pending: ["succeeded", "failed", "cancelled"],
    succeeded: ["refunded", "partially_refunded", "reversed"],
    failed: [],
    cancelled: [],
    refunded: [],
    partially_refunded: [],
    reversed: []
  };
  return (allowed[current] || []).includes(target);
}

export type ProfileStatus = "active" | "under_review" | "restricted" | "suspended" | "revoked" | "archived";

export function validateProfileTransition(
  current: ProfileStatus,
  target: ProfileStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<ProfileStatus, ProfileStatus[]> = {
    active: ["under_review", "restricted", "suspended", "revoked", "archived"],
    under_review: ["active", "suspended", "restricted"],
    restricted: ["active", "suspended"],
    suspended: ["active", "revoked"],
    revoked: [],
    archived: []
  };
  return (allowed[current] || []).includes(target);
}

export type LicenceStatus = "pending" | "active" | "expired" | "suspended" | "revoked" | "cancelled";

export function validateLicenceTransition(
  current: LicenceStatus,
  target: LicenceStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<LicenceStatus, LicenceStatus[]> = {
    pending: ["active", "cancelled"],
    active: ["expired", "suspended", "revoked"],
    suspended: ["active", "revoked"],
    expired: [],
    revoked: [],
    cancelled: []
  };
  return (allowed[current] || []).includes(target);
}

export type AssignmentStatus = "active" | "terminated";

export function validateAssignmentTransition(
  current: AssignmentStatus,
  target: AssignmentStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<AssignmentStatus, AssignmentStatus[]> = {
    active: ["terminated"],
    terminated: []
  };
  return (allowed[current] || []).includes(target);
}

export type AuditStatus = "draft" | "completed" | "disputed" | "confirmed" | "overturned";

export function validateAuditTransition(
  current: AuditStatus,
  target: AuditStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<AuditStatus, AuditStatus[]> = {
    draft: ["completed"],
    completed: ["disputed"],
    disputed: ["confirmed", "overturned"],
    confirmed: [],
    overturned: []
  };
  return (allowed[current] || []).includes(target);
}

export type EnforcementStatus = "proposed" | "active" | "stayed" | "overturned" | "resolved" | "expired";

export function validateEnforcementTransition(
  current: EnforcementStatus,
  target: EnforcementStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<EnforcementStatus, EnforcementStatus[]> = {
    proposed: ["active", "stayed", "overturned"],
    active: ["stayed", "resolved", "expired"],
    stayed: ["active", "overturned"],
    overturned: [],
    resolved: [],
    expired: []
  };
  return (allowed[current] || []).includes(target);
}

export type AppealStatus = "pending" | "approved" | "rejected";

export function validateAppealTransition(
  current: AppealStatus,
  target: AppealStatus
): boolean {
  if (current === target) return true;
  const allowed: Record<AppealStatus, AppealStatus[]> = {
    pending: ["approved", "rejected"],
    approved: [],
    rejected: []
  };
  return (allowed[current] || []).includes(target);
}

export interface PricingResult {
  amountMicroUnits: number;
  currency: string;
  description: string;
}

export class MarketplacePricingPolicy {
  public static calculateFee(_licenseType: string): PricingResult {
    // Pilot annual licence fee. Values are always sourced server-side.
    return {
      amountMicroUnits: 500000000,
      currency: "NGN",
      description: "Annual Environmental Licence"
    };
  }
}
