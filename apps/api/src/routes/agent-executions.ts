import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { checkAndAssertActiveTenant } from "@govos/core";
import * as crypto from "node:crypto";

export function agentExecutionsRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool },
  done: (err?: Error) => void
) {
  const pool = options.pool;

  fastify.post("/agent-executions", async (req, reply) => {
    let tenantId = req.user?.tenantId || "00000000-0000-0000-0000-000000000001";
    const tenantCodeHeader = req.headers["x-tenant-code"];
    if (typeof tenantCodeHeader === "string") {
      const orgRes = await pool.query(
        "SELECT tenant_id FROM organization WHERE id::text = $1 OR name = $2",
        [tenantCodeHeader, tenantCodeHeader]
      );
      if (orgRes.rows.length > 0) {
        tenantId = orgRes.rows[0].tenant_id;
      }
    }

    await checkAndAssertActiveTenant(pool, tenantId);

    const body = req.body as {
      applicationKey: string;
      agentKey: string;
      variables: Record<string, unknown>;
      idempotencyKey?: string;
    };

    if (!body.applicationKey || !body.agentKey || !body.variables) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const agentRes = await pool.query(
      `SELECT av.id as version_id, ad.id as definition_id, ap.id as application_id, av.timeout_seconds,
              av.max_input_tokens, av.max_output_tokens, av.max_tool_output_bytes, av.model_policy,
              pv.version as prompt_version
       FROM agent_version av
       JOIN agent_definition ad ON ad.id = av.agent_definition_id
       JOIN application ap ON ap.id = ad.owning_application_id
       JOIN prompt_version pv ON pv.id = av.prompt_version_id
       WHERE ap.key = $1 AND ad.key = $2 AND av.status = 'active'`,
      [body.applicationKey, body.agentKey]
    );

    if (agentRes.rows.length === 0) {
      return reply.status(404).send({ error: `Active agent version not found for key ${body.agentKey}` });
    }

    const agent = agentRes.rows[0];
    const actorType = req.user ? "user" : "system";
    const actorUserId = req.user?.userId;
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(body.variables)).digest("hex");

    if (body.idempotencyKey) {
      const existing = await pool.query(
        `SELECT id, request_hash, current_state, execution_status 
         FROM ai_execution
         WHERE tenant_id = $1 AND application_id = $2 AND agent_definition_id = $3 AND idempotency_key = $4`,
        [tenantId, agent.application_id, agent.definition_id, body.idempotencyKey]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.request_hash !== requestHash) {
          return reply.status(409).send({ error: "Idempotency conflict: different request payload" });
        }
        if (row.execution_status === "succeeded" || row.execution_status === "failed") {
          return reply.status(200).send({
            executionId: row.id,
            status: row.execution_status,
            currentState: row.current_state,
          });
        } else {
          return reply.status(202).send({
            executionId: row.id,
            status: row.execution_status,
            currentState: row.current_state,
          });
        }
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const execRes = await client.query(
        `INSERT INTO ai_execution (
           tenant_id, application_id, agent_definition_id, agent_version_id, agent_name,
           model_provider, model_name, prompt_template_version, input_hash,
           actor_type, actor_user_id, idempotency_key, request_hash,
           execution_status, validation_status, started_at, current_state, next_event_sequence
         ) VALUES ($1, $2, $3, $4, $5, 'deterministic', 'deterministic-simulator', $6, $7, $8, $9, $10, $11, 'running', 'pending', NOW(), 'queued', 1)
         RETURNING id`,
        [
          tenantId,
          agent.application_id,
          agent.definition_id,
          agent.version_id,
          body.agentKey,
          agent.prompt_version,
          requestHash,
          actorType,
          actorUserId || null,
          body.idempotencyKey || null,
          requestHash,
        ]
      );
      const executionId = execRes.rows[0].id;

      const expiresAt = new Date(Date.now() + agent.timeout_seconds * 1000);
      await client.query(
        `INSERT INTO ai_usage_reservation (
           tenant_id, ai_execution_id, policy_version, reserved_input_tokens, reserved_output_tokens,
           reserved_cost_microunits, status, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, 0, 'reserved', NOW(), $6)`,
        [tenantId, executionId, "1.0.0", agent.max_input_tokens, agent.max_output_tokens, expiresAt]
      );

      await client.query(
        `INSERT INTO ai_execution_event (
           tenant_id, ai_execution_id, from_state, to_state, sequence_number, attempt_number, actor_type, event_description
         ) VALUES ($1, $2, 'queued', 'queued', 1, 1, $3, 'Execution initialized and queued')`,
        [tenantId, executionId, actorType]
      );

      const deduplicationKey = `exec_queued:${executionId}`;
      await client.query(
        `INSERT INTO outbox_event (
           tenant_id, aggregate_type, aggregate_id, event_type, payload, status, deduplication_key
         ) VALUES ($1, 'agent_execution', $2, 'agent_execution_queued', $3, 'pending', $4)`,
        [
          tenantId,
          executionId,
          JSON.stringify({ executionId, agentKey: body.agentKey, applicationKey: body.applicationKey }),
          deduplicationKey,
        ]
      );

      await client.query("COMMIT");

      return reply.status(202).send({
        executionId,
        status: "queued",
        currentState: "queued",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.get("/agent-executions/:id", async (req, reply) => {
    let tenantId = req.user?.tenantId || "00000000-0000-0000-0000-000000000001";
    const tenantCodeHeader = req.headers["x-tenant-code"];
    if (typeof tenantCodeHeader === "string") {
      const orgRes = await pool.query(
        "SELECT tenant_id FROM organization WHERE id::text = $1 OR name = $2",
        [tenantCodeHeader, tenantCodeHeader]
      );
      if (orgRes.rows.length > 0) {
        tenantId = orgRes.rows[0].tenant_id;
      }
    }

    await checkAndAssertActiveTenant(pool, tenantId);

    const { id } = req.params as { id: string };

    const executionRes = await pool.query(
      `SELECT e.id, e.tenant_id, e.application_id, e.agent_definition_id, e.agent_version_id,
              e.agent_name, e.model_provider, e.model_name, e.prompt_template_version,
              e.actor_type, e.actor_user_id, e.idempotency_key, e.request_hash,
              e.execution_status, e.validation_status, e.started_at, e.completed_at,
              e.current_state, e.correlation_id,
              (SELECT json_agg(evt) FROM (
                 SELECT id, from_state, to_state, sequence_number, attempt_number, actor_type, event_description, created_at
                 FROM ai_execution_event
                 WHERE ai_execution_id = e.id
                 ORDER BY sequence_number
               ) evt) as timeline_events,
              (SELECT json_agg(att) FROM (
                 SELECT id, attempt_number, provider, model, started_at, completed_at, failure_code, retryable, input_tokens, output_tokens, actual_cost_microunits
                 FROM ai_execution_attempt
                 WHERE ai_execution_id = e.id
                 ORDER BY attempt_number
               ) att) as attempts
       FROM ai_execution e
       WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, id]
    );

    if (executionRes.rows.length === 0) {
      return reply.status(404).send({ error: "Execution record not found" });
    }

    const exec = executionRes.rows[0];

    return reply.status(200).send({
      executionId: exec.id,
      applicationId: exec.application_id,
      agentDefinitionId: exec.agent_definition_id,
      agentVersionId: exec.agent_version_id,
      agentName: exec.agent_name,
      modelProvider: exec.model_provider,
      modelName: exec.model_name,
      promptTemplateVersion: exec.prompt_template_version,
      actorType: exec.actor_type,
      actorUserId: exec.actor_user_id,
      idempotencyKey: exec.idempotency_key,
      requestHash: exec.request_hash,
      status: exec.execution_status,
      validationStatus: exec.validation_status,
      currentState: exec.current_state,
      correlationId: exec.correlation_id,
      startedAt: exec.started_at,
      completedAt: exec.completed_at,
      timelineEvents: exec.timeline_events || [],
      attempts: exec.attempts || [],
    });
  });

  done();
}
