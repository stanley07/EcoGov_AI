import { Pool } from "pg";

export interface CreateAttemptParams {
  tenantId: string;
  executionId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  taskExecutionId?: string;
}

export interface CompleteAttemptParams {
  completedAt?: Date;
  inputTokens: number;
  outputTokens: number;
  actualCostMicrounits: bigint;
  finishReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" | "timeout" | "other";
  failureCode?: string;
  retryable?: boolean;
}

export class ExecutionAttemptService {
  constructor(private pool: Pool) {}

  public async createAttempt(params: CreateAttemptParams): Promise<string> {
    const res = await this.pool.query(
      `INSERT INTO ai_execution_attempt (
         tenant_id, ai_execution_id, attempt_number, provider, model, task_execution_id, started_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
       RETURNING id`,
      [
        params.tenantId,
        params.executionId,
        params.attemptNumber,
        params.provider,
        params.model,
        params.taskExecutionId || null,
      ]
    );
    return res.rows[0].id;
  }

  public async completeAttempt(attemptId: string, params: CompleteAttemptParams): Promise<void> {
    await this.pool.query(
      `UPDATE ai_execution_attempt 
       SET completed_at = GREATEST($1, started_at), input_tokens = $2, output_tokens = $3, actual_cost_microunits = $4,
           finish_reason = $5, failure_code = $6, retryable = $7
       WHERE id = $8`,
      [
        params.completedAt || new Date(),
        params.inputTokens,
        params.outputTokens,
        params.actualCostMicrounits.toString(), // Store as string representation of bigint in pg driver
        params.finishReason,
        params.failureCode || null,
        params.retryable !== undefined ? params.retryable : false,
        attemptId,
      ]
    );
  }
}
