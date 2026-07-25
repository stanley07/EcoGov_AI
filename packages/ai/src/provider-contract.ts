import { z } from "zod";

// Legacy interfaces for backward compatibility
export interface ModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface ToolCallProposal {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly id?: string;
}

export interface ModelRequest {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema?: z.ZodTypeAny;
  readonly jsonSchema?: Record<string, unknown>;
  readonly tools?: readonly {
    readonly functionDeclarations: readonly {
      readonly name: string;
      readonly description: string;
      readonly parameters: Record<string, unknown>;
    }[];
  }[];
  readonly timeoutMs?: number;
  readonly fixtureKey?: string;
}

export interface ModelResponse {
  readonly content?: string;
  readonly structuredData?: any;
  readonly toolCalls?: readonly ToolCallProposal[];
  readonly usage: ModelUsage;
  readonly finishReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" | "timeout" | "other";
  readonly modelName: string;
  readonly latencyMs: number;
}

// New PA-2 interfaces
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens?: number;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  readonly id: string;
  readonly name: string;
  readonly result: unknown;
}

export interface ModelGenerationRequest {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema?: z.ZodTypeAny;
  readonly jsonSchema?: Record<string, unknown>;
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: z.ZodTypeAny;
  }[];
  readonly temperature?: number;
  readonly safetySettings?: readonly {
    readonly category: string;
    readonly threshold: string;
  }[];
  readonly timeoutMs?: number;
  readonly fixtureKey?: string;
}

export interface ModelContinuationRequest {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly conversationHistory: readonly {
    readonly role: "user" | "model";
    readonly content: string;
    readonly toolCalls?: readonly ToolCallRequest[];
    readonly toolResults?: readonly ToolCallResponse[];
  }[];
  readonly responseSchema?: z.ZodTypeAny;
  readonly jsonSchema?: Record<string, unknown>;
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: z.ZodTypeAny;
  }[];
  readonly temperature?: number;
  readonly safetySettings?: readonly {
    readonly category: string;
    readonly threshold: string;
  }[];
  readonly timeoutMs?: number;
}

export interface SafetyRating {
  readonly category: string;
  readonly probability: "NEGLIGIBLE" | "LOW" | "MEDIUM" | "HIGH";
  readonly blocked: boolean;
}

export interface ModelGenerationResult {
  readonly providerRequestId?: string;
  readonly modelIdentifier: string;
  readonly content?: string;
  readonly structuredData?: unknown;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly finishReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" | "timeout" | "other";
  readonly usage: TokenUsage;
  readonly safetyOutcome?: {
    readonly blocked: boolean;
    readonly ratings: readonly SafetyRating[];
  };
  readonly retryMetadata?: {
    readonly retryable: boolean;
    readonly backoffMs?: number;
  };
  readonly latencyMs: number;
}

export interface ProviderHealth {
  readonly status: "configured" | "credentials_valid" | "reachable" | "degraded" | "unavailable";
  readonly error?: string;
}

export interface ModelProvider {
  readonly providerName: string;
  generate(request: ModelGenerationRequest | ModelRequest): Promise<ModelGenerationResult | ModelResponse>;
  continueWithToolResults(request: ModelContinuationRequest): Promise<ModelGenerationResult>;
  healthCheck(): Promise<ProviderHealth>;
  estimateCost(usage: TokenUsage | ModelUsage): bigint; // returns cost in microunits (1 USD = 1,000,000 microunits)
}
