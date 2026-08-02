import { describe, it, expect } from "vitest";
import { validateScreeningOutput } from "@govos/core";

describe("Subcontractor Screening Output Contract Validation (PA-4 Phase 3)", () => {
  it("1. passes a valid screening output contract", () => {
    const validOutput = {
      schemaVersion: "1",
      recommendation: "recommended",
      score: 85,
      criteria: [
        { code: "experience", score: 90, weight: 0.6, explanation: "Strong operating history" },
        { code: "credentials", score: 77.5, weight: 0.4, explanation: "Standard regulatory clearance" }
      ],
      riskFlags: [],
      summary: "Qualified baseline candidate."
    };

    expect(() => validateScreeningOutput(validOutput)).not.toThrow();
  });

  it("2. rejects invalid scores outside 0-100", () => {
    const invalidOutput = {
      schemaVersion: "1",
      recommendation: "recommended",
      score: 105, // Out of bounds
      criteria: [
        { code: "experience", score: 90, weight: 1.0, explanation: "Strong operating history" }
      ],
      riskFlags: [],
      summary: "Ineligible."
    };

    expect(() => validateScreeningOutput(invalidOutput)).toThrow("Score must be a number between 0 and 100");
  });

  it("3. rejects criterion weights that do not sum to 1.0", () => {
    const invalidOutput = {
      schemaVersion: "1",
      recommendation: "recommended",
      score: 80,
      criteria: [
        { code: "experience", score: 90, weight: 0.5, explanation: "Strong operating history" },
        { code: "credentials", score: 70, weight: 0.3, explanation: "Some credentials" } // Sum = 0.8
      ],
      riskFlags: [],
      summary: "Ineligible weights."
    };

    expect(() => validateScreeningOutput(invalidOutput)).toThrow("weights must equal 1.0");
  });
});
