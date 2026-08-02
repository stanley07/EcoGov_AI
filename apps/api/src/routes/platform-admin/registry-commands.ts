import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Pool } from "pg";
import { PlatformPermission, hasPlatformPermission, PLATFORM_LIMIT_MAXS } from "@govos/core";

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

export default async function registryCommandsRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. Validate Version Preview
  app.post(
    "/platform-admin/v1/registry/versions/:type/:id/validate",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.REGISTRY_ACTIVATE)],
      schema: {
        params: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["agent", "prompt", "output-contract", "tool"] },
            id: { type: "string", format: "uuid" }
          },
          required: ["type", "id"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              valid: { type: "boolean" },
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    field: { type: "string" },
                    message: { type: "string" }
                  }
                }
              },
              warnings: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { type, id } = req.params as { type: string; id: string };
      const errors: Array<{ code: string; field: string; message: string }> = [];

      if (type === "agent") {
        const agentVerRes = await pool.query("SELECT * FROM agent_version WHERE id = $1", [id]);
        if (agentVerRes.rows.length === 0) {
          errors.push({ code: "VERSION_NOT_FOUND", field: "id", message: "Agent version not found" });
          return reply.send({ valid: false, errors, warnings: [] });
        }
        const av = agentVerRes.rows[0];

        // Retrieve agent definition
        const agentDefRes = await pool.query("SELECT owning_application_id FROM agent_definition WHERE id = $1", [av.agent_definition_id]);
        const agentDef = agentDefRes.rows[0];

        // Validate prompt version
        const promptRes = await pool.query(
          `SELECT pv.*, pd.owning_application_id 
           FROM prompt_version pv 
           JOIN prompt_definition pd ON pd.id = pv.prompt_definition_id
           WHERE pv.id = $1`,
          [av.prompt_version_id]
        );
        if (promptRes.rows.length === 0) {
          errors.push({ code: "PROMPT_VERSION_NOT_FOUND", field: "promptVersionId", message: "Referenced prompt version not found" });
        } else {
          const pv = promptRes.rows[0];
          if (pv.status !== "active") {
            errors.push({ code: "DEPENDENCY_NOT_ACTIVE", field: "promptVersionId", message: "Referenced prompt version is not active" });
          }
          if (agentDef && agentDef.owning_application_id !== pv.owning_application_id) {
            errors.push({ code: "MISMATCHED_APPLICATION_OWNERSHIP", field: "promptVersionId", message: "Mismatched prompt version owning application" });
          }
        }

        // Validate contract version
        const contractRes = await pool.query(
          `SELECT ocv.*, ocd.owning_application_id 
           FROM output_contract_version ocv
           JOIN output_contract_definition ocd ON ocd.id = ocv.output_contract_definition_id
           WHERE ocv.id = $1`,
          [av.output_contract_version_id]
        );
        if (contractRes.rows.length === 0) {
          errors.push({ code: "OUTPUT_CONTRACT_VERSION_NOT_FOUND", field: "outputContractVersionId", message: "Referenced output contract version not found" });
        } else {
          const cv = contractRes.rows[0];
          if (cv.status !== "active") {
            errors.push({ code: "DEPENDENCY_NOT_ACTIVE", field: "outputContractVersionId", message: "Referenced output contract version is not active" });
          }
          if (agentDef && agentDef.owning_application_id !== cv.owning_application_id) {
            errors.push({ code: "MISMATCHED_APPLICATION_OWNERSHIP", field: "outputContractVersionId", message: "Mismatched output contract version owning application" });
          }
        }

        // Validate limits
        if (av.timeout_seconds > PLATFORM_LIMIT_MAXS.timeout_seconds) {
          errors.push({ code: "LIMITS_EXCEED_PLATFORM_MAX", field: "timeoutSeconds", message: "timeout_seconds exceeds platform limit" });
        }
        if (av.max_model_turns > PLATFORM_LIMIT_MAXS.max_model_turns) {
          errors.push({ code: "LIMITS_EXCEED_PLATFORM_MAX", field: "maxModelTurns", message: "max_model_turns exceeds platform limit" });
        }

        // Validate linked tools
        const toolsRes = await pool.query(
          `SELECT tv.* 
           FROM agent_version_tool avt
           JOIN tool_version tv ON tv.id = avt.tool_version_id
           WHERE avt.agent_version_id = $1`,
          [id]
        );
        for (const tool of toolsRes.rows) {
          if (tool.status !== "active") {
            errors.push({ code: "DEPENDENCY_NOT_ACTIVE", field: `tool:${tool.id}`, message: `Referenced tool version ${tool.version} is not active` });
          }
        }
      } else {
        // Prompts, contracts, tools validation
        const table = type.replace("-", "_") + "_version";
        const res = await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
        if (res.rows.length === 0) {
          errors.push({ code: "VERSION_NOT_FOUND", field: "id", message: `${type} version not found` });
        }
      }

      return reply.send({
        valid: errors.length === 0,
        errors,
        warnings: []
      });
    }
  );

  // 2. Activate Version
  app.post(
    "/platform-admin/v1/registry/versions/:type/:id/activate",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.REGISTRY_ACTIVATE)],
      schema: {
        params: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["agent", "prompt", "output-contract", "tool"] },
            id: { type: "string", format: "uuid" }
          },
          required: ["type", "id"]
        },
        body: {
          type: "object",
          properties: {
            expectedStatus: { type: "string" },
            expectedVersion: { type: "integer" },
            reason: { type: "string", minLength: 1 }
          },
          required: ["expectedStatus", "reason"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { type, id } = req.params as { type: string; id: string };
      const { expectedStatus, expectedVersion, reason } = req.body as { expectedStatus: string; expectedVersion?: number; reason: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const table = type.replace("-", "_") + "_version";
        
        // Load with row locking
        const res = await client.query(`SELECT status, version FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        if (res.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Version not found" });
        }

        const current = res.rows[0];

        // Optimistic concurrency status/version check
        if (current.status !== expectedStatus) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: `Conflict: Expected status '${expectedStatus}' but current status is '${current.status}'`
          });
        }

        if (expectedVersion !== undefined) {
          const parsedVersion = parseInt(current.version.replace(/[^0-9]/g, "") || "0", 10);
          if (parsedVersion !== expectedVersion) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: `Conflict: Expected version '${expectedVersion}' but current version parsed is '${parsedVersion}'`
            });
          }
        }

        // Activate the version
        await client.query(`UPDATE ${table} SET status = 'active' WHERE id = $1`, [id]);

        // Insert audit log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, $3, $4, 'allow', $5)`,
          [
            "00000000-0000-0000-0000-000000000001",
            req.user!.userId,
            `${type}_version.activated`,
            `${type}_version:${id}`,
            JSON.stringify({ reason })
          ]
        );

        await client.query("COMMIT");
        return reply.send({ id, status: "active" });
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  // 3. Retire Agent Version
  app.post(
    "/platform-admin/v1/registry/versions/agent/:id/retire",
    {
      preHandler: [async (req, reply) => checkPermission(pool, req, reply, PlatformPermission.REGISTRY_RETIRE)],
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
              status: { type: "string" }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const res = await client.query(
          "SELECT status FROM agent_version WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (res.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Agent version not found" });
        }

        if (res.rows[0].status !== "active") {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Only active agent versions can be retired" });
        }

        await client.query(
          "UPDATE agent_version SET status = 'retired', retired_at = NOW() WHERE id = $1",
          [id]
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, $3, $4, 'allow', $5)`,
          [
            "00000000-0000-0000-0000-000000000001",
            req.user!.userId,
            "agent_version.retired",
            `agent_version:${id}`,
            JSON.stringify({ reason })
          ]
        );

        await client.query("COMMIT");
        return reply.send({ id, status: "retired" });
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );
}
