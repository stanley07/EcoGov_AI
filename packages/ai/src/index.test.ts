import { describe, test, expect } from "vitest";
import { Config } from "@govos/configuration";
import { DeterministicModelProvider, GeminiModelProvider } from "./index.js";

describe("AI Provider Checks", () => {
  test("DeterministicModelProvider returns expected fixture mapping for triage", async () => {
    const provider = new DeterministicModelProvider();
    const res = await provider.generateStructured<{ category: string }>({
      objective: "Triage complaint",
      prompt: "Raw details",
      fixtureKey: "complaint_triage",
    });

    expect(res.modelName).toBe("deterministic-simulator");
    expect(res.data.category).toBe("Wastewater Discharge");
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  test("DeterministicModelProvider throws clear error on unknown key", async () => {
    const provider = new DeterministicModelProvider();
    await expect(
      provider.generateStructured({
        objective: "Triage complaint",
        prompt: "Raw details",
        fixtureKey: "unknown_key_here",
      }),
    ).rejects.toThrow("Unknown deterministic fixture key requested");
  });

  test("GeminiModelProvider throws error on call if API key config is missing", async () => {
    const mockConfig: Config = {
      appEnv: "local",
      database: { DATABASE_URL: "postgres://localhost:5432" },
      observability: { LOG_LEVEL: "info" },
      ai: {
        AI_PROVIDER: "gemini-api",
        GEMINI_MODEL_ID: "gemini-1.5-flash",
        GEMINI_API_KEY: "", // Empty key
      },
      api: { PORT: 8080 },
      worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
    };

    const provider = new GeminiModelProvider(mockConfig);
    await expect(
      provider.generateStructured({
        objective: "Triage complaint",
        prompt: "Raw details",
      }),
    ).rejects.toThrow("GEMINI_API_KEY is missing in configuration");
  });
});
