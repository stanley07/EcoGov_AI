import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(255);

export async function publicRoutes(
  fastify: FastifyInstance,
  options: { pool: Pool; config: Config },
) {
  const { pool, config } = options;

  fastify.get(
    "/public/platform-statistics",
    {
      schema: {
        description: "Returns anonymous aggregate platform metrics for the configured public tenant",
        response: {
          200: {
            type: "object",
            required: [
              "registeredFacilities",
              "inspectionsCompleted",
              "citizenReports",
              "complianceRate",
              "generatedAt",
            ],
            properties: {
              registeredFacilities: { type: "integer" },
              inspectionsCompleted: { type: "integer" },
              citizenReports: { type: "integer" },
              complianceRate: { type: "integer" },
              generatedAt: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      // 1. Resolve tenant UUID using canonical slug validation
      const rawSlug = config.publicTenantSlug || "anambra-state-ministry-of-environment";
      const parseResult = slugSchema.safeParse(rawSlug);

      if (!parseResult.success) {
        return reply.status(404).send({ error: "Tenant not found." });
      }

      const slug = parseResult.data;

      const tenantRes = await pool.query(
        "SELECT id FROM tenant WHERE slug = $1 AND deleted_at IS NULL AND is_system = FALSE AND status = 'active'",
        [slug]
      );

      // If no active non-system tenant matches the slug, return generic 404 to avoid enumeration
      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found." });
      }

      const tenantId = tenantRes.rows[0].id;

      // 2. Query aggregate metrics inside a single database round trip using CTEs
      const metricsQuery = `
        WITH metrics AS (
          SELECT
            (
              SELECT COUNT(*)::int
              FROM facility_registration r
              JOIN facility f ON f.id = r.facility_id AND f.tenant_id = r.tenant_id
              WHERE r.tenant_id = $1 AND r.status = 'approved' AND f.deleted_at IS NULL
            ) as approved_count,
            (
              SELECT COUNT(*)::int
              FROM facility_registration r
              JOIN facility f ON f.id = r.facility_id AND f.tenant_id = r.tenant_id
              WHERE r.tenant_id = $1 AND r.status = 'rejected' AND f.deleted_at IS NULL
            ) as rejected_count,
            (
              SELECT COUNT(*)::int
              FROM complaint_assignment
              WHERE tenant_id = $1 AND status = 'completed'
            ) as inspections_completed,
            (
              SELECT COUNT(*)::int
              FROM complaint
              WHERE tenant_id = $1
            ) as citizen_reports
        )
        SELECT
          approved_count as "registeredFacilities",
          inspections_completed as "inspectionsCompleted",
          citizen_reports as "citizenReports",
          CASE 
            WHEN (approved_count + rejected_count) > 0 
            THEN ROUND((approved_count::float / (approved_count + rejected_count)::float) * 100)::int
            ELSE 0
          END as "complianceRate"
        FROM metrics;
      `;

      const result = await pool.query(metricsQuery, [tenantId]);
      const stats = result.rows[0];

      reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

      return reply.code(200).send({
        registeredFacilities: stats.registeredFacilities,
        inspectionsCompleted: stats.inspectionsCompleted,
        citizenReports: stats.citizenReports,
        complianceRate: stats.complianceRate,
        generatedAt: new Date().toISOString(),
      });
    }
  );
}
