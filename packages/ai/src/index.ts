/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI } from "@google/genai";
import { Config } from "@govos/configuration";
import { logger, getContext } from "@govos/observability";
import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderHealth,
  ModelUsage,
  ModelContinuationRequest,
  ModelGenerationResult,
} from "./provider-contract.js";

export * from "./provider-contract.js";
export * from "./agent-framework.js";
export * from "./runtime/execution-service.js";
export * from "./runtime/attempt-service.js";
export * from "./runtime/usage-service.js";
export * from "./runtime/tool-services.js";
export * from "./runtime/validation-service.js";
export * from "./runtime/model-runtime.js";

export class DeterministicModelProvider implements ModelProvider {
  public readonly providerName = "deterministic";
  private fixtures: Map<string, unknown> = new Map();

  constructor() {
    this.initializeFixtures();
  }

  private initializeFixtures() {
    // Evidence validation fixture
    this.fixtures.set("evidence_analysis", {
      file_id: "ev-test-123",
      tampering_detected: false,
      image_quality_check: {
        clear: true,
        reason: "Image shows oil separator with clear visibility",
      },
      objects_detected: ["water separator", "hose pipe"],
      matches_checklist_intent: true,
    });

    // Registration Review Agent fixture
    this.fixtures.set("ai_registration_review", {
      category: "Car Wash",
      detectedInconsistencies: [
        "Water recycling plan references 2000L tank but equipment diagram shows 1000L tank.",
      ],
      missingDocuments: ["waste_disposal_permit.pdf"],
      preliminaryRiskRating: "medium",
      confidenceScore: 0.95,
      rationales:
        "Chemical storage meets guidelines. Discrepancy in water recycling tank capacity requires officer clarification.",
    });

    this.fixtures.set("complaint_triage", {
      category: "Wastewater Discharge",
      priority: "high",
      assigned_group: "Water Compliance",
    });

    this.fixtures.set("ecogov.registration-review", {
      recommendedCategory: "car_wash",
      categoryMatchesSubmission: true,
      detectedInconsistencies: [],
      missingDocuments: [],
      preliminaryRiskRating: "low",
      confidenceScore: 0.95,
      rationale: "Facility parameters are correct.",
      permitCheck: {
        status: "valid",
        permitReference: "LGS-WMP-2026-XYZ",
      },
      requiresOfficerAttention: false,
      attentionReasons: [],
    });

    this.fixtures.set("ecogov.complaint-triage", {
      recommendedCategory: "water_pollution",
      recommendedPriority: "standard",
      summary: "Potential illegal wastewater discharge reported at Ikeja.",
      extractedLocation: {
        locality: "Ikeja",
        lga: "Ikeja",
        landmark: "Ikeja mall",
      },
      allegedIncidentType: "wastewater discharge",
      potentialHazards: ["water contamination"],
      recommendedDepartment: "pollution_control",
      duplicateAssessment: {
        status: "unlikely",
        candidateComplaintIds: [],
        rationale: "No similar complaints found.",
      },
      confidenceScore: 0.95,
      requiresImmediateHumanAttention: false,
      attentionReasons: [],
      recommendedNextAction: "officer_review",
    });
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    const key = request.fixtureKey || "ai_registration_review";
    logger.info(
      { fixtureKey: key },
      "Running deterministic AI model provider execution",
    );

    const startTime = Date.now();
    const data = this.fixtures.get(key);

    if (!data) {
      throw new Error(`Unknown deterministic fixture key requested: ${key}`);
    }

    return {
      content: JSON.stringify(data),
      structuredData: data,
      usage: {
        promptTokens: 120,
        completionTokens: 85,
      },
      finishReason: "stop",
      modelName: "deterministic-simulator",
      latencyMs: Date.now() - startTime,
    };
  }

  public async healthCheck(): Promise<ProviderHealth> {
    return { status: "configured" };
  }

  public async continueWithToolResults(request: ModelContinuationRequest): Promise<ModelGenerationResult> {
    const res = await this.generate({
      systemInstruction: request.systemInstruction,
      prompt: request.prompt,
      responseSchema: request.responseSchema,
      jsonSchema: request.jsonSchema,
      timeoutMs: request.timeoutMs,
    });
    return {
      modelIdentifier: res.modelName,
      content: res.content,
      structuredData: res.structuredData,
      toolCalls: res.toolCalls ? res.toolCalls.map(tc => ({ id: tc.id || "call_mock", name: tc.name, arguments: tc.arguments })) : undefined,
      finishReason: res.finishReason as any,
      usage: res.usage,
      latencyMs: res.latencyMs,
    };
  }

  public estimateCost(_usage: ModelUsage): bigint {
    return 100n; // 100 micro-cents fixed cost simulation
  }

  public async generateStructured<T>(req: {
    objective: string;
    prompt: string;
    fixtureKey?: string;
    jsonSchema?: any;
  }): Promise<{
    data: T;
    usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
    latencyMs: number;
    modelName: string;
  }> {
    const res = await this.generate({
      systemInstruction: req.objective,
      prompt: req.prompt,
      fixtureKey: req.fixtureKey,
    });
    return {
      data: res.structuredData as T,
      usage: {
        inputTokens: res.usage.promptTokens,
        outputTokens: res.usage.completionTokens,
        estimatedCost: Number(this.estimateCost(res.usage)) / 1000000,
      },
      latencyMs: res.latencyMs,
      modelName: res.modelName,
    };
  }
}

export class GeminiModelProvider implements ModelProvider {
  public readonly providerName = "gemini-api";
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = Date.now();
    const context = getContext();

