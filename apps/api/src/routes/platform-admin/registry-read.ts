import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Pool } from "pg";
import { PlatformPermission, hasPlatformPermission } from "@govos/core";

async function checkRegistryReadPermission(pool: Pool, req: FastifyRequest, reply: FastifyReply) {
  const user = req.user;
  if (!user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const allowed = await hasPlatformPermission(pool, user.userId, PlatformPermission.REGISTRY_READ);
  if (!allowed) {
    return reply.status(403).send({ error: "Forbidden: REGISTRY_READ permission required" });
  }
}

export default async function registryReadRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // 1. Get Agents
  app.get(
    "/platform-admin/v1/registry/agents",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                displayName: { type: "string" },
                owningApplicationId: { type: "string" },
                status: { type: "string" },
                createdAt: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      const res = await pool.query(
        `SELECT id, key, display_name as "displayName", owning_application_id as "owningApplicationId", status, created_at as "createdAt"
         FROM agent_definition ORDER BY key`
      );
      return reply.send(res.rows);
    }
  );

  // 2. Get Agent Versions
  app.get(
    "/platform-admin/v1/registry/agents/:id/versions",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" }
          },
          required: ["id"]
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                agentDefinitionId: { type: "string" },
                version: { type: "string" },
                promptVersionId: { type: "string" },
                outputContractVersionId: { type: "string" },
                modelPolicy: { type: "object", additionalProperties: true },
                safetyProfile: { type: "object", additionalProperties: true },
                status: { type: "string" },
                createdAt: { type: "string" },
                timeoutSeconds: { type: "integer" }
              }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const res = await pool.query(
        `SELECT id, agent_definition_id as "agentDefinitionId", version, prompt_version_id as "promptVersionId",
                output_contract_version_id as "outputContractVersionId", model_policy as "modelPolicy",
                safety_profile as "safetyProfile", status, created_at as "createdAt", timeout_seconds as "timeoutSeconds"
         FROM agent_version WHERE agent_definition_id = $1 ORDER BY version DESC`,
        [id]
      );
      return reply.send(res.rows);
    }
  );

  // 3. Get Prompts
  app.get(
    "/platform-admin/v1/registry/prompts",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                owningApplicationId: { type: "string" },
                createdAt: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      const res = await pool.query(
        `SELECT id, key, owning_application_id as "owningApplicationId", created_at as "createdAt"
         FROM prompt_definition ORDER BY key`
      );
      return reply.send(res.rows);
    }
  );

  // 4. Get Prompt Versions
  app.get(
    "/platform-admin/v1/registry/prompts/:id/versions",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" }
          },
          required: ["id"]
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                promptDefinitionId: { type: "string" },
                version: { type: "string" },
                template: { type: "string" },
                variablesSchema: { type: "object", additionalProperties: true },
                status: { type: "string" },
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
        `SELECT id, prompt_definition_id as "promptDefinitionId", version, template, variables_schema as "variablesSchema", status, created_at as "createdAt"
         FROM prompt_version WHERE prompt_definition_id = $1 ORDER BY version DESC`,
        [id]
      );
      return reply.send(res.rows);
    }
  );

  // 5. Get Output Contracts
  app.get(
    "/platform-admin/v1/registry/output-contracts",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                owningApplicationId: { type: "string" },
                createdAt: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      const res = await pool.query(
        `SELECT id, key, owning_application_id as "owningApplicationId", created_at as "createdAt"
         FROM output_contract_definition ORDER BY key`
      );
      return reply.send(res.rows);
    }
  );

  // 6. Get Output Contract Versions
  app.get(
    "/platform-admin/v1/registry/output-contracts/:id/versions",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" }
          },
          required: ["id"]
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                outputContractDefinitionId: { type: "string" },
                version: { type: "string" },
                jsonSchema: { type: "object", additionalProperties: true },
                status: { type: "string" },
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
        `SELECT id, output_contract_definition_id as "outputContractDefinitionId", version, json_schema as "jsonSchema", status, created_at as "createdAt"
         FROM output_contract_version WHERE output_contract_definition_id = $1 ORDER BY version DESC`,
        [id]
      );
      return reply.send(res.rows);
    }
  );

  // 7. Get Tools
  app.get(
    "/platform-admin/v1/registry/tools",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                category: { type: "string" },
                createdAt: { type: "string" }
              }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      const res = await pool.query(
        `SELECT id, key, category, created_at as "createdAt" FROM tool_definition ORDER BY key`
      );
      return reply.send(res.rows);
    }
  );

  // 8. Get Tool Versions
  app.get(
    "/platform-admin/v1/registry/tools/:id/versions",
    {
      preHandler: [async (req, reply) => checkRegistryReadPermission(pool, req, reply)],
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" }
          },
          required: ["id"]
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                toolDefinitionId: { type: "string" },
                version: { type: "string" },
                description: { type: "string" },
                inputSchema: { type: "object", additionalProperties: true },
                outputSchema: { type: "object", additionalProperties: true },
                requiredPermissions: { type: "array", items: { type: "string" } },
                status: { type: "string" },
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
        `SELECT id, tool_definition_id as "toolDefinitionId", version, description, input_schema as "inputSchema",
                output_schema as "outputSchema", required_permissions as "requiredPermissions", status, created_at as "createdAt"
         FROM tool_version WHERE tool_definition_id = $1 ORDER BY version DESC`,
        [id]
      );
      return reply.send(res.rows);
    }
  );
}
