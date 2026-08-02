/* eslint-disable @typescript-eslint/no-explicit-any */
import { Pool } from "pg";
import { z } from "zod";
import * as crypto from "node:crypto";
import { logger } from "@govos/observability";
import { ModelProvider, ModelRequest } from "./provider-contract.js";
import { AgentDefinition } from "./agent-framework.js";
import { PromptTemplate, PromptRegistry } from "./prompt-registry.js";
import { Tool } from "./tool-registry.js";
import { PolicyEngine } from "./policy.js";

export interface ExecutionBudget {
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxCorrectionAttempts: number;
  readonly maxTotalTokens: number;
  readonly maxEstimatedCostMinorUnits: bigint;
  readonly maxWallClockMs: number;
  readonly maxToolOutputBytes: number;
}

export const DEFAULT_BUDGET: ExecutionBudget = {
  maxModelCalls: 4,
  maxToolCalls: 3,
  maxCorrectionAttempts: 1,
  maxTotalTokens: 50000,
  maxEstimatedCostMinorUnits: 2000n, // 2000 micro-cents ($0.002)
  maxWallClockMs: 30000, // 30 seconds
  maxToolOutputBytes: 100000, // 100 KB
};

export type OrchestratorOutcome<T> =
  | { readonly status: "completed"; readonly value: T; readonly executionId?: string }
  | { readonly status: "awaiting_human"; readonly approvalRequestId: string; readonly executionId?: string }
  | { readonly status: "policy_blocked"; readonly reasonCode: string; readonly executionId?: string }
  | { readonly status: "failed"; readonly failureCode: string; readonly executionId?: string };

export class AIExecutionOrchestrator {
  private readonly pool: Pool;
  private readonly provider: ModelProvider;
  private readonly policyEngine: PolicyEngine;

  constructor(pool: Pool, provider: ModelProvider, policyEngine: PolicyEngine) {
    this.pool = pool;
    this.provider = provider;
    this.policyEngine = policyEngine;
  }

  private async updateState(
    executionId: string,
    tenantId: string,
    state: string,
    eventDesc?: string
  ): Promise<void> {
    const updateRes = await this.pool.query(
      `UPDATE ai_execution
       SET current_state = $1,
           next_event_sequence = next_event_sequence + 1
       WHERE tenant_id = $2 AND id = $3
       RETURNING next_event_sequence - 1 AS seq_num`,
      [state, tenantId, executionId]
    );
    const seqNum = updateRes.rows[0]?.seq_num || 0;

    // Record execution state event with sequence_number
    await this.pool.query(
      `INSERT INTO ai_execution_event (
         tenant_id, ai_execution_id, from_state, to_state, sequence_number, attempt_number, actor_type, event_description
       ) VALUES ($1, $2, 'updating', $3, $4, 1, 'system', $5)`,
      [
        tenantId,
        executionId,
        state,
        seqNum,
        eventDesc || `Transitioned state to ${state}`
      ]
    );
  }

