export interface MarketplaceScreeningInputV1 {
  schemaVersion: "1";
  tenantId: string;
  applicationId: string;
  applicationVersion: number;
  business: {
    name: string;
    registrationNumber: string;
    taxIdentifier: string;
    operatingAddress: string;
    experienceYears: number;
    licenceType: string;
  };
  documents: Array<{
    documentType: string;
    contentHash: string;
    verificationStatus: string;
    scanStatus: string;
  }>;
  declarations: {
    accepted: boolean;
  };
}

export interface ScreeningCriterionV1 {
  code: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface ScreeningRiskFlagV1 {
  code: string;
  severity: "low" | "medium" | "high";
  explanation: string;
}

export interface MarketplaceScreeningOutputV1 {
  schemaVersion: "1";
  recommendation: "recommended" | "needs_review" | "high_risk";
  score: number;
  criteria: Array<ScreeningCriterionV1>;
  riskFlags: Array<ScreeningRiskFlagV1>;
  summary: string;
}

export function validateScreeningOutput(output: any): void {
  if (!output || typeof output !== "object") {
    throw new Error("Screening output must be an object");
  }
  if (output.schemaVersion !== "1") {
    throw new Error(`Unsupported schema version: '${output.schemaVersion}'`);
  }
  if (!["recommended", "needs_review", "high_risk"].includes(output.recommendation)) {
    throw new Error(`Invalid recommendation: '${output.recommendation}'`);
  }
  if (typeof output.score !== "number" || output.score < 0 || output.score > 100) {
    throw new Error(`Score must be a number between 0 and 100. Got: ${output.score}`);
  }
  if (!Array.isArray(output.criteria)) {
    throw new Error("Criteria must be an array");
  }
  let totalWeight = 0;
  for (const criterion of output.criteria) {
    if (typeof criterion.code !== "string" || !criterion.code) {
      throw new Error("Criterion code must be a non-empty string");
    }
    if (typeof criterion.score !== "number" || criterion.score < 0 || criterion.score > 100) {
      throw new Error(`Criterion score must be between 0 and 100. Got: ${criterion.score}`);
    }
    if (typeof criterion.weight !== "number" || criterion.weight < 0 || criterion.weight > 1) {
      throw new Error(`Criterion weight must be between 0 and 1. Got: ${criterion.weight}`);
    }
    totalWeight += criterion.weight;
  }
  // Allow small rounding precision, weight total should be close to 1
  if (output.criteria.length > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
    throw new Error(`Sum of criterion weights must equal 1.0. Got: ${totalWeight}`);
  }
  if (!Array.isArray(output.riskFlags)) {
    throw new Error("RiskFlags must be an array");
  }
  for (const flag of output.riskFlags) {
    if (typeof flag.code !== "string" || !flag.code) {
      throw new Error("Risk flag code must be a non-empty string");
    }
    if (!["low", "medium", "high"].includes(flag.severity)) {
      throw new Error(`Invalid risk severity: '${flag.severity}'`);
    }
  }
  if (typeof output.summary !== "string" || !output.summary) {
    throw new Error("Summary description is required");
  }
}
