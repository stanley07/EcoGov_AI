import { FastifyInstance } from "fastify";
import { Pool } from "pg";

export function dashboardRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // GET /dashboard/environmental-summary
  app.get("/dashboard/environmental-summary", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.status(401).send({ error: "Unauthorized" });

    try {
      const tenantId = user.tenantId;
      const asOf = new Date().toISOString();

      // Query database for facility counts
      const countsQuery = `
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE risk_rating = 'high')::int as high,
          COUNT(*) FILTER (WHERE risk_rating = 'medium')::int as medium,
          COUNT(*) FILTER (WHERE risk_rating = 'low')::int as low
        FROM facility 
        WHERE tenant_id = $1 AND deleted_at IS NULL
      `;
      const countsRes = await pool.query(countsQuery, [tenantId]);
      const counts = countsRes.rows[0] || { total: 0, high: 0, medium: 0, low: 0 };

      // Query database for pending reviews
      const pendingQuery = `
        SELECT COUNT(*)::int as count 
        FROM facility_registration 
        WHERE tenant_id = $1 AND status IN ('submitted', 'officer_review')
      `;
      const pendingRes = await pool.query(pendingQuery, [tenantId]);
      const pending = pendingRes.rows[0]?.count ?? 0;

      return reply.send({
        totalFacilities: {
          status: "available",
          value: counts.total,
          asOf,
        },
        highRisk: {
          status: "available",
          value: counts.high,
          asOf,
        },
        mediumRisk: {
          status: "available",
          value: counts.medium,
          asOf,
        },
        lowRisk: {
          status: "available",
          value: counts.low,
          asOf,
        },
        pendingReviews: {
          status: "available",
          value: pending,
          asOf,
        },
        complianceScore: {
          status: "unavailable",
          reason: "module_not_implemented",
        },
        inspectionsConducted: {
          status: "unavailable",
          reason: "module_not_implemented",
        },
        activePermits: {
          status: "unavailable",
          reason: "module_not_implemented",
        },
        openViolations: {
          status: "unavailable",
          reason: "module_not_implemented",
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /dashboard/environmental-statistics
  app.get("/dashboard/environmental-statistics", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.status(401).send({ error: "Unauthorized" });

    try {
      const tenantId = user.tenantId;
      const asOf = new Date().toISOString();

      const statsQuery = `
        SELECT 
          TO_CHAR(created_at, 'YYYY-MM') as month,
          COUNT(*)::int as count
        FROM facility_registration
        WHERE tenant_id = $1
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY month ASC
      `;
      const statsRes = await pool.query(statsQuery, [tenantId]);
      
      const statsData = statsRes.rows.map(r => ({
        label: r.month,
        value: r.count
      }));

      return reply.send({
        registrationsOverTime: {
          status: "available",
          value: statsData,
          asOf
        },
        inspectionsHistory: {
          status: "unavailable",
          reason: "module_not_implemented"
        },
        complianceTrend: {
          status: "unavailable",
          reason: "module_not_implemented"
        }
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /dashboard/recent-activities
  app.get("/dashboard/recent-activities", async (req, reply) => {
    const user = req.user;
    if (!user) return reply.status(401).send({ error: "Unauthorized" });

    // Render Recent Activities as unavailable per timeline service not activated rules
    return reply.send({
      status: "unavailable",
      reason: "timeline_service_not_activated",
    });
  });

  done();
}
