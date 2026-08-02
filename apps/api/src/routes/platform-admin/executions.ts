import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Pool } from "pg";
import { PlatformPermission, hasPlatformPermission } from "@govos/core";

async function checkPermission(pool: Pool, req: FastifyRequest, reply: FastifyReply, permission: PlatformPermission) {
  const user = req.user;
  if (!user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const allowed = await hasPlatformPermission(pool, user.userId, permission);
  if (!allowed) {
    return reply.status(403).send({ error: `Forbidden: ${permission} permission required` });
  }
}

function redactPayload(payload: any): any {
  if (!payload) return payload;
  if (typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload.map(item => redactPayload(item));
  }
  const copy = { ...payload };
  const keysToRedact = ["prompt", "variables", "input", "arguments", "result", "secret", "token", "password", "key", "template"];
  for (const k of Object.keys(copy)) {
    const lowerKey = k.toLowerCase();
    const isTokenCount = lowerKey === "tokeninput" || lowerKey === "tokenoutput" || lowerKey.endsWith("tokens");
    if ((keysToRedact.includes(k) || lowerKey.includes("secret") || lowerKey.includes("token")) && !isTokenCount) {
      copy[k] = "[REDACTED]";
    } else if (typeof copy[k] === "object" && copy[k] !== null) {
      copy[k] = redactPayload(copy[k]);
    }
  }
  return copy;
}

function encodeCursor(startedAt: Date, id: string): string {
  return Buffer.from(`${startedAt.toISOString()}_${id}`).toString("base64");
}

function decodeCursor(cursorStr: string): { startedAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursorStr, "base64").toString("utf-8");
    const parts = raw.split("_");
    if (parts.length < 2) return null;
    const dateStr = parts[0];
    const id = parts.slice(1).join("_");
    if (!dateStr || !id) return null;
    return { startedAt: new Date(dateStr), id };
  } catch {
    return null;
  }
}

