export const CATEGORY_ALIASES: Record<string, string> = {
  "Car Wash": "car_wash",
  "Hotel": "hospitality",
  "Guest House": "hospitality",
  "Restaurant": "hospitality",
  "Hospital": "healthcare",
  "Clinic": "healthcare",
  "Pharmacy": "healthcare",
};

export const ECOGOV_FACILITIES = [
  "car_wash",
  "manufacturing",
  "waste_management",
  "hospitality",
  "fuel_station",
  "chemical_processing",
  "construction",
  "healthcare",
  "agriculture",
  "other",
  // Accept legacy values at boundaries for backward compatibility
  "Car Wash",
  "Hotel",
  "Guest House",
  "Restaurant",
  "Hospital",
  "Clinic",
  "Pharmacy",
];

export function getEnvironmentalRisk(
  category: string,
): "low" | "medium" | "high" {
  const normCategory = CATEGORY_ALIASES[category] || category;

  switch (normCategory) {
    case "healthcare":
    case "chemical_processing":
    case "waste_management":
      return "high";
    case "car_wash":
    case "manufacturing":
    case "fuel_station":
    case "construction":
      return "medium";
    case "hospitality":
    case "agriculture":
    case "other":
      return "low";
    default:
      return "low";
  }
}

export function isValidFacilityCategory(category: string): boolean {
  return ECOGOV_FACILITIES.includes(category);
}

export function normalizeCategory(category: string): string {
  return CATEGORY_ALIASES[category] || category;
}
