import { useState } from "react";
import { registerFacility } from "../api/facilitiesApi.js";
import { FacilityRegistrationPayload, FacilityRegistrationResponse } from "../types/facility.js";

export function useFacilityRegistration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<FacilityRegistrationResponse | null>(null);

  const register = async (payload: FacilityRegistrationPayload, token: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await registerFacility(payload, token);
      setResponse(res);
      return res;
    } catch (err: any) {
      setError(err.message || "An unknown error occurred during registration");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { register, loading, error, response };
}
