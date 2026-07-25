import { useState, useEffect, useCallback } from "react";
import { fetchPlatformStatistics, PlatformStatistics } from "../api/platformStatisticsApi.js";

export function usePlatformStatistics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlatformStatistics | null>(null);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const stats = await fetchPlatformStatistics(signal);
      setData(stats);
    } catch (err: any) {
      if (err.name === "AbortError") {
        return;
      }
      setError(err.message || "Failed to load platform statistics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadStats(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadStats]);

  const retry = useCallback(() => {
    loadStats();
  }, [loadStats]);

  return {
    loading,
    error,
    data,
    retry,
  };
}
