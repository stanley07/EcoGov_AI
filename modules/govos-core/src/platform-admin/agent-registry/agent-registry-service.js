import * as crypto from "node:crypto";
import { RegistryError, RegistryErrorCode } from "./registry-error-codes.js";
export const PLATFORM_LIMIT_MAXS = {
    timeout_seconds: 300,
    max_model_turns: 20,
    max_tool_calls: 10,
    max_input_tokens: 200000,
    max_output_tokens: 8000,
    max_tool_output_bytes: 5000000,
};
export class AgentRegistryService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    // Helper to compute content hash
    computeHash(content) {
        return crypto.createHash("sha256").update(content).digest("hex");
    }
    // Helper to validate JSON Schema
    validateJsonSchema(schema) {
        try {
            JSON.stringify(schema);
        }
        catch {
            throw new RegistryError(RegistryErrorCode.INVALID_JSON_SCHEMA, "Provided schema is not valid JSON");
        }
    }
    // Helper to validate agent limits against platform maximums
    validateLimits(limits) {
        if (limits.timeout_seconds <= 0 ||
            limits.max_model_turns <= 0 ||
            limits.max_tool_calls < 0 ||
            limits.max_input_tokens <= 0 ||
            limits.max_output_tokens <= 0 ||
            limits.max_tool_output_bytes <= 0) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, "Limits must be positive numbers");
        }
        if (limits.timeout_seconds > PLATFORM_LIMIT_MAXS.timeout_seconds) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `timeout_seconds exceeds platform limit of ${PLATFORM_LIMIT_MAXS.timeout_seconds}`);
        }
        if (limits.max_model_turns > PLATFORM_LIMIT_MAXS.max_model_turns) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `max_model_turns exceeds platform limit of ${PLATFORM_LIMIT_MAXS.max_model_turns}`);
        }
        if (limits.max_tool_calls > PLATFORM_LIMIT_MAXS.max_tool_calls) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `max_tool_calls exceeds platform limit of ${PLATFORM_LIMIT_MAXS.max_tool_calls}`);
        }
        if (limits.max_input_tokens > PLATFORM_LIMIT_MAXS.max_input_tokens) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `max_input_tokens exceeds platform limit of ${PLATFORM_LIMIT_MAXS.max_input_tokens}`);
        }
        if (limits.max_output_tokens > PLATFORM_LIMIT_MAXS.max_output_tokens) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `max_output_tokens exceeds platform limit of ${PLATFORM_LIMIT_MAXS.max_output_tokens}`);
        }
        if (limits.max_tool_output_bytes > PLATFORM_LIMIT_MAXS.max_tool_output_bytes) {
            throw new RegistryError(RegistryErrorCode.LIMITS_EXCEED_PLATFORM_MAX, `max_tool_output_bytes exceeds platform limit of ${PLATFORM_LIMIT_MAXS.max_tool_output_bytes}`);
        }
    }
    // 1. Applications draft management
    async createApplication(key, displayName) {
        const keyRegex = /^[a-z0-9-]+$/;
        if (!keyRegex.test(key)) {
            throw new Error("Application key must be lowercase alphanumeric with hyphens");
        }
        const res = await this.pool.query(`INSERT INTO application (key, display_name) 
       VALUES ($1, $2) 
       RETURNING id`, [key, displayName]);
        return res.rows[0].id;
    }
    // 2. Agent Definitions draft management
    async createAgentDefinition(key, displayName, owningApplicationId) {
        // Verify application exists
        const appRes = await this.pool.query(`SELECT id FROM application WHERE id = $1`, [owningApplicationId]);
        if (appRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.APPLICATION_NOT_FOUND, `Application ${owningApplicationId} not found`);
        }
        const res = await this.pool.query(`INSERT INTO agent_definition (key, display_name, owning_application_id, status) 
       VALUES ($1, $2, $3, 'active') 
       RETURNING id`, [key, displayName, owningApplicationId]);
        return res.rows[0].id;
    }
    // 3. Prompts draft management
    async createPromptDefinition(key, owningApplicationId) {
        const appRes = await this.pool.query(`SELECT id FROM application WHERE id = $1`, [owningApplicationId]);
        if (appRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.APPLICATION_NOT_FOUND, `Application ${owningApplicationId} not found`);
        }
        const res = await this.pool.query(`INSERT INTO prompt_definition (key, owning_application_id) 
       VALUES ($1, $2) 
       RETURNING id`, [key, owningApplicationId]);
        return res.rows[0].id;
    }
    async createPromptVersion(promptDefinitionId, version, template, variablesSchema) {
        this.validateJsonSchema(variablesSchema);
        const contentHash = this.computeHash(template);
        // Verify definition exists
        const defRes = await this.pool.query(`SELECT id FROM prompt_definition WHERE id = $1`, [promptDefinitionId]);
        if (defRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.PROMPT_VERSION_NOT_FOUND, "Prompt definition not found");
        }
        const res = await this.pool.query(`INSERT INTO prompt_version (prompt_definition_id, version, template, variables_schema, content_hash, status) 
       VALUES ($1, $2, $3, $4, $5, 'draft') 
       RETURNING id`, [promptDefinitionId, version, template, JSON.stringify(variablesSchema), contentHash]);
        return res.rows[0].id;
    }
    // 4. Output Contracts draft management
    async createOutputContractDefinition(key, owningApplicationId) {
        const appRes = await this.pool.query(`SELECT id FROM application WHERE id = $1`, [owningApplicationId]);
        if (appRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.APPLICATION_NOT_FOUND, `Application ${owningApplicationId} not found`);
        }
        const res = await this.pool.query(`INSERT INTO output_contract_definition (key, owning_application_id) 
       VALUES ($1, $2) 
       RETURNING id`, [key, owningApplicationId]);
        return res.rows[0].id;
    }
    async createOutputContractVersion(outputContractDefinitionId, version, jsonSchema) {
        this.validateJsonSchema(jsonSchema);
        const contentHash = this.computeHash(JSON.stringify(jsonSchema));
        const defRes = await this.pool.query(`SELECT id FROM output_contract_definition WHERE id = $1`, [outputContractDefinitionId]);
        if (defRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.OUTPUT_CONTRACT_VERSION_NOT_FOUND, "Output contract definition not found");
        }
        const res = await this.pool.query(`INSERT INTO output_contract_version (output_contract_definition_id, version, json_schema, content_hash, status) 
       VALUES ($1, $2, $3, $4, 'draft') 
       RETURNING id`, [outputContractDefinitionId, version, JSON.stringify(jsonSchema), contentHash]);
        return res.rows[0].id;
    }
    // 5. Agent Versions draft management
    async createAgentVersion(agentDefinitionId, version, promptVersionId, outputContractVersionId, modelPolicy, safetyProfile, limits) {
        this.validateLimits(limits);
        const defRes = await this.pool.query(`SELECT id FROM agent_definition WHERE id = $1`, [agentDefinitionId]);
        if (defRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.AGENT_DEFINITION_NOT_FOUND, "Agent definition not found");
        }
        const res = await this.pool.query(`INSERT INTO agent_version (
         agent_definition_id, version, prompt_version_id, output_contract_version_id,
         model_policy, safety_profile, timeout_seconds, max_model_turns, max_tool_calls,
         max_input_tokens, max_output_tokens, max_tool_output_bytes, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft') 
       RETURNING id`, [
            agentDefinitionId,
            version,
            promptVersionId,
            outputContractVersionId,
            JSON.stringify(modelPolicy),
            JSON.stringify(safetyProfile),
            limits.timeout_seconds,
            limits.max_model_turns,
            limits.max_tool_calls,
            limits.max_input_tokens,
            limits.max_output_tokens,
            limits.max_tool_output_bytes,
        ]);
        return res.rows[0].id;
    }
    // 6. Tool draft management
    async createToolDefinition(key, category) {
        const res = await this.pool.query(`INSERT INTO tool_definition (key, category) 
       VALUES ($1, $2) 
       RETURNING id`, [key, category]);
        return res.rows[0].id;
    }
    async createToolVersion(toolDefinitionId, version, description, inputSchema, outputSchema, requiredPermissions, timeoutMs, maxOutputBytes, retryPolicy, redactionPolicy) {
        this.validateJsonSchema(inputSchema);
        if (outputSchema)
            this.validateJsonSchema(outputSchema);
        const defRes = await this.pool.query(`SELECT id FROM tool_definition WHERE id = $1`, [toolDefinitionId]);
        if (defRes.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.TOOL_VERSION_NOT_FOUND, "Tool definition not found");
        }
        const res = await this.pool.query(`INSERT INTO tool_version (
         tool_definition_id, version, description, input_schema, output_schema,
         required_permissions, timeout_ms, max_output_bytes, retry_policy, redaction_policy, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft') 
       RETURNING id`, [
            toolDefinitionId,
            version,
            description,
            JSON.stringify(inputSchema),
            outputSchema ? JSON.stringify(outputSchema) : null,
            requiredPermissions,
            timeoutMs,
            maxOutputBytes,
            JSON.stringify(retryPolicy),
            JSON.stringify(redactionPolicy),
        ]);
        return res.rows[0].id;
    }
    async linkAgentVersionTool(agentVersionId, toolVersionId) {
        await this.pool.query(`INSERT INTO agent_version_tool (agent_version_id, tool_version_id) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING`, [agentVersionId, toolVersionId]);
    }
    // 7. Transactional Activation
    async activateAgentVersion(agentVersionId) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            // A. Lock and retrieve Agent Version
            const agentVerRes = await client.query(`SELECT * FROM agent_version WHERE id = $1 FOR UPDATE`, [agentVersionId]);
            if (agentVerRes.rows.length === 0) {
                throw new RegistryError(RegistryErrorCode.AGENT_DEFINITION_NOT_FOUND, "Agent version not found");
            }
            const agentVersion = agentVerRes.rows[0];
            if (agentVersion.status === "retired") {
                throw new RegistryError(RegistryErrorCode.INVALID_STATE_TRANSITION, "Cannot activate a retired agent version");
            }
            // B. Retrieve agent definition & application
            const agentDefRes = await client.query(`SELECT * FROM agent_definition WHERE id = $1`, [agentVersion.agent_definition_id]);
            const agentDef = agentDefRes.rows[0];
            // C. Retrieve prompt version & prompt definition
            const promptVerRes = await client.query(`SELECT pv.*, pd.owning_application_id 
         FROM prompt_version pv
         JOIN prompt_definition pd ON pd.id = pv.prompt_definition_id
         WHERE pv.id = $1`, [agentVersion.prompt_version_id]);
            if (promptVerRes.rows.length === 0) {
                throw new RegistryError(RegistryErrorCode.PROMPT_VERSION_NOT_FOUND, "Prompt version not found");
            }
            const promptVersion = promptVerRes.rows[0];
            // D. Retrieve output contract version & definition
            const contractVerRes = await client.query(`SELECT ocv.*, ocd.owning_application_id 
         FROM output_contract_version ocv
         JOIN output_contract_definition ocd ON ocd.id = ocv.output_contract_definition_id
         WHERE ocv.id = $1`, [agentVersion.output_contract_version_id]);
            if (contractVerRes.rows.length === 0) {
                throw new RegistryError(RegistryErrorCode.OUTPUT_CONTRACT_VERSION_NOT_FOUND, "Output contract version not found");
            }
            const contractVersion = contractVerRes.rows[0];
            // E. Check referenced version states: prompt & output contract must be active
            if (promptVersion.status !== "active") {
                throw new RegistryError(RegistryErrorCode.REFERENCED_VERSION_NOT_ACTIVE, "Referenced prompt version is not active");
            }
            if (contractVersion.status !== "active") {
                throw new RegistryError(RegistryErrorCode.REFERENCED_VERSION_NOT_ACTIVE, "Referenced output contract version is not active");
            }
            // F. Check application consistency mapping
            if (agentDef.owning_application_id !== promptVersion.owning_application_id ||
                agentDef.owning_application_id !== contractVersion.owning_application_id) {
                throw new RegistryError(RegistryErrorCode.MISMATCHED_APPLICATION_OWNERSHIP, "Mismatched owning application ownership between agent, prompt, and output contract");
            }
            // G. Validate linked tools are active
            const toolsRes = await client.query(`SELECT tv.* 
         FROM agent_version_tool avt
         JOIN tool_version tv ON tv.id = avt.tool_version_id
         WHERE avt.agent_version_id = $1`, [agentVersionId]);
            for (const tool of toolsRes.rows) {
                if (tool.status !== "active") {
                    throw new RegistryError(RegistryErrorCode.REFERENCED_VERSION_NOT_ACTIVE, `Referenced tool version ${tool.id} is not active`);
                }
            }
            // H. Update status to active
            await client.query(`UPDATE agent_version 
         SET status = 'active', activated_at = NOW() 
         WHERE id = $1`, [agentVersionId]);
            // I. Emit audit event
            await client.query(`INSERT INTO authz_audit_log (
           tenant_id, user_id, action, resource, result, context
         ) VALUES ($1, $2, $3, $4, 'allow', $5)`, [
                "00000000-0000-0000-0000-000000000001", // System tenant placeholder
                null,
                "agent_version.activated",
                `agent_version:${agentVersionId}`,
                JSON.stringify({
                    agentDefinitionId: agentVersion.agent_definition_id,
                    version: agentVersion.version,
                    promptVersionId: agentVersion.prompt_version_id,
                    contractVersionId: agentVersion.output_contract_version_id,
                }),
            ]);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    // 8. Lifecycle Transitions for prompts, output contracts, and tools
    async activatePromptVersion(promptVersionId) {
        const res = await this.pool.query(`UPDATE prompt_version 
       SET status = 'active' 
       WHERE id = $1 AND status = 'draft' 
       RETURNING id`, [promptVersionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.INVALID_STATE_TRANSITION, "Prompt version cannot be activated (must be in draft status)");
        }
    }
    async activateOutputContractVersion(contractVersionId) {
        const res = await this.pool.query(`UPDATE output_contract_version 
       SET status = 'active' 
       WHERE id = $1 AND status = 'draft' 
       RETURNING id`, [contractVersionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.INVALID_STATE_TRANSITION, "Output contract version cannot be activated (must be in draft status)");
        }
    }
    async activateToolVersion(toolVersionId) {
        const res = await this.pool.query(`UPDATE tool_version 
       SET status = 'active' 
       WHERE id = $1 AND status = 'draft' 
       RETURNING id`, [toolVersionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.INVALID_STATE_TRANSITION, "Tool version cannot be activated (must be in draft status)");
        }
    }
    async retireAgentVersion(agentVersionId) {
        const res = await this.pool.query(`UPDATE agent_version 
       SET status = 'retired', retired_at = NOW() 
       WHERE id = $1 AND status = 'active' 
       RETURNING id`, [agentVersionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.INVALID_STATE_TRANSITION, "Agent version cannot be retired (must be in active status)");
        }
        await this.pool.query(`INSERT INTO authz_audit_log (
         tenant_id, user_id, action, resource, result, context
       ) VALUES ($1, $2, $3, $4, 'allow', $5)`, [
            "00000000-0000-0000-0000-000000000001",
            null,
            "agent_version.retired",
            `agent_version:${agentVersionId}`,
            JSON.stringify({ agentVersionId })
        ]);
    }
    // 9. Historical Resolution Functions
    async resolveActiveAgentVersion(agentDefinitionId) {
        const res = await this.pool.query(`SELECT * FROM agent_version 
       WHERE agent_definition_id = $1 AND status = 'active'`, [agentDefinitionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.AGENT_DEFINITION_NOT_FOUND, "No active agent version found for this definition");
        }
        return res.rows[0];
    }
    async resolveHistoricalAgentVersion(agentVersionId) {
        const res = await this.pool.query(`SELECT * FROM agent_version WHERE id = $1`, [agentVersionId]);
        if (res.rows.length === 0) {
            throw new RegistryError(RegistryErrorCode.AGENT_DEFINITION_NOT_FOUND, "Agent version not found");
        }
        return res.rows[0];
    }
}
//# sourceMappingURL=agent-registry-service.js.map