  public async orchestrate<TOutput>(
    tenantId: string,
    workflowId: string | null,
    stepExecutionId: string | null,
    agent: { definition: AgentDefinition },
    template: PromptTemplate,
    variables: Record<string, unknown>,
    tools: readonly Tool[],
    targetSchema: z.ZodType<TOutput>,
    budget: ExecutionBudget = DEFAULT_BUDGET
  ): Promise<OrchestratorOutcome<TOutput>> {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const deadline = startTime + budget.maxWallClockMs;

    // 1. Initialize execution trace log
    const inputHash = crypto.createHash("sha256").update(JSON.stringify(variables)).digest("hex");

    await this.pool.query(
      `INSERT INTO ai_execution (
         id, tenant_id, workflow_instance_id, workflow_step_execution_id, agent_name,
         model_provider, model_name, prompt_template_version, input_hash,
         execution_status, validation_status, started_at, current_state, actor_type
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', 'pending', NOW(), 'queued', 'system')`,
      [
        executionId,
        tenantId,
        workflowId,
        stepExecutionId,
        agent.definition.name,
        this.provider.providerName,
        agent.definition.model,
        template.version,
        inputHash,
      ]
    );

    await this.updateState(executionId, tenantId, "preparing", "Orchestrator initialized execution trace");

    let modelCallCount = 0;
    let toolCallCount = 0;
    let correctionAttempts = 0;
    let accumulatedTokens = 0;
    let accumulatedCost = 0n;

    // Track invoked tools to detect repetition loops
    const invokedToolHashes = new Set<string>();

    let currentInputVariables = { ...variables };

    try {
      while (Date.now() < deadline) {
        // Enforce budgets checks
        if (modelCallCount >= budget.maxModelCalls) {
          throw new Error("EXCEEDED_MODEL_CALL_BUDGET");
        }
        if (toolCallCount >= budget.maxToolCalls) {
          throw new Error("EXCEEDED_TOOL_CALL_BUDGET");
        }

        // 2. Render Secure prompt
        let renderedPrompt = "";
        try {
          renderedPrompt = new PromptRegistry().render(template, currentInputVariables);
        } catch (err: any) {
          await this.updateState(executionId, tenantId, "policy_blocked", `Prompt render failed: ${err.message}`);
          return { status: "policy_blocked", reasonCode: "PROMPT_RENDER_ERROR" };
        }

        // 3. Safety & Policy evaluate check
        const policyContext = {
          tenantId,
          actorRoles: [], // Fetch roles or bypass
          agentName: agent.definition.name,
          dataClassification: template.dataClassification,
          destinationProvider: this.provider.providerName,
        };

        const policyOutcome = this.policyEngine.evaluate(policyContext);
        await this.pool.query(
          `INSERT INTO ai_policy_decision (tenant_id, ai_execution_id, policy_name, decision, details)
           VALUES ($1, $2, 'input_data_classification_policy', $3, $4)`,
          [tenantId, executionId, policyOutcome, JSON.stringify(policyContext)]
        );

        if (policyOutcome === "blocked") {
          await this.updateState(executionId, tenantId, "policy_blocked", "Policy execution blocked");
          return { status: "policy_blocked", reasonCode: "DATA_CLASSIFICATION_BLOCKED" };
        }

        if (policyOutcome === "allowed_after_redaction") {
          renderedPrompt = this.policyEngine.redactSensitiveContent(renderedPrompt);
        }

        // 4. Model Generation Call
        await this.updateState(executionId, tenantId, "model_running", `Executing model call iteration ${modelCallCount + 1}`);
        modelCallCount++;

        const responseSchema = targetSchema;
        const req: ModelRequest = {
          systemInstruction: agent.definition.objective,
          prompt: renderedPrompt,
          responseSchema: responseSchema,
          fixtureKey: agent.definition.name,
          tools: tools.map((t) => ({
            functionDeclarations: [
              {
                name: t.definition.name,
                description: t.definition.description,
                parameters: {}, // parameters definitions mapping
              },
            ],
          })),
        };

        const response = await this.provider.generate(req);

        // Track usage costs
        const callTokens = response.usage.promptTokens + response.usage.completionTokens;
        accumulatedTokens += callTokens;
        const callCost = this.provider.estimateCost(response.usage);
        accumulatedCost += callCost;

        await this.pool.query(
          `INSERT INTO ai_model_call (
             tenant_id, ai_execution_id, prompt_content_hash, response_content_hash,
             token_input, token_output, estimated_cost_minor_units, latency_ms, finish_reason
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tenantId,
            executionId,
            crypto.createHash("sha256").update(renderedPrompt).digest("hex"),
            crypto.createHash("sha256").update(response.content || "").digest("hex"),
            response.usage.promptTokens,
            response.usage.completionTokens,
            callCost,
            response.latencyMs,
            response.finishReason,
          ]
        );

        // Check if provider generated a Tool Call proposed action
        if (response.toolCalls && response.toolCalls.length > 0) {
          await this.updateState(executionId, tenantId, "tool_pending", "Model proposed tool invocation");
          
          const proposed = response.toolCalls[0];
          if (!proposed) {
            continue;
          }
          const tool = tools.find((t) => t.definition.name === proposed.name);
          if (!tool) {
            throw new Error(`PROPOSED_UNKNOWN_TOOL: ${proposed.name}`);
          }

          // Loop Detection check
          const argHash = crypto.createHash("sha256").update(JSON.stringify(proposed.arguments)).digest("hex");
          const loopKey = `${tool.definition.name}:${argHash}`;
          if (invokedToolHashes.has(loopKey)) {
            await this.updateState(executionId, tenantId, "failed", "Loop detected during tool execution");
            return { status: "failed", failureCode: "NO_PROGRESS_LOOP_DETECTED" };
          }
          invokedToolHashes.add(loopKey);

          // Verify capability tool authorization
          if (tool.definition.category === "financial" || tool.definition.category === "identity_or_access") {
            await this.updateState(executionId, tenantId, "policy_blocked", `Blocked forbidden tool: ${proposed.name}`);
            return { status: "policy_blocked", reasonCode: "FORBIDDEN_TOOL_ACCESS" };
          }

          await this.updateState(executionId, tenantId, "tool_running", `Executing tool callback: ${tool.definition.name}`);
          toolCallCount++;

          const toolStartTime = Date.now();
          let toolResult: any;
          try {
            toolResult = await tool.execute(proposed.arguments, tenantId);
          } catch (tErr: any) {
            toolResult = { error: tErr.message };
          }

          // Untrusted tool output processing
          const resultText = JSON.stringify(toolResult);
          if (resultText.length > budget.maxToolOutputBytes) {
            throw new Error("TOOL_OUTPUT_LIMIT_EXCEEDED");
          }

          const resultHash = crypto.createHash("sha256").update(resultText).digest("hex");

          await this.pool.query(
            `INSERT INTO ai_tool_invocation (
               tenant_id, ai_execution_id, tool_name, tool_version, arguments_hash, result_hash, idempotency_key, execution_status, latency_ms
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8)`,
            [
              tenantId,
              executionId,
              tool.definition.name,
              tool.definition.version,
              argHash,
              resultHash,
              `idem-${executionId}-${toolCallCount}`,
              Date.now() - toolStartTime,
            ]
          );

          // Append tool result as untrusted evidence context variables
          currentInputVariables = {
            ...currentInputVariables,
            tool_output: resultText,
          };
          
          continue;
        }

        // 5. Final Output Schema Validation
        await this.updateState(executionId, tenantId, "validating", "Validating model final output structure");
        const parseResult = targetSchema.safeParse(response.structuredData);

        if (parseResult.success) {
          // Update database execution totals
          await this.pool.query(
            `UPDATE ai_execution
             SET execution_status = 'succeeded', validation_status = 'valid', completed_at = NOW(),
                 token_input = $1, token_output = $2, estimated_cost_minor_units = $3,
                 latency_ms = $4, model_call_count = $5, tool_call_count = $6
             WHERE tenant_id = $7 AND id = $8`,
            [
              Math.floor(accumulatedTokens / 2),
              Math.ceil(accumulatedTokens / 2),
              accumulatedCost,
              Date.now() - startTime,
              modelCallCount,
              toolCallCount,
              tenantId,
              executionId,
            ]
          );

          await this.updateState(executionId, tenantId, "succeeded", "Execution pipeline succeeded");
          return { status: "completed", value: parseResult.data, executionId };
        } else {
          // Schema Correction attempt
          if (correctionAttempts < budget.maxCorrectionAttempts) {
            correctionAttempts++;
            await this.updateState(executionId, tenantId, "correcting", `Retrying validation correction attempt ${correctionAttempts}`);
            
            // Format sanitized error issues (no stack traces)
            const issues = parseResult.error.issues.map((iss) => ({
              path: iss.path,
              message: iss.message,
            }));

            currentInputVariables = {
              ...currentInputVariables,
              schema_error: JSON.stringify({ error: "OUTPUT_SCHEMA_INVALID", issues }),
            };
            continue;
          } else {
            await this.pool.query(
              `UPDATE ai_execution
               SET execution_status = 'failed', validation_status = 'invalid', completed_at = NOW(),
                   failure_category = 'schema_error'
               WHERE tenant_id = $1 AND id = $2`,
              [tenantId, executionId]
            );
            await this.updateState(executionId, tenantId, "failed", "Validation correction budget exhausted");
            return { status: "failed", failureCode: "VALIDATION_CORRECTION_FAILED" };
          }
        }
      }

      throw new Error("EXCEEDED_WALL_CLOCK_TIMEOUT");
    } catch (err: any) {
      logger.error({ err: err.message, executionId }, "AI loop execution caught exception");

      let category = "internal_error";
      if (err.message.includes("BUDGET")) category = "internal_error";
      if (err.message.includes("TIMEOUT")) category = "internal_error";

      await this.pool.query(
        `UPDATE ai_execution
         SET execution_status = 'failed', completed_at = NOW(), failure_category = $1, error_code = $2
         WHERE tenant_id = $3 AND id = $4`,
        [category, err.message.substring(0, 50), tenantId, executionId]
      );
      await this.updateState(executionId, tenantId, "failed", `Aborted: ${err.message}`);

      return { status: "failed", failureCode: err.message, executionId };
    }
  }
}
