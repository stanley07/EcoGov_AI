export interface EnvironmentalFacility {
  id: string;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  registrationStatus: string;
  riskRating: string;
  createdAt: string;
}

export interface PrototypeRecord {
  id: string;
  facility: string;
  lga: string;
  status: string;
  date: string;
  detail: string;
}
