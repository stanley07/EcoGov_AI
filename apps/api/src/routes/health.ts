import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { checkReadiness } from "@govos/infrastructure";

export async function healthRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool },
) {
  const { pool } = options;

  // Liveness Probe (Does not touch database or external networks)
  fastify.get(
    "/healthz",
    {
      schema: {
        description:
          "Liveness probe verifying server event loop responsiveness",
        response: {
          200: {
            type: "object",
            required: ["status", "timestamp"],
            properties: {
              status: { type: "string", enum: ["ok", "error"] },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.code(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Readiness Probe (Diagnostics connection to PostgreSQL and Migration locks status)
  fastify.get(
    "/readyz",
    {
      schema: {
        description:
          "Readiness probe verifying database connectivity and migration status",
        response: {
          200: {
            type: "object",
            required: ["status", "postgres", "migrations", "timestamp"],
            properties: {
              status: { type: "string", enum: ["ready", "not_ready"] },
              postgres: { type: "string", enum: ["connected", "disconnected"] },
              migrations: {
                type: "string",
                enum: ["current", "pending", "unknown"],
              },
              timestamp: { type: "string", format: "date-time" },
            },
          },
          503: {
            type: "object",
            required: ["status", "postgres", "migrations", "timestamp"],
            properties: {
              status: { type: "string", enum: ["ready", "not_ready"] },
              postgres: { type: "string", enum: ["connected", "disconnected"] },
              migrations: {
                type: "string",
                enum: ["current", "pending", "unknown"],
              },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const result = await checkReadiness(pool);
      if (result.status === "ready") {
        return reply.code(200).send(result);
      } else {
        return reply.code(503).send(result);
      }
    },
  );

  // Privileged Operational Diagnostics
  fastify.get(
    "/internal/diagnostics",
    async (req, reply) => {
      const internalToken = req.headers["x-internal-token"];
      if (internalToken !== "govos-internal-secret-token") {
        return reply.code(401).send({ error: "Unauthorized: Invalid internal token" });
      }

      // Check PostgreSQL connection
      let pgHealth = "connected";
      try {
        await pool.query("SELECT 1");
      } catch {
        pgHealth = "disconnected";
      }

      return reply.code(200).send({
        database: pgHealth,
        registries: {
          agents: 1, // EcoGov Facility Review
          prompts: 1,
          tools: 1,
        },
        aiProvider: {
          providerName: "deterministic",
          status: "configured",
        },
        timestamp: new Date().toISOString(),
      });
    },
  );
}
