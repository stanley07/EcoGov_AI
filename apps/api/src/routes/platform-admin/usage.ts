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

export default async function usageRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. Get Usage Summary
  app.get(
    "/platform-admin/v1/usage/summary",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.USAGE_READ)],
      schema: {
        querystring: {
          type: "object",
          properties: {
            tenantId: { type: "string", format: "uuid" },
            startDate: { type: "string" },
            endDate: { type: "string" }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              totalInputTokens: { type: "integer" },
              totalOutputTokens: { type: "integer" },
              totalEstimatedCostMicrounits: { type: "string" },
              totalActualCostMicrounits: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const q = req.query as any;
      const startDate = q.startDate ? new Date(q.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = q.endDate ? new Date(q.endDate) : new Date();

      if (endDate.getTime() - startDate.getTime() > 31 * 24 * 60 * 60 * 1000) {
        return reply.status(400).send({ error: "Maximum date range is 31 days" });
      }

      const params: any[] = [startDate, endDate];
      let where = `WHERE started_at >= $1 AND started_at <= $2`;

      if (q.tenantId) {
        params.push(q.tenantId);
        where += ` AND tenant_id = $${params.length}`;
      }

      const query = `
        SELECT 
          COALESCE(SUM(input_tokens), 0)::int as "totalInputTokens",
          COALESCE(SUM(output_tokens), 0)::int as "totalOutputTokens",
          COALESCE(SUM(estimated_cost_microunits), 0)::text as "totalEstimatedCostMicrounits",
          COALESCE(SUM(actual_cost_microunits), 0)::text as "totalActualCostMicrounits"
        FROM ai_execution_attempt
        ${where}
      `;
      const res = await pool.query(query, params);
      return reply.send(res.rows[0]);
    }
  );

  // 2. Get Usage Timeseries
  app.get(
    "/platform-admin/v1/usage/timeseries",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.USAGE_READ)],
      schema: {
        querystring: {
          type: "object",
          properties: {
            tenantId: { type: "string", format: "uuid" },
            startDate: { type: "string" },
            endDate: { type: "string" }
          }
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string" },
                costMicrounits: { type: "string" },
                inputTokens: { type: "integer" },
                outputTokens: { type: "integer" }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const q = req.query as any;
      const startDate = q.startDate ? new Date(q.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = q.endDate ? new Date(q.endDate) : new Date();

      const params: any[] = [startDate, endDate];
      let where = `WHERE started_at >= $1 AND started_at <= $2`;

      if (q.tenantId) {
        params.push(q.tenantId);
        where += ` AND tenant_id = $${params.length}`;
      }

      const query = `
        SELECT 
          DATE_TRUNC('day', started_at AT TIME ZONE 'UTC')::text as "day",
          COALESCE(SUM(actual_cost_microunits), 0)::text as "costMicrounits",
          COALESCE(SUM(input_tokens), 0)::int as "inputTokens",
          COALESCE(SUM(output_tokens), 0)::int as "outputTokens"
        FROM ai_execution_attempt
        ${where}
        GROUP BY 1
        ORDER BY 1
      `;
      const res = await pool.query(query, params);
      return reply.send(res.rows);
    }
  );

  // 3. Get Reconciliation Anomalies
  app.get(
    "/platform-admin/v1/usage/reconciliation-anomalies",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.USAGE_READ)],
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                aiExecutionId: { type: "string" },
                status: { type: "string" },
                reservedCostMicrounits: { type: "string" },
                actualCostMicrounits: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      const query = `
        SELECT id, tenant_id as "tenantId", ai_execution_id as "aiExecutionId", status,
               reserved_cost_microunits::text as "reservedCostMicrounits",
               actual_cost_microunits::text as "actualCostMicrounits"
        FROM ai_usage_reservation
        WHERE (status = 'expired')
           OR (status = 'charged' AND actual_cost_microunits > reserved_cost_microunits)
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const res = await pool.query(query);
      return reply.send(res.rows);
    }
  );
}
