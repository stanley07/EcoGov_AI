import { ModelProvider, ModelGenerationRequest, ModelGenerationResult, ModelContinuationRequest } from "../provider-contract.js";

export class ModelRuntime {
  constructor(private provider: ModelProvider) {}

  public async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const res = await this.provider.generate(request);
    if ("usage" in res && !("modelIdentifier" in res)) {
      const legacyRes = res as any;
      return {
        modelIdentifier: legacyRes.modelName,
        content: legacyRes.content,
        structuredData: legacyRes.structuredData,
        toolCalls: legacyRes.toolCalls
          ? legacyRes.toolCalls.map((tc: any) => ({
              id: tc.id || "call_mock",
              name: tc.name,
              arguments: tc.arguments,
            }))
          : undefined,
        finishReason: legacyRes.finishReason,
        usage: {
          promptTokens: legacyRes.usage.promptTokens,
          completionTokens: legacyRes.usage.completionTokens,
        },
        latencyMs: legacyRes.latencyMs,
      };
    }
    return res as ModelGenerationResult;
  }

  public async continueWithToolResults(request: ModelContinuationRequest): Promise<ModelGenerationResult> {
    return this.provider.continueWithToolResults(request);
  }
}
