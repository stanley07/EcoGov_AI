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

export default async function tenantsRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. Suspend Tenant
  app.post(
    "/platform-admin/v1/tenants/:id/suspend",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.TENANT_SUSPEND)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 }
          },
          required: ["expectedVersion", "reason"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              version: { type: "integer" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { expectedVersion, reason } = req.body as { expectedVersion: number; reason: string };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "System tenant cannot be suspended" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          "SELECT status, version FROM tenant WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Tenant not found" });
        }

        const tenant = lockRes.rows[0];
        if (tenant.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict: Stale tenant version" });
        }

        // Suspend tenant and invalidate user sessions by incrementing session_version
        const updateRes = await client.query(
          `UPDATE tenant
           SET status = 'suspended', session_version = session_version + 1, version = version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING id, status, version`,
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'TENANT_SUSPENDED', $3, 'allow', $4)`,
          [
            id,
            req.user!.userId,
            `tenant:${id}`,
            JSON.stringify({ reason, beforeVersion: expectedVersion, afterVersion: updateRes.rows[0].version })
          ]
        );

        await client.query("COMMIT");
        return reply.send(updateRes.rows[0]);
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  // 2. Reactivate Tenant
  app.post(
    "/platform-admin/v1/tenants/:id/reactivate",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.TENANTS_REACTIVATE)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 }
          },
          required: ["expectedVersion", "reason"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              version: { type: "integer" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { expectedVersion, reason } = req.body as { expectedVersion: number; reason: string };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "System tenant cannot be reactivated" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          "SELECT status, version FROM tenant WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Tenant not found" });
        }

        const tenant = lockRes.rows[0];
        if (tenant.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict: Stale tenant version" });
        }

        const updateRes = await client.query(
          `UPDATE tenant
           SET status = 'active', version = version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING id, status, version`,
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'TENANT_REACTIVATED', $3, 'allow', $4)`,
          [
            id,
            req.user!.userId,
            `tenant:${id}`,
            JSON.stringify({ reason, beforeVersion: expectedVersion, afterVersion: updateRes.rows[0].version })
          ]
        );

        await client.query("COMMIT");
        return reply.send(updateRes.rows[0]);
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  // 3. Configure Quotas
  app.patch(
    "/platform-admin/v1/tenants/:id/quotas",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.TENANTS_CONFIGURE)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 },
            maxCostMicrounits: { type: "string" }
          },
          required: ["expectedVersion", "reason", "maxCostMicrounits"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              version: { type: "integer" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { expectedVersion, reason, maxCostMicrounits } = req.body as { expectedVersion: number; reason: string; maxCostMicrounits: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          "SELECT version FROM tenant WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Tenant not found" });
        }

        const tenant = lockRes.rows[0];
        if (tenant.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict: Stale tenant version" });
        }

        const updateRes = await client.query(
          `UPDATE tenant
           SET version = version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING id, version`,
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'TENANT_QUOTAS_UPDATED', $3, 'allow', $4)`,
          [
            id,
            req.user!.userId,
            `tenant:${id}`,
            JSON.stringify({ reason, maxCostMicrounits, beforeVersion: expectedVersion, afterVersion: updateRes.rows[0].version })
          ]
        );

        await client.query("COMMIT");
        return reply.send(updateRes.rows[0]);
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  // 4. Configure Applications
  app.patch(
    "/platform-admin/v1/tenants/:id/applications",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.TENANTS_CONFIGURE)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 },
            enabledApplications: { type: "array", items: { type: "string" } }
          },
          required: ["expectedVersion", "reason", "enabledApplications"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              version: { type: "integer" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { expectedVersion, reason, enabledApplications } = req.body as { expectedVersion: number; reason: string; enabledApplications: string[] };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          "SELECT version FROM tenant WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Tenant not found" });
        }

        const tenant = lockRes.rows[0];
        if (tenant.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict: Stale tenant version" });
        }

        const updateRes = await client.query(
          `UPDATE tenant
           SET version = version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING id, version`,
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'TENANT_APPLICATIONS_UPDATED', $3, 'allow', $4)`,
          [
            id,
            req.user!.userId,
            `tenant:${id}`,
            JSON.stringify({ reason, enabledApplications, beforeVersion: expectedVersion, afterVersion: updateRes.rows[0].version })
          ]
        );

        await client.query("COMMIT");
        return reply.send(updateRes.rows[0]);
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  // 5. Configure Runtime Limits
  app.patch(
    "/platform-admin/v1/tenants/:id/runtime-limits",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.TENANTS_CONFIGURE)],
      schema: {
        params: {
          id: { type: "string", format: "uuid" }
        },
        body: {
          type: "object",
          properties: {
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 },
            maxTimeoutSeconds: { type: "integer" }
          },
          required: ["expectedVersion", "reason", "maxTimeoutSeconds"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              version: { type: "integer" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { expectedVersion, reason, maxTimeoutSeconds } = req.body as { expectedVersion: number; reason: string; maxTimeoutSeconds: number };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockRes = await client.query(
          "SELECT version FROM tenant WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Tenant not found" });
        }

        const tenant = lockRes.rows[0];
        if (tenant.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict: Stale tenant version" });
        }

        const updateRes = await client.query(
          `UPDATE tenant
           SET version = version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING id, version`,
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'TENANT_LIMITS_UPDATED', $3, 'allow', $4)`,
          [
            id,
            req.user!.userId,
            `tenant:${id}`,
            JSON.stringify({ reason, maxTimeoutSeconds, beforeVersion: expectedVersion, afterVersion: updateRes.rows[0].version })
          ]
        );

        await client.query("COMMIT");
        return reply.send(updateRes.rows[0]);
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );
}
