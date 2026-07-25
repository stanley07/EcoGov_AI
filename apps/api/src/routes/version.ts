import { FastifyInstance } from "fastify";
import { Config } from "@govos/configuration";

export async function versionRoute(
  fastify: FastifyInstance,
  options: { config: Config },
) {
  const { config } = options;

  fastify.get(
    "/version",
    {
      schema: {
        description:
          "Returns non-sensitive metadata for service identification",
        response: {
          200: {
            type: "object",
            required: [
              "serviceName",
              "buildVersion",
              "commitSha",
              "environment",
            ],
            properties: {
              serviceName: { type: "string" },
              buildVersion: { type: "string" },
              commitSha: { type: "string" },
              environment: { type: "string" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.code(200).send({
        serviceName: "govos-api",
        buildVersion: "0.1.0",
        commitSha: process.env["COMMIT_SHA"] || "development",
        environment: config.appEnv,
      });
    },
  );
}
