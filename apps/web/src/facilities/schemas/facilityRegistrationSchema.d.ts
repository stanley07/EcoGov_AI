import { FacilityRegistrationPayload } from "../types/facility.js";
export interface FormErrors {
    businessName?: string;
    category?: string;
    address?: string;
    town?: string;
    lga?: string;
    contactPerson?: string;
    contactInfo?: string;
    contactEmail?: string;
    contactPhone?: string;
    latitude?: string;
    longitude?: string;
}
export declare function validateRegistrationForm(data: Partial<FacilityRegistrationPayload>): FormErrors;
//# sourceMappingURL=facilityRegistrationSchema.d.ts.map