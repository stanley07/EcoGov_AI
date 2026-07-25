import { describe, test, expect } from "vitest";
import { loadConfig } from "./index.js";

describe("Configuration Loader Checks", () => {
  test("successfully loads valid local config", () => {
    const mockEnv = {
      APP_ENV: "local",
      DATABASE_URL: "postgres://localhost:5432/db",
      AI_PROVIDER: "deterministic",
      PORT: "3000",
      WORKER_PORT: "3001",
    };

    const config = loadConfig(mockEnv);
    expect(config.appEnv).toBe("local");
    expect(config.database.DATABASE_URL).toBe(mockEnv.DATABASE_URL);
    expect(config.ai.AI_PROVIDER).toBe("deterministic");
  });

  test("fails fast when mandatory DATABASE_URL is missing", () => {
    const mockEnv = {
      APP_ENV: "local",
      AI_PROVIDER: "deterministic",
    };

    expect(() => loadConfig(mockEnv)).toThrow("Database configuration error");
  });

  test("fails if gemini-api is selected without GEMINI_API_KEY", () => {
    const mockEnv = {
      APP_ENV: "local",
      DATABASE_URL: "postgres://localhost:5432/db",
      AI_PROVIDER: "gemini-api",
    };

    expect(() => loadConfig(mockEnv)).toThrow("AI configuration error");
  });

  test("rejects dummy keys in production environments", () => {
    const mockEnv = {
      APP_ENV: "production",
      DATABASE_URL: "postgres://localhost:5432/db",
      AI_PROVIDER: "gemini-api",
      GEMINI_API_KEY: "dummy_placeholder_key",
    };

    expect(() => loadConfig(mockEnv)).toThrow(
      "invalid placeholder values in staging/production",
    );
  });
});
