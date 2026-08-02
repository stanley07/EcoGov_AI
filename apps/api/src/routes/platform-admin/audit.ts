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

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}_${id}`).toString("base64");
}

function decodeCursor(cursorStr: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursorStr, "base64").toString("utf-8");
    const parts = raw.split("_");
    if (parts.length < 2) return null;
    const dateStr = parts[0];
    const id = parts.slice(1).join("_");
    if (!dateStr || !id) return null;
    return { createdAt: new Date(dateStr), id };
  } catch {
    return null;
  }
}

export default async function auditRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. List Audit Events (Cursor Paginated, Isolated)
  app.get(
    "/platform-admin/v1/audit-events",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.AUDIT_READ)],
      schema: {
        querystring: {
          type: "object",
          properties: {
            tenantId: { type: "string", format: "uuid" },
            actor: { type: "string", format: "uuid" },
            action: { type: "string" },
            targetType: { type: "string" },
            targetId: { type: "string" },
            correlationId: { type: "string", format: "uuid" },
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
                    userId: { type: "string" },
                    action: { type: "string" },
                    resource: { type: "string" },
                    result: { type: "string" },
                    context: { type: "object", additionalProperties: true },
                    createdAt: { type: "string" }
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

      // Tenant isolation guard
      const user = req.user!;
      const isSuperAdmin = await hasPlatformPermission(pool, user.userId, PlatformPermission.AUDIT_READ);
      if (!isSuperAdmin) {
        params.push(user.tenantId);
        whereClauses.push(`tenant_id = $${params.length}`);
      } else if (q.tenantId) {
        params.push(q.tenantId);
        whereClauses.push(`tenant_id = $${params.length}`);
      }

      if (q.actor) {
        params.push(q.actor);
        whereClauses.push(`user_id = $${params.length}`);
      }

      if (q.action) {
        params.push(q.action);
        whereClauses.push(`action = $${params.length}`);
      }

      if (q.targetType && q.targetId) {
        params.push(`${q.targetType}:${q.targetId}`);
        whereClauses.push(`resource = $${params.length}`);
      }

      if (q.startDate) {
        params.push(new Date(q.startDate));
        whereClauses.push(`created_at >= $${params.length}`);
      }

      if (q.endDate) {
        params.push(new Date(q.endDate));
        whereClauses.push(`created_at <= $${params.length}`);
      }

      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        whereClauses.push(
          `(created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`
        );
      }

      const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

      params.push(limit + 1);
      const query = `
        SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource, result, context, created_at as "createdAt"
        FROM authz_audit_log
        ${whereStr}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}
      `;

      const res = await pool.query(query, params.slice(0, -1).concat([limit + 1]));
      let nextCursor = "";
      const rows = res.rows;

      if (rows.length > limit) {
        const lastItem = rows[limit - 1];
        nextCursor = encodeCursor(new Date(lastItem.createdAt), lastItem.id);
      }

      return reply.send({
        items: rows.slice(0, limit),
        nextCursor
      });
    }
  );

  // 2. Get Single Audit Event Context
  app.get(
    "/platform-admin/v1/audit-events/:id",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.AUDIT_READ)],
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
              userId: { type: "string" },
              action: { type: "string" },
              resource: { type: "string" },
              result: { type: "string" },
              context: { type: "object", additionalProperties: true },
              createdAt: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;
      const isSuperAdmin = await hasPlatformPermission(pool, user.userId, PlatformPermission.AUDIT_READ);

      let query = `
        SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource, result, context, created_at as "createdAt"
        FROM authz_audit_log WHERE id = $1
      `;
      const params = [id];

      if (!isSuperAdmin) {
        query += ` AND tenant_id = $2`;
        params.push(user.tenantId);
      }

      const res = await pool.query(query, params);
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: "Audit event not found" });
      }

      return reply.send(res.rows[0]);
    }
  );
}
