import { Pool } from "pg";

export class ToolAuthorizationService {
  constructor() {}

  public async authorizeToolCall(
    requiredPermissions: string[],
    userPermissions: string[]
  ): Promise<{ authorized: boolean; reasonCode?: string }> {
    for (const perm of requiredPermissions) {
      if (!userPermissions.includes(perm)) {
        return { authorized: false, reasonCode: "INSUFFICIENT_PERMISSIONS" };
      }
    }
    return { authorized: true };
  }
}

export class ToolExecutionService {
  constructor(private pool: Pool) {}

  public async createToolInvocation(
    tenantId: string,
    executionId: string,
    attemptId: string,
    toolVersionId: string,
    providerToolCallId: string,
    sequenceNumber: number,
    authorized: boolean,
    reasonCode: string | null,
    argumentsHash: string,
    argumentsRedacted: unknown
  ): Promise<string> {
    const status = authorized ? "pending" : "denied";
    const authStatus = authorized ? "authorized" : "denied";

    const toolInfo = await this.pool.query(
      `SELECT d.key as name, v.version 
       FROM tool_version v 
       JOIN tool_definition d ON d.id = v.tool_definition_id 
       WHERE v.id = $1`,
      [toolVersionId]
    );
    if (toolInfo.rows.length === 0) {
      throw new Error(`Tool version ${toolVersionId} not found`);
    }
    const { name: toolName, version: toolVersion } = toolInfo.rows[0];

    const res = await this.pool.query(
      `INSERT INTO ai_tool_invocation (
         tenant_id, ai_execution_id, ai_execution_attempt_id, tool_version_id,
         tool_name, tool_version, provider_tool_call_id, sequence_number,
         authorization_status, authorization_reason_code, arguments_hash, arguments_redacted,
         status, requested_at, authorized_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14) 
       RETURNING id`,
      [
        tenantId,
        executionId,
        attemptId,
        toolVersionId,
        toolName,
        toolVersion,
        providerToolCallId,
        sequenceNumber,
        authStatus,
        reasonCode,
        argumentsHash,
        argumentsRedacted ? JSON.stringify(argumentsRedacted) : null,
        status,
        authorized ? new Date() : null,
      ]
    );
    return res.rows[0].id;
  }

  public async startToolInvocation(invocationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_tool_invocation 
       SET status = 'running', started_at = NOW() 
       WHERE id = $1 AND status = 'pending'`,
      [invocationId]
    );
  }

  public async completeToolInvocation(
    invocationId: string,
    resultHash: string,
    resultRedacted: unknown
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ai_tool_invocation 
       SET status = 'completed', completed_at = NOW(), result_hash = $1, result_redacted = $2 
       WHERE id = $3`,
      [resultHash, resultRedacted ? JSON.stringify(resultRedacted) : null, invocationId]
    );
  }

  public async failToolInvocation(
    invocationId: string,
    failureCode: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ai_tool_invocation 
       SET status = 'failed', completed_at = NOW(), failure_code = $1 
       WHERE id = $2`,
      [failureCode, invocationId]
    );
  }
}
