import { randomUUID } from "node:crypto";
import fastify, { FastifyInstance } from "fastify";
import { Pool } from "pg";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Config } from "@govos/configuration";
import { runWithContext } from "@govos/observability";
import { runWithTenantContext } from "@govos/core";

import { healthRoutes } from "./routes/health.js";
import { versionRoute } from "./routes/version.js";
import { authRoutes } from "./routes/auth.js";
import { organizationRoutes } from "./routes/organizations.js";
import { facilityRoutes } from "./routes/facilities.js";
import { registrationRoutes } from "./routes/registration.js";
import { complaintRoutes } from "./routes/complaint.js";
import { workbenchRoutes } from "./routes/workbench.js";
import { publicRoutes } from "./routes/public.js";
import platformAdminRoutes from "./routes/platform-admin.js";


// Extend Fastify request interface
declare module "fastify" {
  interface FastifyRequest {
    user?: {
      userId: string;
      tenantId: string;
      roles: string[];
    };
  }
}

export function createApp(config: Config, pool: Pool): FastifyInstance {
  const app = fastify({
    disableRequestLogging: true, // We handle logging explicitly with correlation ids
  });

  void app.register(cors, {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Register Swagger docs generator
  app.register(swagger, {
    swagger: {
      info: {
        title: "GovOS & EcoGov AI API Gateway",
        description:
          "Production API definitions for GovOS and EcoGov environmental workflows.",
        version: "1.0.0",
      },
      securityDefinitions: {
        bearerAuth: {
          type: "apiKey",
          name: "Authorization",
          in: "header",
        },
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Correlation ID Middleware Hook
  app.addHook("onRequest", (req, reply, done) => {
    const rawCorrelationId = req.headers["x-correlation-id"];
    let correlationId = "";

    if (typeof rawCorrelationId === "string") {
      correlationId = rawCorrelationId
        .replace(/[^a-zA-Z0-9-]/g, "")
        .substring(0, 36);
    }

    if (!correlationId) {
      correlationId = randomUUID();
    }

    const requestId = randomUUID();
    reply.header("x-correlation-id", correlationId);

    runWithContext({ correlationId, requestId }, () => {
      done();
    });
  });

  // Session Authentication & Tenant Extraction Hook
  app.addHook("preHandler", async (req, reply) => {
    // Exclude public/internal-diagnostics endpoints
    if (
      req.url.startsWith("/healthz") ||
      req.url.startsWith("/readyz") ||
      req.url.startsWith("/version") ||
      req.url.startsWith("/auth/login") ||
      req.url.startsWith("/auth/invitations/accept") ||
      req.url.startsWith("/docs") ||
      req.url.startsWith("/internal/diagnostics") ||
      req.url.startsWith("/public/platform-statistics") ||
      (req.url === "/complaints" && req.method === "POST")
    ) {
      return;
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply
        .status(401)
        .send({ error: "Unauthorized: Missing credentials" });
    }

    const token = authHeader.substring(7);

    // Retrieve active session along with user role memberships
    const query = `
      SELECT u.id as user_id, u.tenant_id, u.status as user_status,
             t.status as tenant_status, t.session_version as tenant_session_version, s.session_version as session_version,
             COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
      FROM session s
      JOIN tenant t ON t.id = s.tenant_id
      JOIN user_account u ON u.id = s.user_id
      LEFT JOIN membership m ON m.user_id = u.id
      LEFT JOIN role r ON r.id = m.role_id
      WHERE s.token = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL
      GROUP BY u.id, u.tenant_id, u.status, t.status, t.session_version, s.session_version
    `;

    const result = await pool.query(query, [token]);
    if (result.rows.length === 0) {
      return reply
        .status(401)
        .send({ error: "Unauthorized: Invalid or expired token" });
    }

    const userRow = result.rows[0];

    const userStatus = userRow.user_status || "active";
    const tenantStatus = userRow.tenant_status || "active";
    const tenantSessionVersion = userRow.tenant_session_version ?? 1;
    const sessionVersion = userRow.session_version ?? 1;

    // Check if user account is suspended
    if (userStatus === "suspended") {
      return reply.status(403).send({ error: "Forbidden: User account is suspended" });
    }

    // 1. Session version invalidation (e.g. from tenant suspension)
    if (sessionVersion !== tenantSessionVersion) {
      return reply.status(401).send({ error: "Unauthorized: Session invalidated due to tenant status changes" });
    }

    // 2. Tenant suspension operational check
    if (tenantStatus === "suspended") {
      return reply.status(403).send({
        code: "TENANT_SUSPENDED",
        message: "This government workspace is currently suspended.",
      });
    }

    req.user = {
      userId: userRow.user_id,
      tenantId: userRow.tenant_id,
      roles: userRow.roles,
    };

    // Propagate tenant context to ALS
    runWithTenantContext(
      {
        tenantId: userRow.tenant_id,
        userId: userRow.user_id,
        roles: userRow.roles,
      },
      () => {},
    );
  });

  // Register health check and version routing blocks
  app.register(healthRoutes, { pool });
  app.register(versionRoute, { config });
  app.register(publicRoutes, { pool, config });

  // Register Milestone 2 business routes
  app.register(authRoutes, { pool });
  app.register(organizationRoutes, { pool });
  app.register(facilityRoutes, { pool });
  app.register(registrationRoutes, { pool });
  app.register(complaintRoutes, { pool });
  app.register(workbenchRoutes, { pool });
  app.register(platformAdminRoutes, { pool });

  return app;
}
