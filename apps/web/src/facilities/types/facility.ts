export interface FacilityRegistrationPayload {
  organizationId: string;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  description?: string;
  town: string;
  lga: string;
  contactPerson: string;
  contactEmail?: string;
  contactPhone?: string;
  permitNumber?: string;
  registrationNotes?: string;
  clientSubmissionId: string;
}

export interface FacilityRegistrationResponse {
  facilityId: string;
  registrationId: string;
  workflowInstanceId: string;
  referenceNumber: string;
  status: string;
  preliminaryRiskRating: string | null;
}
