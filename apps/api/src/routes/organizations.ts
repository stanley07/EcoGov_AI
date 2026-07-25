import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { hasPermission, checkAndAssertActiveTenant } from "@govos/core";

export function organizationRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // Query Organizations under active tenant context
  app.get(
    "/organizations",
    {
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                name: { type: "string" },
                status: { type: "string" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "org:read")) {
        return reply
          .status(403)
          .send({ error: "Forbidden: Insufficient permissions" });
      }

      const query = `
      SELECT id, tenant_id as "tenantId", name, status, created_at as "createdAt"
      FROM organization
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY name ASC
    `;
      const result = await pool.query(query, [user.tenantId]);
      return reply.send(result.rows);
    },
  );

  // Create organization
  app.post(
    "/organizations",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              status: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      await checkAndAssertActiveTenant(pool, user.tenantId);

      if (!hasPermission(user.roles, "org:write")) {
        return reply
          .status(403)
          .send({ error: "Forbidden: Insufficient permissions" });
      }

      const { name } = req.body as { name: string };
      const query = `
      INSERT INTO organization (tenant_id, name)
      VALUES ($1, $2)
      RETURNING id, name, status
    `;
      const result = await pool.query(query, [user.tenantId, name]);
      return reply.status(201).send(result.rows[0]);
    },
  );

  done();
}
