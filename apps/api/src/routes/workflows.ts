import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { EnterpriseWorkflowEngine, WorkflowError } from "@govos/core";

type Actor = { userId: string; tenantId: string; roles: string[] };
const actor = (request: FastifyRequest) => request.user as Actor;
const key = (request: FastifyRequest) =>
  String(request.headers["idempotency-key"] ?? "").trim();
const expected = (request: FastifyRequest, body: any) =>
  Number(
    body?.expectedVersion ??
      String(request.headers["if-match"] ?? "").replace(/\D/g, ""),
  );
async function allowed(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
) {
  const a = actor(request);
  const result = await pool.query(
    `SELECT 1 FROM membership m JOIN role r ON r.tenant_id=m.tenant_id AND r.id=m.role_id JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND p.name=$3 LIMIT 1`,
    [a.tenantId, a.userId, name],
  );
  if (!result.rowCount) {
    reply
      .status(403)
      .send({ code: "WF_FORBIDDEN", message: "Permission denied" });
    return false;
  }
  return true;
}
async function definitionCommandAllowed(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  instanceId: string,
  commandType: string,
) {
  const a = actor(request);
  const result = await pool.query(
    `SELECT 1 FROM workflow_instance i JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$3 AND m.status='active' JOIN workflow_definition_permission dp ON dp.tenant_id=i.tenant_id AND dp.definition_id=i.definition_id AND dp.command_type=$4 JOIN permission p ON p.tenant_id=dp.tenant_id AND p.name=dp.permission_name JOIN role_permission rp ON rp.permission_id=p.id AND rp.role_id=m.role_id WHERE i.tenant_id=$1 AND i.id=$2 LIMIT 1`,
    [a.tenantId, instanceId, a.userId, commandType],
  );
  if (!result.rowCount) {
    reply
      .status(404)
      .send({ code: "WF_NOT_FOUND", message: "Workflow instance not found" });
    return false;
  }
  return true;
}
const commandKey = (request: FastifyRequest) => {
  const value = key(request);
  if (!value)
    throw new WorkflowError(
      "WF_IDEMPOTENCY_REQUIRED",
      400,
      "Idempotency-Key is required",
    );
  if (value.length > 255)
    throw new WorkflowError(
      "WF_IDEMPOTENCY_INVALID",
      400,
      "Idempotency-Key is too long",
    );
  return value;
};

