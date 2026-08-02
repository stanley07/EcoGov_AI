import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Pool } from "pg";
import {
  PlatformPermission,
  hasPlatformPermission,
  TenantProvisioningService,
} from "@govos/core";
import registryReadRoutes from "./platform-admin/registry-read.js";
import registryCommandsRoutes from "./platform-admin/registry-commands.js";
import executionsRoutes from "./platform-admin/executions.js";
import usageRoutes from "./platform-admin/usage.js";
import operationalHealthRoutes from "./platform-admin/operational-health.js";
import tenantsRoutes from "./platform-admin/tenants.js";
import auditRoutes from "./platform-admin/audit.js";

// Platform Authorization & MFA Gate Hook
function requirePlatformAccess(pool: Pool, permission: PlatformPermission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user;
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized: Session credentials missing" });
    }

    // Check MFA Enrollment status
    const mfaRes = await pool.query(
      "SELECT mfa_enrollment_status FROM user_account WHERE id = $1",
      [user.userId]
    );

    if (mfaRes.rows.length === 0 || mfaRes.rows[0].mfa_enrollment_status !== "verified") {
      return reply.status(403).send({
        code: "MFA_ENROLLMENT_REQUIRED",
        message: "Multi-factor authentication must be configured before platform administration access is granted.",
      });
    }

    // Check Platform Permissions
    const hasAccess = await hasPlatformPermission(pool, user.userId, permission);
    if (!hasAccess) {
      return reply.status(403).send({
        error: `Forbidden: Platform permission ${permission} required`,
      });
    }
  };
}

