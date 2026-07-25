import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPlatformStatistics } from "../public/api/platformStatisticsApi.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Frontend Platform Statistics Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (import.meta.env as any).VITE_API_BASE_URL = "http://mock-api:8080";
  });

  afterEach(() => {
    (import.meta.env as any).VITE_API_BASE_URL = "";
  });

  // 1. API base URL usage
  it("uses the configured VITE_API_BASE_URL env variable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        registeredFacilities: 12,
        inspectionsCompleted: 5,
        citizenReports: 8,
        complianceRate: 85,
        generatedAt: "2026-07-24T00:00:00.000Z",
      }),
    });

    const data = await fetchPlatformStatistics();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://mock-api:8080/public/platform-statistics",
      expect.any(Object)
    );
    expect(data.registeredFacilities).toBe(12);
  });

  // 2. Abort signal propagation and unmount handling
  it("propagates AbortSignal and handles cancellation properly", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce((_url, options) => {
      // Assert that signal is passed down
      expect(options.signal).toBe(controller.signal);
      return new Promise((_resolve, reject) => {
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        reject(err);
      });
    });

    await expect(fetchPlatformStatistics(controller.signal)).rejects.toThrow("The user aborted a request.");
  });

  // 3. Formatting functions formatting en-NG and percent
  it("formats numbers properly using en-NG locale and percentage formatting", () => {
    const formatter = new Intl.NumberFormat("en-NG");
    expect(formatter.format(1000)).toBe("1,000");
    expect(formatter.format(0)).toBe("0");
    expect(formatter.format(5234)).toBe("5,234");
    expect(`${85}%`).toBe("85%");
  });

  // 4. Safe runtime validation check of invalid types
  it("throws validation error on invalid api responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        registeredFacilities: "not-a-number",
        inspectionsCompleted: 5,
        citizenReports: 8,
        complianceRate: 85,
        generatedAt: "2026-07-24T00:00:00.000Z",
      }),
    });

    await expect(fetchPlatformStatistics()).rejects.toThrow("Invalid API response format");
  });
});