    logger.info(
      {
        correlationId: context?.correlationId,
        model: this.config.ai.GEMINI_MODEL_ID,
      },
      "Initiating real Gemini API generation request via provider contract",
    );

    let apiKey = this.config.ai.GEMINI_API_KEY;
    if (this.config.ai.AI_PROVIDER === "vertex-ai") {
      apiKey = undefined;
    }

    if (this.config.ai.AI_PROVIDER === "gemini-api" && !apiKey) {
      throw new Error(
        "Cannot execute Gemini request: GEMINI_API_KEY is missing in configuration",
      );
    }

    const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

    try {
      const response = await ai.models.generateContent({
        model: this.config.ai.GEMINI_MODEL_ID,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType:
            request.responseSchema || request.jsonSchema
              ? "application/json"
              : "text/plain",
          responseSchema: request.responseSchema
            ? (request.responseSchema as any)
            : request.jsonSchema
              ? (request.jsonSchema as Record<string, unknown>)
              : undefined,
          tools: request.tools as any[],
          safetySettings: [
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_LOW_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
          ] as unknown as Record<string, unknown>[],
        },
      });

      const text = response.text;
      const usageMetadata = response.usageMetadata;
      const inputTokens = usageMetadata?.promptTokenCount || 0;
      const outputTokens = usageMetadata?.candidatesTokenCount || 0;

      // Extract function calls if returned natively
      let toolCalls: any[] | undefined = undefined;
      const candidates = response.candidates;
      if (candidates && candidates[0]?.content?.parts) {
        const parts = candidates[0].content.parts;
        const functionCalls = parts.filter((p: any) => p.functionCall);
        if (functionCalls.length > 0) {
          toolCalls = functionCalls.map((fc: any) => ({
            name: fc.functionCall.name,
            arguments: fc.functionCall.args,
          }));
        }
      }

      // Check finish reason
      let finishReason: ModelResponse["finishReason"] = "stop";
      const candidate = response.candidates?.[0];
      if (candidate?.finishReason) {
        const reason = candidate.finishReason;
        if (reason === "STOP") finishReason = "stop";
        else if (reason === "MAX_TOKENS") finishReason = "max_tokens";
        else if (reason === "SAFETY") finishReason = "content_filter";
        else if (reason === "RECITATION") finishReason = "content_filter";
        else finishReason = "other";
      }
      if (toolCalls && toolCalls.length > 0) {
        finishReason = "tool_calls";
      }

      let structuredData: any = undefined;
      if ((request.responseSchema || request.jsonSchema) && text) {
        try {
          structuredData = JSON.parse(text);
        } catch {
          // Handled by downstream orchestrator validation check
        }
      }

      return {
        content: text || undefined,
        structuredData,
        toolCalls,
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
        },
        finishReason,
        modelName: this.config.ai.GEMINI_MODEL_ID,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      logger.error({ err }, "Gemini API execution failed");
      throw err;
    }
  }

  public async healthCheck(): Promise<ProviderHealth> {
    if (
      this.config.ai.AI_PROVIDER === "gemini-api" &&
      !this.config.ai.GEMINI_API_KEY
    ) {
      return { status: "unavailable", error: "Missing API credentials" };
    }
    return { status: "configured" };
  }

  public async continueWithToolResults(request: ModelContinuationRequest): Promise<ModelGenerationResult> {
    const res = await this.generate({
      systemInstruction: request.systemInstruction,
      prompt: request.prompt,
      responseSchema: request.responseSchema,
      jsonSchema: request.jsonSchema,
      timeoutMs: request.timeoutMs,
    });
    return {
      modelIdentifier: res.modelName,
      content: res.content,
      structuredData: res.structuredData,
      toolCalls: res.toolCalls ? res.toolCalls.map(tc => ({ id: tc.id || "call_mock", name: tc.name, arguments: tc.arguments })) : undefined,
      finishReason: res.finishReason as any,
      usage: res.usage,
      latencyMs: res.latencyMs,
    };
  }

  public estimateCost(usage: ModelUsage): bigint {
    const costInput = BigInt(usage.promptTokens) * 75n;
    const costOutput = BigInt(usage.completionTokens) * 300n;
    return (costInput + costOutput) / 1000n;
  }

  public async generateStructured<T>(req: {
    objective: string;
    prompt: string;
    jsonSchema?: any;
  }): Promise<{
    data: T;
    usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
    latencyMs: number;
    modelName: string;
  }> {
    const res = await this.generate({
      systemInstruction: req.objective,
      prompt: req.prompt,
      jsonSchema: req.jsonSchema,
    });
    return {
      data: res.structuredData as T,
      usage: {
        inputTokens: res.usage.promptTokens,
        outputTokens: res.usage.completionTokens,
        estimatedCost: Number(this.estimateCost(res.usage)) / 1000000,
      },
      latencyMs: res.latencyMs,
      modelName: res.modelName,
    };
  }
}

export const AI_REGISTRATION_REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING" },
    detectedInconsistencies: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    missingDocuments: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    preliminaryRiskRating: {
      type: "STRING",
      enum: ["low", "medium", "high"],
    },
    confidenceScore: { type: "NUMBER" },
    rationales: { type: "STRING" },
  },
  required: [
    "category",
    "detectedInconsistencies",
    "missingDocuments",
    "preliminaryRiskRating",
    "confidenceScore",
    "rationales",
  ],
};

export * from "./tool-registry.js";
export * from "./prompt-registry.js";
export * from "./policy.js";
export * from "./orchestrator.js";