export async function workflowRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
) {
  const engine = new EnterpriseWorkflowEngine(pool);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkflowError)
      return reply.status(error.status).send({
        code: error.code,
        message: error.message,
        correlationId: reply.getHeader("x-correlation-id"),
      });
    request.log.error(error);
    return reply
      .status(500)
      .send({ code: "WF_INTERNAL", message: "Workflow request failed" });
  });
  app.get("/v1/workflows/definitions", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:read"))) return;
    const q = req.query as any;
    return engine.listDefinitions(
      actor(req).tenantId,
      Number(q.limit ?? 50),
      Number(q.offset ?? 0),
    );
  });
  app.post("/v1/workflows/definitions", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:create")))
      return;
    return reply
      .status(201)
      .send(
        await engine.createDefinition(
          actor(req).tenantId,
          actor(req).userId,
          req.body as any,
        ),
      );
  });
  app.get("/v1/workflows/definitions/:id", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:read"))) return;
    return engine.getDefinition(actor(req).tenantId, (req.params as any).id);
  });
  app.get("/v1/workflows/definitions/:id/permissions", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:update")))
      return;
    const a = actor(req);
    return (
      await pool.query(
        `SELECT command_type,permission_name FROM workflow_definition_permission WHERE tenant_id=$1 AND definition_id=$2 ORDER BY command_type,permission_name`,
        [a.tenantId, (req.params as any).id],
      )
    ).rows;
  });
  app.put("/v1/workflows/definitions/:id/permissions", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:update")))
      return;
    const a = actor(req),
      body = req.body as any;
    if (
      !["start", "read", "cancel", "suspend", "resume", "repair"].includes(
        body?.commandType,
      ) ||
      typeof body?.permissionName !== "string"
    )
      throw new WorkflowError(
        "WF_DEFINITION_PERMISSION_INVALID",
        422,
        "Definition permission mapping is invalid",
      );
    const result = await pool.query(
      `INSERT INTO workflow_definition_permission(tenant_id,definition_id,command_type,permission_name) SELECT $1,d.id,$3,p.name FROM workflow_definition d JOIN permission p ON p.tenant_id=d.tenant_id AND p.name=$4 WHERE d.tenant_id=$1 AND d.id=$2 ON CONFLICT(tenant_id,definition_id,command_type,permission_name) DO NOTHING RETURNING command_type,permission_name`,
      [
        a.tenantId,
        (req.params as any).id,
        body.commandType,
        body.permissionName,
      ],
    );
    if (!result.rowCount) {
      const existing = await pool.query(
        `SELECT command_type,permission_name FROM workflow_definition_permission WHERE tenant_id=$1 AND definition_id=$2 AND command_type=$3 AND permission_name=$4`,
        [
          a.tenantId,
          (req.params as any).id,
          body.commandType,
          body.permissionName,
        ],
      );
      if (!existing.rowCount)
        throw new WorkflowError(
          "WF_DEFINITION_PERMISSION_INVALID",
          422,
          "Definition or permission does not exist",
        );
      return existing.rows[0];
    }
    return reply.status(201).send(result.rows[0]);
  });
  app.delete(
    "/v1/workflows/definitions/:id/permissions",
    async (req, reply) => {
      if (!(await allowed(pool, req, reply, "workflow:definition:update")))
        return;
      const a = actor(req),
        body = req.body as any;
      await pool.query(
        `DELETE FROM workflow_definition_permission WHERE tenant_id=$1 AND definition_id=$2 AND command_type=$3 AND permission_name=$4`,
        [
          a.tenantId,
          (req.params as any).id,
          body?.commandType,
          body?.permissionName,
        ],
      );
      return reply.status(204).send();
    },
  );
  app.post("/v1/workflows/definitions/:id/versions", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:update")))
      return;
    return reply
      .status(201)
      .send(
        await engine.cloneVersion(
          actor(req).tenantId,
          (req.params as any).id,
          (req.body as any)?.sourceVersionId,
        ),
      );
  });
  app.put("/v1/workflows/versions/:id/model", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:update")))
      return;
    const body = req.body as any;
    return engine.replaceDraft(
      actor(req).tenantId,
      (req.params as any).id,
      expected(req, body),
      body.model,
    );
  });
  app.post("/v1/workflows/versions/:id/validate", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:validate")))
      return;
    const result = await engine.validateVersion(
      actor(req).tenantId,
      (req.params as any).id,
    );
    return (result as any).valid === false
      ? reply.status(422).send(result)
      : result;
  });
  app.post("/v1/workflows/versions/:id/publish", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:publish")))
      return;
    const body = req.body as any;
    return engine.publishVersion(
      actor(req).tenantId,
      (req.params as any).id,
      actor(req).userId,
      expected(req, body),
      commandKey(req),
    );
  });
  app.post("/v1/workflows/versions/:id/deprecate", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:definition:publish")))
      return;
    const a = actor(req),
      body = req.body as any,
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      const current = await c.query(
        `SELECT * FROM workflow_version WHERE tenant_id=$1 AND id=$2 AND status='published' FOR UPDATE`,
        [a.tenantId, (req.params as any).id],
      );
      if (!current.rowCount)
        throw new WorkflowError(
          "WF_VERSION_CONFLICT",
          409,
          "Version is not published",
        );
      if (current.rows[0].is_default) {
        if (!body?.replacementVersionId)
          throw new WorkflowError(
            "WF_DEFAULT_REPLACEMENT_REQUIRED",
            422,
            "Default version requires an atomic replacement",
          );
        const replacement = await c.query(
          `UPDATE workflow_version SET is_default=TRUE WHERE tenant_id=$1 AND id=$2 AND definition_id=$3 AND status='published' AND is_default=FALSE RETURNING id`,
          [
            a.tenantId,
            body.replacementVersionId,
            current.rows[0].definition_id,
          ],
        );
        if (!replacement.rowCount)
          throw new WorkflowError(
            "WF_DEFAULT_REPLACEMENT_INVALID",
            422,
            "Replacement must be another published version",
          );
      }
      const result = await c.query(
        `UPDATE workflow_version SET status='deprecated',is_default=FALSE WHERE tenant_id=$1 AND id=$2 AND status='published' RETURNING id,status`,
        [a.tenantId, (req.params as any).id],
      );
      await c.query("COMMIT");
      return result.rows[0];
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });
  app.get("/v1/workflows/instances", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:instance:read"))) return;
    const a = actor(req),
      q = req.query as any;
    return (
      await pool.query(
        `SELECT DISTINCT i.id,i.status,i.version,i.entity_type,i.entity_id,i.organization_id,i.started_at,i.updated_at,d.key definition_key,d.name definition_name,v.version_number,s.step_key current_state FROM workflow_instance i JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$4 AND m.status='active' JOIN workflow_definition_permission dp ON dp.tenant_id=i.tenant_id AND dp.definition_id=i.definition_id AND dp.command_type='read' JOIN permission p ON p.tenant_id=dp.tenant_id AND p.name=dp.permission_name JOIN role_permission rp ON rp.permission_id=p.id AND rp.role_id=m.role_id JOIN workflow_definition d ON d.tenant_id=i.tenant_id AND d.id=i.definition_id JOIN workflow_version v ON v.tenant_id=i.tenant_id AND v.id=i.version_id LEFT JOIN workflow_step_definition s ON s.tenant_id=i.tenant_id AND s.id=i.current_step_definition_id WHERE i.tenant_id=$1 ORDER BY i.updated_at DESC LIMIT $2 OFFSET $3`,
        [
          a.tenantId,
          Math.min(Number(q.limit ?? 50), 100),
          Math.max(Number(q.offset ?? 0), 0),
          a.userId,
        ],
      )
    ).rows;
  });
  app.post("/v1/workflows/instances", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:instance:start"))) return;
    return reply
      .status(202)
      .send(
        await engine.startInstance(
          actor(req).tenantId,
          actor(req).userId,
          commandKey(req),
          req.body as any,
        ),
      );
  });
  app.get("/v1/workflows/instances/:id", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:instance:read"))) return;
    const a = actor(req),
      id = (req.params as any).id;
    if (!(await definitionCommandAllowed(pool, req, reply, id, "read"))) return;
    const result = await pool.query(
      `SELECT i.*,d.key definition_key,d.name definition_name,v.version_number,s.step_key current_state FROM workflow_instance i JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$3 AND m.status='active' JOIN workflow_definition d ON d.tenant_id=i.tenant_id AND d.id=i.definition_id JOIN workflow_version v ON v.tenant_id=i.tenant_id AND v.id=i.version_id LEFT JOIN workflow_step_definition s ON s.tenant_id=i.tenant_id AND s.id=i.current_step_definition_id WHERE i.tenant_id=$1 AND i.id=$2`,
      [a.tenantId, id, a.userId],
    );
    if (!result.rowCount)
      throw new WorkflowError(
        "WF_NOT_FOUND",
        404,
        "Workflow instance not found",
      );
    const [work, timers] = await Promise.all([
      pool.query(
        `SELECT id,status,version,assignment_type,claimed_by,due_at FROM workflow_work_item WHERE tenant_id=$1 AND instance_id=$2 AND status IN ('open','claimed','in_progress')`,
        [a.tenantId, id],
      ),
      pool.query(
        `SELECT id,timer_type,due_at,status FROM workflow_timer WHERE tenant_id=$1 AND instance_id=$2 AND status IN ('pending','leased')`,
        [a.tenantId, id],
      ),
    ]);
    return { ...result.rows[0], workItems: work.rows, timers: timers.rows };
  });
  app.get("/v1/workflows/instances/:id/events", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:audit:read"))) return;
    const a = actor(req);
    if (
      !(await definitionCommandAllowed(
        pool,
        req,
        reply,
        (req.params as any).id,
        "read",
      ))
    )
      return;
    return (
      await pool.query(
        `SELECT e.id,e.sequence_number,e.event_type,e.actor_type,e.actor_id,e.metadata,e.created_at FROM workflow_event e JOIN workflow_instance i ON i.tenant_id=e.tenant_id AND i.id=e.instance_id JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$3 AND m.status='active' WHERE e.tenant_id=$1 AND e.instance_id=$2 ORDER BY e.sequence_number LIMIT 200`,
        [a.tenantId, (req.params as any).id, a.userId],
      )
    ).rows;
  });
  app.post("/v1/workflows/instances/:id/transition", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:work-item:complete")))
      return;
    const body = req.body as any;
    return engine.transition(
      actor(req).tenantId,
      actor(req).userId,
      commandKey(req),
      {
        ...body,
        instanceId: (req.params as any).id,
        expectedVersion: expected(req, body),
        organizationId: body.organizationId,
      },
    );
  });
  for (const action of ["suspend", "resume", "cancel"] as const)
    app.post(`/v1/workflows/instances/:id/${action}`, async (req, reply) => {
      if (!(await allowed(pool, req, reply, `workflow:instance:${action}`)))
        return;
      const a = actor(req),
        id = (req.params as any).id,
        body = req.body as any,
        next =
          action === "suspend"
            ? "suspended"
            : action === "resume"
              ? "running"
              : "cancelled";
      const states =
        action === "resume"
          ? ["suspended"]
          : [
              "running",
              "waiting",
              "active",
              ...(action === "cancel" ? ["suspended", "pending"] : []),
            ];
      if (!(await definitionCommandAllowed(pool, req, reply, id, action)))
        return;
      const result = await pool.query(
        `UPDATE workflow_instance i SET status=$1,version=i.version+1,updated_at=NOW(),suspended_at=CASE WHEN $1='suspended' THEN NOW() ELSE i.suspended_at END,cancelled_at=CASE WHEN $1='cancelled' THEN NOW() ELSE i.cancelled_at END FROM organization o,membership m,workflow_definition_permission dp,permission p,role_permission rp WHERE i.tenant_id=$2 AND i.id=$3 AND i.version=$4 AND i.status=ANY($5) AND i.organization_id=$6 AND o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' AND m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$7 AND m.status='active' AND dp.tenant_id=i.tenant_id AND dp.definition_id=i.definition_id AND dp.command_type=$8 AND p.tenant_id=dp.tenant_id AND p.name=dp.permission_name AND rp.permission_id=p.id AND rp.role_id=m.role_id RETURNING i.id,i.status,i.version`,
        [
          next,
          a.tenantId,
          id,
          expected(req, body),
          states,
          body.organizationId,
          a.userId,
          action,
        ],
      );
      if (!result.rowCount)
        throw new WorkflowError(
          "WF_VERSION_CONFLICT",
          409,
          "Instance state or version conflict",
        );
      return result.rows[0];
    });
  app.get("/v1/work-items", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:work-item:read"))) return;
    const a = actor(req),
      q = req.query as any;
    return (
      await pool.query(
        `SELECT w.id,w.instance_id,w.status,w.version,w.assignment_type,w.organization_id,w.assignee_user_id,w.claimed_by,w.due_at,s.step_key,d.name definition_name FROM workflow_work_item w JOIN organization o ON o.tenant_id=w.tenant_id AND o.id=w.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$3 AND m.status='active' JOIN workflow_step_execution e ON e.tenant_id=w.tenant_id AND e.id=w.step_execution_id JOIN workflow_step_definition s ON s.tenant_id=e.tenant_id AND s.id=e.step_definition_id JOIN workflow_instance i ON i.tenant_id=w.tenant_id AND i.id=w.instance_id JOIN workflow_definition d ON d.tenant_id=i.tenant_id AND d.id=i.definition_id WHERE w.tenant_id=$1 AND w.status=ANY($2) AND (w.assignee_user_id IS NULL OR w.assignee_user_id=$3) ORDER BY w.due_at NULLS LAST,w.created_at LIMIT $4`,
        [
          a.tenantId,
          q.status ? [String(q.status)] : ["open", "claimed", "in_progress"],
          a.userId,
          Math.min(Number(q.limit ?? 50), 100),
        ],
      )
    ).rows;
  });
  app.get("/v1/work-items/:id", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:work-item:read"))) return;
    const a = actor(req),
      id = (req.params as any).id;
    const r = await pool.query(
      `SELECT w.* FROM workflow_work_item w JOIN organization o ON o.tenant_id=w.tenant_id AND o.id=w.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$3 AND m.status='active' WHERE w.tenant_id=$1 AND w.id=$2`,
      [a.tenantId, id, a.userId],
    );
    if (!r.rowCount)
      throw new WorkflowError("WF_NOT_FOUND", 404, "Work item not found");
    return r.rows[0];
  });
  app.get("/v1/work-items/:id/history", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:audit:read"))) return;
    const a = actor(req),
      id = (req.params as any).id;
    const r = await pool.query(
      `SELECT h.* FROM workflow_work_item w JOIN organization o ON o.tenant_id=w.tenant_id AND o.id=w.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$3 AND m.status='active' JOIN workflow_work_item_history h ON h.tenant_id=w.tenant_id AND h.work_item_id=w.id WHERE w.tenant_id=$1 AND w.id=$2 ORDER BY h.created_at`,
      [a.tenantId, id, a.userId],
    );
    if (!r.rowCount) {
      const visible = await pool.query(
        `SELECT 1 FROM workflow_work_item w JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$3 AND m.status='active' WHERE w.tenant_id=$1 AND w.id=$2`,
        [a.tenantId, id, a.userId],
      );
      if (!visible.rowCount)
        throw new WorkflowError("WF_NOT_FOUND", 404, "Work item not found");
    }
    return r.rows;
  });
  app.post("/v1/work-items/:id/claim", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:work-item:claim"))) return;
    return engine.claimWorkItem(
      actor(req).tenantId,
      actor(req).userId,
      (req.params as any).id,
      expected(req, req.body),
    );
  });
  for (const action of [
    "accept",
    "release",
    "assign",
    "reassign",
    "cancel",
  ] as const)
    app.post(`/v1/work-items/:id/${action}`, async (req, reply) => {
      const permission =
        action === "reassign"
          ? "workflow:work-item:reassign"
          : action === "cancel"
            ? "workflow:work-item:cancel"
            : action === "accept"
              ? "workflow:work-item:accept"
              : action === "release"
                ? "workflow:work-item:claim"
                : "workflow:work-item:assign";
      if (!(await allowed(pool, req, reply, permission))) return;
      const a = actor(req),
        id = (req.params as any).id,
        body = req.body as any,
        c = await pool.connect();
      try {
        await c.query("BEGIN");
        const w = await c.query(
          `SELECT w.* FROM workflow_work_item w JOIN organization o ON o.tenant_id=w.tenant_id AND o.id=w.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=w.tenant_id AND m.organization_id=w.organization_id AND m.user_id=$3 AND m.status='active' WHERE w.tenant_id=$1 AND w.id=$2 AND w.version=$4 FOR UPDATE OF w`,
          [a.tenantId, id, a.userId, expected(req, body)],
        );
        if (!w.rowCount)
          throw new WorkflowError("WF_NOT_FOUND", 404, "Work item not found");
        let status = w.rows[0].status,
          userId = w.rows[0].assignee_user_id;
        if (action === "accept") {
          if (status !== "claimed" || w.rows[0].claimed_by !== a.userId)
            throw new WorkflowError(
              "WF_WORK_ITEM_STALE",
              409,
              "Work item is not claimable",
            );
          status = "in_progress";
        } else if (action === "release") {
          if (status !== "claimed" || w.rows[0].claimed_by !== a.userId)
            throw new WorkflowError(
              "WF_WORK_ITEM_STALE",
              409,
              "Work item is not owned",
            );
          status = "open";
        } else if (action === "cancel") {
          if (!["open", "claimed", "in_progress"].includes(status))
            throw new WorkflowError(
              "WF_WORK_ITEM_STALE",
              409,
              "Work item is terminal",
            );
          status = "cancelled";
        } else {
          if (!body.userId)
            throw new WorkflowError(
              "WF_ASSIGNEE_REQUIRED",
              422,
              "Assignee is required",
            );
          const target = await c.query(
            `SELECT 1 FROM membership m JOIN user_account u ON u.tenant_id=m.tenant_id AND u.id=m.user_id AND u.status='active' WHERE m.tenant_id=$1 AND m.organization_id=$2 AND m.user_id=$3 AND m.status='active'`,
            [a.tenantId, w.rows[0].organization_id, body.userId],
          );
          if (!target.rowCount)
            throw new WorkflowError(
              "WF_ASSIGNEE_INELIGIBLE",
              422,
              "Assignee is not active in this organization",
            );
          userId = body.userId;
          status = "open";
        }
        const updated = await c.query(
          `UPDATE workflow_work_item SET status=$1,assignee_user_id=$2,claimed_by=CASE WHEN $1='open' THEN NULL ELSE claimed_by END,claimed_at=CASE WHEN $1='open' THEN NULL ELSE claimed_at END,version=version+1,updated_at=NOW() WHERE tenant_id=$3 AND id=$4 RETURNING *`,
          [status, userId, a.tenantId, id],
        );
        await c.query(
          `INSERT INTO workflow_work_item_history(tenant_id,work_item_id,action,actor_id,from_user_id,to_user_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            a.tenantId,
            id,
            action,
            a.userId,
            w.rows[0].assignee_user_id,
            userId,
            body.reason ?? null,
          ],
        );
        if (action === "cancel")
          await c.query(
            `UPDATE workflow_step_execution SET status='cancelled',version=version+1 WHERE tenant_id=$1 AND id=$2 AND status=ANY($3)`,
            [
              a.tenantId,
              w.rows[0].step_execution_id,
              ["ready", "claimed", "running", "waiting"],
            ],
          );
        await c.query("COMMIT");
        return updated.rows[0];
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    });
  app.post("/v1/workflows/recommendations/:id/accept", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:recommendation:decide")))
      return;
    const a = actor(req),
      body = req.body as any;
    return engine.decideRecommendation(
      a.tenantId,
      body.organizationId,
      a.userId,
      (req.params as any).id,
      expected(req, body),
      "accepted",
      commandKey(req),
    );
  });
  app.post("/v1/workflows/recommendations/:id/reject", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:recommendation:decide")))
      return;
    const a = actor(req),
      body = req.body as any;
    return engine.decideRecommendation(
      a.tenantId,
      body.organizationId,
      a.userId,
      (req.params as any).id,
      expected(req, body),
      "rejected",
      commandKey(req),
      body.reason,
    );
  });
  app.get("/v1/workflows/operations", async (req, reply) => {
    if (!(await allowed(pool, req, reply, "workflow:operations:read"))) return;
    const a = actor(req);
    return (
      await pool.query(
        `WITH visible AS (SELECT DISTINCT i.id FROM workflow_instance i JOIN organization o ON o.tenant_id=i.tenant_id AND o.id=i.organization_id AND o.status='active' JOIN membership m ON m.tenant_id=i.tenant_id AND m.organization_id=i.organization_id AND m.user_id=$2 AND m.status='active' WHERE i.tenant_id=$1) SELECT (SELECT count(*)::int FROM workflow_instance i JOIN visible v ON v.id=i.id WHERE i.status IN ('running','waiting','active')) active_instances,(SELECT count(*)::int FROM workflow_work_item w JOIN visible v ON v.id=w.instance_id WHERE w.status='open') open_work_items,(SELECT count(*)::int FROM workflow_timer t JOIN visible v ON v.id=t.instance_id WHERE t.status='pending' AND t.due_at<=NOW()) due_timers,(SELECT count(*)::int FROM workflow_sla_clock s JOIN visible v ON v.id=s.instance_id WHERE s.state='breached') breached_slas`,
        [a.tenantId, a.userId],
      )
    ).rows[0];
  });
}
