import { Pool } from "pg";
export interface AgentLimits {
    timeout_seconds: number;
    max_model_turns: number;
    max_tool_calls: number;
    max_input_tokens: number;
    max_output_tokens: number;
    max_tool_output_bytes: number;
}
export declare const PLATFORM_LIMIT_MAXS: AgentLimits;
export declare class AgentRegistryService {
    private pool;
    constructor(pool: Pool);
    private computeHash;
    private validateJsonSchema;
    private validateLimits;
    createApplication(key: string, displayName: string): Promise<string>;
    createAgentDefinition(key: string, displayName: string, owningApplicationId: string): Promise<string>;
    createPromptDefinition(key: string, owningApplicationId: string): Promise<string>;
    createPromptVersion(promptDefinitionId: string, version: string, template: string, variablesSchema: unknown): Promise<string>;
    createOutputContractDefinition(key: string, owningApplicationId: string): Promise<string>;
    createOutputContractVersion(outputContractDefinitionId: string, version: string, jsonSchema: unknown): Promise<string>;
    createAgentVersion(agentDefinitionId: string, version: string, promptVersionId: string, outputContractVersionId: string, modelPolicy: unknown, safetyProfile: unknown, limits: AgentLimits): Promise<string>;
    createToolDefinition(key: string, category: string): Promise<string>;
    createToolVersion(toolDefinitionId: string, version: string, description: string, inputSchema: unknown, outputSchema: unknown, requiredPermissions: string[], timeoutMs: number, maxOutputBytes: number, retryPolicy: unknown, redactionPolicy: unknown): Promise<string>;
    linkAgentVersionTool(agentVersionId: string, toolVersionId: string): Promise<void>;
    activateAgentVersion(agentVersionId: string): Promise<void>;
    activatePromptVersion(promptVersionId: string): Promise<void>;
    activateOutputContractVersion(contractVersionId: string): Promise<void>;
    activateToolVersion(toolVersionId: string): Promise<void>;
    retireAgentVersion(agentVersionId: string): Promise<void>;
    resolveActiveAgentVersion(agentDefinitionId: string): Promise<any>;
    resolveHistoricalAgentVersion(agentVersionId: string): Promise<any>;
}
//# sourceMappingURL=agent-registry-service.d.ts.map