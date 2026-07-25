import { FacilityRegistrationPayload, FacilityRegistrationResponse } from "../types/facility.js";

const API_BASE_URL = "http://localhost:8080";

export async function registerFacility(
  payload: FacilityRegistrationPayload,
  token: string,
): Promise<FacilityRegistrationResponse> {
  const res = await fetch(`${API_BASE_URL}/facilities/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || "Failed to register facility");
  }

  return res.json();
}