export default async function platformAdminRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  const provisioningService = new TenantProvisioningService(pool);

  // 1. Provision Tenant (Idempotency Key integrated)
  app.post(
    "/platform-admin/tenants",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_CREATE)],
    },
    async (req, reply) => {
      const user = req.user!;
      const idempotencyKey = req.headers["idempotency-key"] as string;

      if (!idempotencyKey) {
        return reply.status(400).send({ error: "Idempotency-Key header is required" });
      }

      const result = await provisioningService.provision(
        user.userId,
        idempotencyKey,
        req.body
      );

      return reply.status(result.status).send(result.payload);
    }
  );

  // 2. List Tenants (System tenants excluded)
  app.get(
    "/platform-admin/tenants",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_READ)],
    },
    async (req, reply) => {
      const { search, status } = req.query as { search?: string; status?: string };

      let query = `
        SELECT id, name, slug, type, status, session_version as "sessionVersion", version, created_at as "createdAt"
        FROM tenant
        WHERE is_system = FALSE
      `;
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (name ILIKE $${params.length} OR slug ILIKE $${params.length})`;
      }

      if (status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
      }

      query += ` ORDER BY created_at DESC`;

      const result = await pool.query(query, params);
      return reply.send(result.rows);
    }
  );

  // 3. Get Tenant Details
  app.get(
    "/platform-admin/tenants/:id",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_READ)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "Access to system tenant details is forbidden" });
      }

      const tenantRes = await pool.query(
        `SELECT id, name, slug, type, status, session_version as "sessionVersion", version, created_at as "createdAt"
         FROM tenant WHERE id = $1 AND is_system = FALSE`,
        [id]
      );

      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      // Fetch invitations and organizations for details view
      const orgRes = await pool.query(
        "SELECT id, name, status FROM organization WHERE tenant_id = $1",
        [id]
      );

      const inviteRes = await pool.query(
        `SELECT id, email_normalized as "email", status, expires_at as "expiresAt", created_at as "createdAt"
         FROM user_invitation WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [id]
      );

      return reply.send({
        tenant: tenantRes.rows[0],
        organizations: orgRes.rows,
        invitations: inviteRes.rows,
      });
    }
  );

  // 4. Update Tenant Profile (Optimistic Concurrency)
  app.patch(
    "/platform-admin/tenants/:id",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_UPDATE)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { name, version } = req.body as { name?: string; version?: number };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "Modifying system tenant is forbidden" });
      }

      if (!name || version === undefined) {
        return reply.status(400).send({ error: "name and version are required" });
      }

      // Execute update with optimistic concurrency check
      const updateRes = await pool.query(
        `UPDATE tenant
         SET name = $1, version = version + 1, updated_at = NOW()
         WHERE id = $2 AND version = $3 AND is_system = FALSE
         RETURNING id, name, version`,
        [name.trim(), id, version]
      );

      if (updateRes.rows.length === 0) {
        return reply.status(409).send({
          error: "Tenant update conflict. The resource version has changed or tenant does not exist.",
        });
      }

      // Write Audit Log
      await pool.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'TENANT_UPDATED', $3, 'allow', $4)`,
        [
          id,
          req.user!.userId,
          `tenant:${id}`,
          JSON.stringify({ beforeVersion: version, afterVersion: updateRes.rows[0].version }),
        ]
      );

      return reply.send(updateRes.rows[0]);
    }
  );

  // 5. Suspend Tenant
  app.post(
    "/platform-admin/tenants/:id/suspend",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_SUSPEND)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "System tenant cannot be suspended" });
      }

      // Suspend tenant and increment session_version to invalidate all active memberships
      const res = await pool.query(
        `UPDATE tenant
         SET status = 'suspended', session_version = session_version + 1, updated_at = NOW()
         WHERE id = $1 AND is_system = FALSE
         RETURNING id, status, session_version as "sessionVersion"`,
        [id]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      // Write Audit Log
      await pool.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'TENANT_SUSPENDED', $3, 'allow', $4)`,
        [
          id,
          req.user!.userId,
          `tenant:${id}`,
          JSON.stringify({ status: "suspended", sessionVersion: res.rows[0].sessionVersion }),
        ]
      );

      return reply.send(res.rows[0]);
    }
  );

  // 6. Reactivate Tenant
  app.post(
    "/platform-admin/tenants/:id/reactivate",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_SUSPEND)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (id === "00000000-0000-0000-0000-000000000000") {
        return reply.status(403).send({ error: "System tenant cannot be reactivated" });
      }

      const res = await pool.query(
        `UPDATE tenant
         SET status = 'active', updated_at = NOW()
         WHERE id = $1 AND is_system = FALSE
         RETURNING id, status`,
        [id]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      // Write Audit Log
      await pool.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'TENANT_REACTIVATED', $3, 'allow', $4)`,
        [
          id,
          req.user!.userId,
          `tenant:${id}`,
          JSON.stringify({ status: "active" }),
        ]
      );

      return reply.send(res.rows[0]);
    }
  );

  // 7. Get Platform Statistics (System tenants excluded)
  app.get(
    "/platform-admin/statistics",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.TENANT_READ)],
    },
    async (_req, reply) => {
      const tenantCounts = await pool.query(
        `SELECT
           COUNT(*) as "total",
           COUNT(*) FILTER (WHERE status = 'active') as "active",
           COUNT(*) FILTER (WHERE status = 'suspended') as "suspended"
         FROM tenant
         WHERE is_system = FALSE`
      );

      const pendingInvites = await pool.query(
        `SELECT COUNT(*) as "count" FROM user_invitation WHERE status = 'pending' AND expires_at > NOW()`
      );

      const stats = tenantCounts.rows[0];
      return reply.send({
        totalTenants: parseInt(stats.total || "0", 10),
        activeTenants: parseInt(stats.active || "0", 10),
        suspendedTenants: parseInt(stats.suspended || "0", 10),
        pendingInvitations: parseInt(pendingInvites.rows[0].count || "0", 10),
      });
    }
  );

  // 8. Get Platform Audit Events
  app.get(
    "/platform-admin/audit-events",
    {
      preHandler: [requirePlatformAccess(pool, PlatformPermission.AUDIT_READ)],
    },
    async (_req, reply) => {
      const result = await pool.query(
        `SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource, result, context, created_at as "createdAt"
         FROM authz_audit_log
         ORDER BY created_at DESC
         LIMIT 100`
      );
      return reply.send(result.rows);
    }
  );

  // 9. Get Platform Agent Observability Metrics
  app.get(
    "/platform-admin/agent-observability",
    async (req, reply) => {
      const user = req.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized: Session credentials missing" });
      }

      // Check Platform Permissions
      const isSuperAdmin = await hasPlatformPermission(pool, user.userId, PlatformPermission.AUDIT_READ);

      let targetTenantId: string | null = null;
      const tenantParam = (req.query as any).tenantId;

      if (isSuperAdmin) {
        targetTenantId = tenantParam || null;
      } else {
        targetTenantId = user.tenantId;
        if (tenantParam && tenantParam !== user.tenantId) {
          return reply.status(403).send({ error: "Forbidden: Cannot access other tenant's metrics" });
        }
      }

      const limit = parseInt((req.query as any).limit || "10", 10);
      const offset = parseInt((req.query as any).offset || "0", 10);
      const startDate = (req.query as any).startDate;
      const endDate = (req.query as any).endDate;

      const whereClauses: string[] = [];
      const queryParams: any[] = [];

      if (targetTenantId) {
        queryParams.push(targetTenantId);
        whereClauses.push(`tenant_id = $${queryParams.length}`);
      }

      if (startDate) {
        queryParams.push(new Date(startDate));
        whereClauses.push(`started_at >= $${queryParams.length}`);
      }

      if (endDate) {
        queryParams.push(new Date(endDate));
        whereClauses.push(`started_at <= $${queryParams.length}`);
      }

      const whereStr = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "";

      // 1. Get Aggregates
      const aggQuery = `
        SELECT 
          COUNT(*)::int as total_executions,
          COUNT(CASE WHEN execution_status = 'succeeded' THEN 1 END)::int as succeeded_count,
          COUNT(CASE WHEN execution_status = 'failed' THEN 1 END)::int as failed_count,
          COALESCE(SUM(token_input), 0)::int as total_input_tokens,
          COALESCE(SUM(token_output), 0)::int as total_output_tokens,
          COALESCE(SUM(estimated_cost_minor_units), 0)::int as total_cost_minor_units
        FROM ai_execution
        ${whereStr}
      `;
      const aggRes = await pool.query(aggQuery, queryParams);
      const metrics = aggRes.rows[0];

      // 2. Get Paginated List
      const listParams = [...queryParams];
      listParams.push(limit);
      const limitIndex = listParams.length;
      listParams.push(offset);
      const offsetIndex = listParams.length;

      const listQuery = `
        SELECT id, tenant_id, agent_name, execution_status, current_state, started_at, completed_at, token_input, token_output, estimated_cost_minor_units
        FROM ai_execution
        ${whereStr}
        ORDER BY started_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `;
      const listRes = await pool.query(listQuery, listParams);

      return reply.status(200).send({
        tenantId: targetTenantId,
        metrics: {
          totalExecutions: metrics.total_executions,
          succeededCount: metrics.succeeded_count,
          failedCount: metrics.failed_count,
          totalInputTokens: metrics.total_input_tokens,
          totalOutputTokens: metrics.total_output_tokens,
          totalCostMinorUnits: metrics.total_cost_minor_units,
        },
        pagination: {
          limit,
          offset,
          total: metrics.total_executions,
        },
        items: listRes.rows,
      });
    }
  );

  // Register versioned platform-admin sub-routers
  void app.register(registryReadRoutes, { pool });
  void app.register(registryCommandsRoutes, { pool });
  void app.register(executionsRoutes, { pool });
  void app.register(usageRoutes, { pool });
  void app.register(operationalHealthRoutes, { pool });
  void app.register(tenantsRoutes, { pool });
  void app.register(auditRoutes, { pool });
}