export default async function executionsRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. List Executions (Cursor Paginated, Redacted)
  app.get(
    "/platform-admin/v1/executions",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        querystring: {
          type: "object",
          properties: {
            tenantId: { type: "string", format: "uuid" },
            agentName: { type: "string" },
            status: { type: "string" },
            validationStatus: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            limit: { type: "integer", default: 20 },
            cursor: { type: "string" }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    tenantId: { type: "string" },
                    agentName: { type: "string" },
                    executionStatus: { type: "string" },
                    validationStatus: { type: "string" },
                    startedAt: { type: "string" },
                    completedAt: { type: "string" },
                    tokenInput: { type: "integer" },
                    tokenOutput: { type: "integer" },
                    estimatedCostMicrounits: { type: "string" }
                  }
                }
              },
              nextCursor: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const q = req.query as any;
      const limit = Math.min(q.limit || 20, 100);
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;

      const whereClauses: string[] = [];
      const params: any[] = [];

      // Enforce cross-tenant boundary rules
      const user = req.user!;
      const isSuperAdmin = await hasPlatformPermission(pool, user.userId, PlatformPermission.AUDIT_READ);
      if (!isSuperAdmin) {
        params.push(user.tenantId);
        whereClauses.push(`tenant_id = $${params.length}`);
      } else if (q.tenantId) {
        params.push(q.tenantId);
        whereClauses.push(`tenant_id = $${params.length}`);
      }

      if (q.agentName) {
        params.push(q.agentName);
        whereClauses.push(`agent_name = $${params.length}`);
      }

      if (q.status) {
        params.push(q.status);
        whereClauses.push(`execution_status = $${params.length}`);
      }

      if (q.validationStatus) {
        params.push(q.validationStatus);
        whereClauses.push(`validation_status = $${params.length}`);
      }

      if (q.startDate) {
        params.push(new Date(q.startDate));
        whereClauses.push(`started_at >= $${params.length}`);
      }

      if (q.endDate) {
        params.push(new Date(q.endDate));
        whereClauses.push(`started_at <= $${params.length}`);
      }

      if (cursor) {
        params.push(cursor.startedAt, cursor.id);
        whereClauses.push(
          `(started_at < $${params.length - 1} OR (started_at = $${params.length - 1} AND id < $${params.length}))`
        );
      }

      const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

      params.push(limit + 1);
      const query = `
        SELECT id, tenant_id as "tenantId", agent_name as "agentName", execution_status as "executionStatus",
               validation_status as "validationStatus", started_at as "startedAt", completed_at as "completedAt",
               token_input as "tokenInput", token_output as "tokenOutput", estimated_cost_minor_units * 10000 as "estimatedCostMicrounits"
        FROM ai_execution
        ${whereStr}
        ORDER BY started_at DESC, id DESC
        LIMIT $${params.length}
      `;

      const res = await pool.query(query, params.slice(0, -1).concat([limit + 1]));
      let nextCursor = "";
      const rows = res.rows;

      if (rows.length > limit) {
        const lastItem = rows[limit - 1];
        nextCursor = encodeCursor(new Date(lastItem.startedAt), lastItem.id);
      }

      return reply.send({
        items: redactPayload(rows.slice(0, limit)),
        nextCursor
      });
    }
  );

  // 2. Get Execution Detail (Redacted)
  app.get(
    "/platform-admin/v1/executions/:id",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              agentName: { type: "string" },
              executionStatus: { type: "string" },
              validationStatus: { type: "string" },
              startedAt: { type: "string" },
              completedAt: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;
      const isSuperAdmin = await hasPlatformPermission(pool, user.userId, PlatformPermission.AUDIT_READ);

      let query = "SELECT id, tenant_id as \"tenantId\", agent_name as \"agentName\", execution_status as \"executionStatus\", validation_status as \"validationStatus\", started_at as \"startedAt\", completed_at as \"completedAt\" FROM ai_execution WHERE id = $1";
      const params = [id];

      if (!isSuperAdmin) {
        query += " AND tenant_id = $2";
        params.push(user.tenantId);
      }

      const res = await pool.query(query, params);
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: "Execution not found" });
      }

      return reply.send(redactPayload(res.rows[0]));
    }
  );

  // 3. Get Timeline Events
  app.get(
    "/platform-admin/v1/executions/:id/events",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                sequenceNumber: { type: "integer" },
                fromState: { type: "string" },
                toState: { type: "string" },
                actorType: { type: "string" },
                eventDescription: { type: "string" },
                createdAt: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await pool.query(
        `SELECT id, sequence_number as "sequenceNumber", from_state as "fromState", to_state as "toState",
                actor_type as "actorType", event_description as "eventDescription", created_at as "createdAt"
         FROM ai_execution_event
         WHERE ai_execution_id = $1
         ORDER BY sequence_number ASC`,
        [id]
      );
      return reply.send(res.rows);
    }
  );

  // 4. Get Attempts (Redacted)
  app.get(
    "/platform-admin/v1/executions/:id/attempts",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                attemptNumber: { type: "integer" },
                provider: { type: "string" },
                model: { type: "string" },
                inputTokens: { type: "integer" },
                outputTokens: { type: "integer" },
                actualCostMicrounits: { type: "string" },
                finishReason: { type: "string" },
                failureCode: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await pool.query(
        `SELECT id, attempt_number as "attemptNumber", provider, model, input_tokens as "inputTokens",
                output_tokens as "outputTokens", actual_cost_microunits as "actualCostMicrounits",
                finish_reason as "finishReason", failure_code as "failureCode"
         FROM ai_execution_attempt
         WHERE ai_execution_id = $1
         ORDER BY attempt_number ASC`,
        [id]
      );
      return reply.send(redactPayload(res.rows));
    }
  );

  // 5. Get Tool Invocations
  app.get(
    "/platform-admin/v1/executions/:id/tool-invocations",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                sequenceNumber: { type: "integer" },
                authorizationStatus: { type: "string" },
                authorizationReasonCode: { type: "string" },
                status: { type: "string" },
                requestedAt: { type: "string" },
                argumentsRedacted: { type: "object", additionalProperties: true },
                resultRedacted: { type: "object", additionalProperties: true }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await pool.query(
        `SELECT id, sequence_number as "sequenceNumber", authorization_status as "authorizationStatus",
                authorization_reason_code as "authorizationReasonCode", status, requested_at as "requestedAt",
                arguments_redacted as "argumentsRedacted", result_redacted as "resultRedacted"
         FROM ai_tool_invocation
         WHERE ai_execution_id = $1
         ORDER BY sequence_number ASC`,
        [id]
      );
      return reply.send(redactPayload(res.rows));
    }
  );

  // 6. Get Bounded Retry Graph
  app.get(
    "/platform-admin/v1/executions/:id/retry-graph",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        response: {
          200: {
            type: "object",
            properties: {
              nodes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    executionId: { type: "string" },
                    parentExecutionId: { type: "string" },
                    retryType: { type: "string" },
                    status: { type: "string" },
                    createdAt: { type: "string" },
                    failureCode: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const nodes: any[] = [];
      const visited = new Set<string>();

      let currentId: string | null = id;
      let depth = 0;

      while (currentId && depth < 10 && nodes.length < 50) {
        if (visited.has(currentId)) {
          break; // Cycle check
        }
        visited.add(currentId);

        const res: any = await pool.query(
          `SELECT id, parent_execution_id as "parentExecutionId", execution_status as "status", started_at as "createdAt"
           FROM ai_execution WHERE id = $1`,
          [currentId]
        );

        if (res.rows.length === 0) break;
        const row: any = res.rows[0];

        nodes.push({
          executionId: row.id,
          parentExecutionId: row.parentExecutionId,
          retryType: row.parentExecutionId ? "administrative" : "runtime",
          status: row.status,
          createdAt: row.createdAt,
          failureCode: null
        });

        currentId = row.parentExecutionId;
        depth++;
      }

      return reply.send({ nodes });
    }
  );

  // 7. Privileged Sensitive View (POST with body reason)
  app.post(
    "/platform-admin/v1/executions/:id/sensitive-view",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.EXECUTIONS_READ_SENSITIVE)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            reason: { type: "string", minLength: 1 }
          },
          required: ["reason"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              agentName: { type: "string" },
              executionStatus: { type: "string" },
              validationStatus: { type: "string" },
              startedAt: { type: "string" },
              completedAt: { type: "string" },
              unredactedData: { type: "object", additionalProperties: true }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason: string };

      const execRes = await pool.query(
        `SELECT id, tenant_id as "tenantId", agent_name as "agentName", execution_status as "executionStatus",
                validation_status as "validationStatus", started_at as "startedAt", completed_at as "completedAt",
                prompt_template_version, input_hash
         FROM ai_execution WHERE id = $1`,
        [id]
      );

      if (execRes.rows.length === 0) {
        return reply.status(404).send({ error: "Execution not found" });
      }

      const row = execRes.rows[0];

      // Audit log the privileged access
      await pool.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'agent_execution.sensitive_view', $3, 'allow', $4)`,
        [
          row.tenantId,
          req.user!.userId,
          `agent_execution:${id}`,
          JSON.stringify({ reason })
        ]
      );

      reply.header("Cache-Control", "no-store");
      return reply.send({
        id: row.id,
        tenantId: row.tenantId,
        agentName: row.agentName,
        executionStatus: row.executionStatus,
        validationStatus: row.validationStatus,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        unredactedData: {
          promptTemplateVersion: row.prompt_template_version,
          inputHash: row.input_hash
        }
      });
    }
  );
}
