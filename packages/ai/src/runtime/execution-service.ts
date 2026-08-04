import { Pool, PoolClient } from "pg";

// Kept local to the AI runtime to avoid an undeclared circular package dependency.
// The public error codes remain identical to the registry contract.
enum AIExecutionErrorCode {
  ACTIVATION_FAILED = "ACTIVATION_FAILED",
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
}
class AIExecutionError extends Error {
  constructor(public readonly code:AIExecutionErrorCode,message:string){super(message);this.name="RegistryError";}
}

export type ExecutionState =
  | "queued"
  | "dispatched"
  | "running"
  | "waiting_for_tool"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "rejected";

export const ALLOWED_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  queued: ["dispatched", "cancelled", "rejected"],
  dispatched: ["running", "retry_scheduled", "cancelled", "rejected"],
  running: ["waiting_for_tool", "succeeded", "failed", "timed_out", "retry_scheduled", "cancelled", "rejected"],
  waiting_for_tool: ["running", "failed", "timed_out", "retry_scheduled", "cancelled", "rejected"],
  retry_scheduled: ["dispatched", "failed", "cancelled", "rejected"],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
  rejected: [],
};

export interface CreateExecutionParams {
  tenantId: string;
  applicationId?: string;
  agentDefinitionId?: string;
  agentVersionId?: string;
  agentName: string;
  modelProvider: string;
  modelName: string;
  promptTemplateVersion?: string;
  inputHash: string;
  actorType: "user" | "service" | "system";
  actorUserId?: string;
  actorServiceId?: string;
  idempotencyKey?: string;
  requestHash?: string;
  parentExecutionId?: string;
  correlationId?: string;
  runtimeVersion: string;
}
export class ExecutionEventService {
  constructor() {}

  public async appendEvent(
    client: PoolClient,
    tenantId: string,
    executionId: string,
    fromState: ExecutionState,
    toState: ExecutionState,
    sequenceNumber: number,
    attemptNumber: number,
    actorType: string,
    eventDescription: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai_execution_event (
         tenant_id, ai_execution_id, from_state, to_state, sequence_number, attempt_number, actor_type, event_description, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        executionId,
        fromState,
        toState,
        sequenceNumber,
        attemptNumber,
        actorType,
        eventDescription,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  }
}

export class AIExecutionService {
  private eventService: ExecutionEventService;

  constructor(private pool: Pool) {
    this.eventService = new ExecutionEventService();
  }

  public async createExecution(params: CreateExecutionParams): Promise<string> {
    // Validate that if idempotencyKey is set, requestHash and registry IDs are also set
    if (params.idempotencyKey && (!params.requestHash || !params.applicationId || !params.agentDefinitionId || !params.agentVersionId)) {
      throw new AIExecutionError(
        AIExecutionErrorCode.ACTIVATION_FAILED,
        "Idempotency key requires requestHash and registry IDs"
      );
    }

    const res = await this.pool.query(
      `INSERT INTO ai_execution (
         tenant_id, application_id, agent_definition_id, agent_version_id, agent_name,
         model_provider, model_name, prompt_template_version, input_hash,
         actor_type, actor_user_id, actor_service_id, idempotency_key, request_hash,
         parent_execution_id, correlation_id, execution_status, validation_status,
         started_at, current_state, next_event_sequence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'running', 'pending', NOW(), 'queued', 0)
       RETURNING id`,
      [
        params.tenantId,
        params.applicationId || null,
        params.agentDefinitionId || null,
        params.agentVersionId || null,
        params.agentName,
        params.modelProvider,
        params.modelName,
        params.promptTemplateVersion || null,
        params.inputHash,
        params.actorType,
        params.actorUserId || null,
        params.actorServiceId || null,
        params.idempotencyKey || null,
        params.requestHash || null,
        params.parentExecutionId || null,
        params.correlationId || null,
      ]
    );

    return res.rows[0].id;
  }

  public async transitionState(
    tenantId: string,
    executionId: string,
    toState: ExecutionState,
    eventDescription: string,
    attemptNumber: number = 1,
    actorType: string = "system",
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock and fetch current execution state
      const res = await client.query(
        `SELECT current_state, next_event_sequence, execution_status 
         FROM ai_execution 
         WHERE tenant_id = $1 AND id = $2 
         FOR UPDATE`,
        [tenantId, executionId]
      );

      if (res.rows.length === 0) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const current = res.rows[0];
      const fromState = current.current_state as ExecutionState;
      const nextSequence = current.next_event_sequence + 1;

      // Validate transition rules
      const allowed = ALLOWED_TRANSITIONS[fromState] || [];
      if (!allowed.includes(toState)) {
        throw new AIExecutionError(
          AIExecutionErrorCode.INVALID_STATE_TRANSITION,
          `Invalid execution state transition from ${fromState} to ${toState}`
        );
      }

      // Map state machine terminal states to db execution_status column
      let statusUpdate = current.execution_status;
      if (toState === "succeeded") statusUpdate = "succeeded";
      else if (toState === "failed") statusUpdate = "failed";
      else if (toState === "timed_out") statusUpdate = "failed";
      else if (toState === "cancelled") statusUpdate = "failed";
      else if (toState === "rejected") statusUpdate = "failed";

      // Append state machine sequence-numbered event
      await this.eventService.appendEvent(
        client,
        tenantId,
        executionId,
        fromState,
        toState,
        nextSequence,
        attemptNumber,
        actorType,
        eventDescription,
        metadata
      );

      // Update current state & sequence
      const updateQuery =
        toState === "succeeded" || toState === "failed" || toState === "timed_out" || toState === "cancelled" || toState === "rejected"
          ? `UPDATE ai_execution 
             SET current_state = $1, next_event_sequence = $2, execution_status = $3, completed_at = NOW() 
             WHERE tenant_id = $4 AND id = $5`
          : `UPDATE ai_execution 
             SET current_state = $1, next_event_sequence = $2, execution_status = $3 
             WHERE tenant_id = $4 AND id = $5`;

      await client.query(updateQuery, [toState, nextSequence, statusUpdate, tenantId, executionId]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
