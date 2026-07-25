export interface PlatformStatistics {
  registeredFacilities: number;
  inspectionsCompleted: number;
  citizenReports: number;
  complianceRate: number;
  generatedAt: string;
}

export async function fetchPlatformStatistics(signal?: AbortSignal): Promise<PlatformStatistics> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
  const res = await fetch(`${apiBaseUrl}/public/platform-statistics`, {
    method: "GET",
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || "Failed to fetch platform statistics");
  }

  const data = await res.json();

  // Safe runtime validation of response fields
  if (
    typeof data.registeredFacilities !== "number" ||
    typeof data.inspectionsCompleted !== "number" ||
    typeof data.citizenReports !== "number" ||
    typeof data.complianceRate !== "number" ||
    typeof data.generatedAt !== "string"
  ) {
    throw new Error("Invalid API response format");
  }

  return data as PlatformStatistics;
}
