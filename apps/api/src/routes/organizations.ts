import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { encryptPayload } from "@govos/core";
import { buildInvitationActivationUrl } from "@govos/core/invitation-routes";
import { ORGANIZATION_ADMIN_ASSIGNABLE_ROLES } from "@govos/core/tenant-role-catalog";
type Actor = { userId: string; tenantId: string; roles: string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
  EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const actor = (r: FastifyRequest) => r.user as Actor;
async function permission(
  pool: Pool,
  r: FastifyRequest,
  reply: FastifyReply,
  name: string,
) {
  const a = actor(r),
    q = await pool.query(
      `SELECT 1 FROM membership m JOIN role ro ON ro.id=m.role_id AND ro.tenant_id=m.tenant_id JOIN role_permission rp ON rp.role_id=ro.id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=ro.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND p.name=$3 LIMIT 1`,
      [a.tenantId, a.userId, name],
    );
  if (!q.rowCount) {
    reply.status(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}
async function scope(
  pool: Pool,
  a: Actor,
  organizationId: string,
  write = false,
) {
  const q = await pool.query(
    `SELECT o.id,o.status,o.version,ro.name actor_role,m.organization_id actor_organization FROM organization o JOIN membership m ON m.tenant_id=o.tenant_id AND m.user_id=$2 AND m.status='active' JOIN role ro ON ro.id=m.role_id AND ro.tenant_id=m.tenant_id WHERE o.tenant_id=$1 AND o.id=$3 AND o.deleted_at IS NULL AND (ro.name='super_admin' OR (ro.name='organization_admin' AND m.organization_id=o.id)) LIMIT 1`,
    [a.tenantId, a.userId, organizationId],
  );
  const row = q.rows[0];
  if (!row || (write && row.status === "archived")) return null;
  return row;
}
async function audit(
  c: PoolClient,
  a: Actor,
  action: string,
  resource: string,
  ids: object,
  result = "allow",
) {
  await c.query(
    `INSERT INTO authz_audit_log(tenant_id,user_id,action,resource,result,context) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [a.tenantId, a.userId, action, resource, result, JSON.stringify(ids)],
  );
}
async function role(c: PoolClient, tenantId: string, roleId: string) {
  return (
    await c.query("SELECT id,name FROM role WHERE tenant_id=$1 AND id=$2", [
      tenantId,
      roleId,
    ])
  ).rows[0];
}
async function enqueue(c: PoolClient, input: any) {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key))
    throw new Error("Notification encryption unavailable");
  const encrypted = encryptPayload(
    {
      invitationId: input.id,
      recipientEmail: input.email,
      activationUrl: buildInvitationActivationUrl(
        process.env.PUBLIC_WEB_URL || "http://localhost:3000",
        input.token,
      ),
      expiresAt: input.expires.toISOString(),
      tenantName: input.tenantName,
    },
    key,
    "v1",
  );
  const task = `task-${crypto.randomUUID()}`;
  await c.query(
    `INSERT INTO task_execution(tenant_id,task_id,task_type,payload_hash,status,available_at,attempt_count,max_attempts,encrypted_payload) VALUES($1,$2,'govos.notification.invitation.send',$3,'pending',NOW(),0,5,$4)`,
    [input.tenantId, task, input.hash, JSON.stringify(encrypted)],
  );
  return task;
}
export function organizationRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  app.get("/organizations", async (r, reply) => {
    if (!(await permission(pool, r, reply, "org:read"))) return;
    const a = actor(r);
    return (
      await pool.query(
        `SELECT DISTINCT o.id,o.tenant_id "tenantId",o.name,o.status,o.version,o.created_at "createdAt",COUNT(om.id) FILTER(WHERE om.status='active') OVER(PARTITION BY o.id)::int "activeUserCount" FROM organization o JOIN membership am ON am.tenant_id=o.tenant_id AND am.user_id=$2 AND am.status='active' JOIN role ar ON ar.id=am.role_id AND ar.tenant_id=am.tenant_id LEFT JOIN membership om ON om.tenant_id=o.tenant_id AND om.organization_id=o.id WHERE o.tenant_id=$1 AND o.deleted_at IS NULL AND (ar.name='super_admin' OR (ar.name='organization_admin' AND am.organization_id=o.id)) ORDER BY o.name`,
        [a.tenantId, a.userId],
      )
    ).rows;
  });
  app.get("/organizations/:id", async (r, reply) => {
    if (!(await permission(pool, r, reply, "org:read"))) return;
    const a = actor(r),
      { id } = r.params as any,
      s = await scope(pool, a, id);
    if (!s) return reply.status(404).send({ error: "Organization not found" });
    return (
      await pool.query(
        `SELECT o.id,o.name,o.status,o.version,o.created_at "createdAt",o.updated_at "updatedAt",o.archived_at "archivedAt",COUNT(m.id) FILTER(WHERE m.status='active')::int "activeUserCount" FROM organization o LEFT JOIN membership m ON m.tenant_id=o.tenant_id AND m.organization_id=o.id WHERE o.tenant_id=$1 AND o.id=$2 GROUP BY o.id`,
        [a.tenantId, id],
      )
    ).rows[0];
  });
  app.post("/organizations", async (r, reply) => {
    if (!(await permission(pool, r, reply, "org:write"))) return;
    const a = actor(r);
    if (!a.roles.includes("super_admin"))
      return reply.status(403).send({ error: "Forbidden" });
    const { name } = r.body as any;
    if (!name?.trim() || name.trim().length < 2)
      return reply.status(400).send({ error: "Valid name required" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          "INSERT INTO organization(tenant_id,name,status) VALUES($1,$2,'active') RETURNING id,name,status,version",
          [a.tenantId, name.trim()],
        )
      ).rows[0];
      await audit(c, a, "ORGANIZATION_CREATED", `organization:${row.id}`, {
        organizationId: row.id,
      });
      await c.query("COMMIT");
      return reply.status(201).send(row);
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Organization could not be created" });
    } finally {
      c.release();
    }
  });
  app.patch("/organizations/:id", async (r, reply) => {
    if (!(await permission(pool, r, reply, "org:write"))) return;
    const a = actor(r),
      { id } = r.params as any,
      b = r.body as any,
      s = await scope(pool, a, id, true);
    if (!s) return reply.status(404).send({ error: "Organization not found" });
    if (
      !Number.isInteger(b.expectedVersion) ||
      !b.reason?.trim() ||
      (!b.name && !b.status)
    )
      return reply.status(400).send({ error: "Invalid update" });
    if (b.status === "archived" && !a.roles.includes("super_admin"))
      return reply.status(403).send({ error: "Forbidden" });
    if (b.status && !["active", "suspended", "archived"].includes(b.status))
      return reply.status(400).send({ error: "Invalid status" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const current = (
        await c.query(
          "SELECT status,version FROM organization WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, id],
        )
      ).rows[0];
      if (current.version !== b.expectedVersion) {
        await c.query("ROLLBACK");
        return reply
          .status(409)
          .send({ error: "Organization version conflict" });
      }
      if (b.status === "archived") {
        const active = Number(
          (
            await c.query(
              "SELECT COUNT(*) count FROM membership WHERE tenant_id=$1 AND organization_id=$2 AND status IN('active','invited')",
              [a.tenantId, id],
            )
          ).rows[0].count,
        );
        if (active) {
          await c.query("ROLLBACK");
          return reply.status(422).send({
            error: "Organization with current users cannot be archived",
          });
        }
      }
      const row = (
        await c.query(
          `UPDATE organization SET name=COALESCE($1,name),status=COALESCE($2,status),archived_at=CASE WHEN $2='archived' THEN NOW() WHEN $2='active' THEN NULL ELSE archived_at END,version=version+1,updated_at=NOW() WHERE tenant_id=$3 AND id=$4 AND version=$5 RETURNING id,name,status,version`,
          [
            b.name?.trim() || null,
            b.status || null,
            a.tenantId,
            id,
            b.expectedVersion,
          ],
        )
      ).rows[0];
      if (b.status === "suspended")
        await c.query(
          "DELETE FROM session s USING membership m WHERE s.tenant_id=$1 AND s.user_id=m.user_id AND m.tenant_id=$1 AND m.organization_id=$2",
          [a.tenantId, id],
        );
      await audit(
        c,
        a,
        b.status === "archived"
          ? "ORGANIZATION_ARCHIVED"
          : "ORGANIZATION_UPDATED",
        `organization:${id}`,
        { organizationId: id, reason: b.reason.trim() },
      );
      await c.query("COMMIT");
      return row;
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Organization could not be updated" });
    } finally {
      c.release();
    }
  });
  app.get("/organizations/:id/users", async (r, reply) => {
    if (!(await permission(pool, r, reply, "user:read"))) return;
    const a = actor(r),
      { id } = r.params as any;
    if (!(await scope(pool, a, id)))
      return reply.status(404).send({ error: "Organization not found" });
    return (
      await pool.query(
        `SELECT u.id,u.first_name "firstName",u.last_name "lastName",u.email,u.status "accountStatus",m.status "membershipStatus",m.version "membershipVersion",ro.id "roleId",ro.name "roleName" FROM membership m JOIN user_account u ON u.id=m.user_id AND u.tenant_id=m.tenant_id JOIN role ro ON ro.id=m.role_id AND ro.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.organization_id=$2 AND m.status IN('active','invited') ORDER BY u.last_name,u.first_name`,
        [a.tenantId, id],
      )
    ).rows;
  });
  app.post("/organizations/:id/users", async (r, reply) =>
    membershipMutation(pool, r, reply, "add"),
  );
  app.patch("/organizations/:id/users/:userId", async (r, reply) =>
    membershipMutation(pool, r, reply, "update"),
  );
  app.post("/organizations/:id/users/:userId/transfer", async (r, reply) =>
    membershipMutation(pool, r, reply, "transfer"),
  );
  app.delete("/organizations/:id/users/:userId", async (r, reply) =>
    membershipMutation(pool, r, reply, "remove"),
  );
  app.get("/organizations/:id/invitations", async (r, reply) => {
    if (!(await permission(pool, r, reply, "invitation:read"))) return;
    const a = actor(r),
      { id } = r.params as any;
    if (!(await scope(pool, a, id)))
      return reply.status(404).send({ error: "Organization not found" });
    return (
      await pool.query(
        `SELECT i.id,i.display_email email,i.status,i.expires_at "expiresAt",ro.name "roleName" FROM user_invitation i JOIN role ro ON ro.id=i.role_id AND ro.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.organization_id=$2 AND i.invitation_type='tenant_user_activation' ORDER BY i.created_at DESC`,
        [a.tenantId, id],
      )
    ).rows;
  });
  app.post("/organizations/:id/invitations", async (r, reply) => {
    if (!(await permission(pool, r, reply, "invitation:create"))) return;
    const a = actor(r),
      { id } = r.params as any,
      b = r.body as any,
      s = await scope(pool, a, id, true);
    if (!s) return reply.status(404).send({ error: "Organization not found" });
    if (
      !EMAIL.test(b.email || "") ||
      !b.firstName?.trim() ||
      !b.lastName?.trim() ||
      !UUID.test(b.roleId || "")
    )
      return reply.status(400).send({ error: "Invalid invitation" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const ro = await role(c, a.tenantId, b.roleId),
        delegated = s.actor_role === "organization_admin";
      if (
        !ro ||
        ro.name === "super_admin" ||
        ro.name === "organization_admin" ||
        (delegated &&
          !ORGANIZATION_ADMIN_ASSIGNABLE_ROLES.includes(ro.name as any))
      ) {
        await audit(
          c,
          a,
          "DELEGATED_ACTION_DENIED",
          `organization:${id}`,
          { organizationId: id, roleId: b.roleId },
          "deny",
        );
        await c.query("COMMIT");
        return reply.status(403).send({ error: "Role is not assignable" });
      }
      const email = b.email.trim().toLowerCase();
      if (
        (
          await c.query(
            "SELECT 1 FROM user_invitation WHERE tenant_id=$1 AND organization_id=$2 AND email_normalized=$3 AND status='pending'",
            [a.tenantId, id, email],
          )
        ).rowCount
      ) {
        await c.query("ROLLBACK");
        return reply.status(409).send({ error: "Pending invitation exists" });
      }
      let user = (
        await c.query(
          "SELECT id,status FROM user_account WHERE tenant_id=$1 AND email=$2 AND deleted_at IS NULL FOR UPDATE",
          [a.tenantId, email],
        )
      ).rows[0];
      if (!user) {
        user = { id: crypto.randomUUID(), status: "invited" };
        await c.query(
          "INSERT INTO user_account(id,tenant_id,email,password_hash,first_name,last_name,status) VALUES($1,$2,$3,$4,$5,$6,'invited')",
          [
            user.id,
            a.tenantId,
            email,
            `invited-placeholder-${crypto.randomBytes(16).toString("hex")}`,
            b.firstName.trim(),
            b.lastName.trim(),
          ],
        );
      }
      if (
        (
          await c.query(
            "SELECT 1 FROM membership WHERE tenant_id=$1 AND user_id=$2 AND status IN('active','invited')",
            [a.tenantId, user.id],
          )
        ).rowCount
      ) {
        await c.query("ROLLBACK");
        return reply.status(409).send({ error: "Current membership exists" });
      }
      await c.query(
        "INSERT INTO membership(tenant_id,user_id,organization_id,role_id,status) VALUES($1,$2,$3,$4,'invited')",
        [a.tenantId, user.id, id, ro.id],
      );
      const raw = crypto.randomBytes(32).toString("base64url"),
        hash = crypto.createHash("sha256").update(raw).digest("hex"),
        invitationId = crypto.randomUUID(),
        expires = new Date(Date.now() + 86400000);
      await c.query(
        `INSERT INTO user_invitation(id,tenant_id,organization_id,email_normalized,display_email,invitation_type,role_id,token_hash,status,expires_at,created_by,updated_at) VALUES($1,$2,$3,$4,$5,'tenant_user_activation',$6,$7,'pending',$8,$9,NOW())`,
        [
          invitationId,
          a.tenantId,
          id,
          email,
          b.email.trim(),
          ro.id,
          hash,
          expires,
          a.userId,
        ],
      );
      const tenant = (
          await c.query("SELECT name FROM tenant WHERE id=$1", [a.tenantId])
        ).rows[0],
        taskId = await enqueue(c, {
          id: invitationId,
          email,
          token: raw,
          hash,
          expires,
          tenantId: a.tenantId,
          tenantName: tenant.name,
        });
      await audit(
        c,
        a,
        "ORGANIZATION_INVITATION_CREATED",
        `invitation:${invitationId}`,
        { organizationId: id, invitationId, roleId: ro.id, taskId },
      );
      await c.query("COMMIT");
      return reply
        .status(201)
        .send({ id: invitationId, status: "pending", taskId });
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Invitation could not be created" });
    } finally {
      c.release();
    }
  });
  app.post("/organizations/:id/administrators", async (r, reply) => {
    if (!(await permission(pool, r, reply, "user:membership:update"))) return;
    const a = actor(r),
      { id } = r.params as { id: string },
      body = r.body as {
        userId?: string;
        expectedVersion?: number;
        reason?: string;
      };
    if (!a.roles.includes("super_admin"))
      return reply.status(403).send({ error: "Forbidden" });
    if (
      !UUID.test(body.userId || "") ||
      !Number.isInteger(body.expectedVersion) ||
      !body.reason?.trim()
    )
      return reply
        .status(400)
        .send({ error: "Invalid administrator assignment" });
    if (!(await scope(pool, a, id, true)))
      return reply.status(404).send({ error: "Organization not found" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const membership = (
        await c.query(
          `SELECT m.id,m.version,m.organization_id,r.name role_name FROM membership m JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' FOR UPDATE OF m`,
          [a.tenantId, body.userId],
        )
      ).rows[0];
      if (!membership || membership.organization_id !== id) {
        await c.query("ROLLBACK");
        return reply.status(404).send({ error: "Membership not found" });
      }
      if (membership.version !== body.expectedVersion) {
        await c.query("ROLLBACK");
        return reply.status(409).send({ error: "Membership version conflict" });
      }
      if (membership.role_name === "super_admin") {
        await c.query("ROLLBACK");
        return reply
          .status(403)
          .send({ error: "Protected tenant administrator" });
      }
      const adminRole = (
        await c.query(
          "SELECT id FROM role WHERE tenant_id=$1 AND name='organization_admin'",
          [a.tenantId],
        )
      ).rows[0];
      if (!adminRole)
        throw new Error("Organization administrator role unavailable");
      await c.query(
        "UPDATE membership SET role_id=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND version=$4",
        [adminRole.id, a.tenantId, membership.id, body.expectedVersion],
      );
      await c.query("DELETE FROM session WHERE tenant_id=$1 AND user_id=$2", [
        a.tenantId,
        body.userId,
      ]);
      await audit(
        c,
        a,
        "ORGANIZATION_ADMIN_ASSIGNED",
        `membership:${membership.id}`,
        {
          organizationId: id,
          userId: body.userId,
          membershipId: membership.id,
          roleId: adminRole.id,
          reason: body.reason.trim(),
        },
      );
      await c.query("COMMIT");
      return reply.send({
        userId: body.userId,
        membershipVersion: body.expectedVersion! + 1,
      });
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Administrator could not be assigned" });
    } finally {
      c.release();
    }
  });
  done();
}
async function membershipMutation(
  pool: Pool,
  r: FastifyRequest,
  reply: FastifyReply,
  kind: "add" | "update" | "transfer" | "remove",
) {
  if (!(await permission(pool, r, reply, "user:membership:update"))) return;
  const a = actor(r),
    { id, userId: paramUser } = r.params as any,
    b = r.body as any,
    userId = paramUser || b.userId,
    s = await scope(pool, a, id, true);
  if (!s) return reply.status(404).send({ error: "Organization not found" });
  if (!UUID.test(userId || "") || !b.reason?.trim())
    return reply.status(400).send({ error: "Invalid membership request" });
  if (kind === "transfer" && !a.roles.includes("super_admin"))
    return reply.status(403).send({ error: "Forbidden" });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    let m = (
      await c.query(
        `SELECT m.id,m.organization_id,m.role_id,m.status,m.version,ro.name role_name FROM membership m JOIN role ro ON ro.id=m.role_id AND ro.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status IN('active','invited') FOR UPDATE OF m`,
        [a.tenantId, userId],
      )
    ).rows[0];
    if (kind === "add" && m) {
      await c.query("ROLLBACK");
      return reply
        .status(409)
        .send({ error: "Use transfer for an existing membership" });
    }
    if (kind !== "add" && (!m || m.organization_id !== id)) {
      await c.query("ROLLBACK");
      return reply.status(404).send({ error: "Membership not found" });
    }
    if (kind !== "add" && m.version !== b.expectedVersion) {
      await c.query("ROLLBACK");
      return reply.status(409).send({ error: "Membership version conflict" });
    }
    let ro = b.roleId ? await role(c, a.tenantId, b.roleId) : null,
      delegated = s.actor_role === "organization_admin";
    if (
      ro &&
      (ro.name === "super_admin" ||
        ro.name === "organization_admin" ||
        (delegated &&
          !ORGANIZATION_ADMIN_ASSIGNABLE_ROLES.includes(ro.name as any)))
    ) {
      await audit(
        c,
        a,
        "DELEGATED_ACTION_DENIED",
        `organization:${id}`,
        { organizationId: id, userId, roleId: b.roleId },
        "deny",
      );
      await c.query("COMMIT");
      return reply.status(403).send({ error: "Role is not assignable" });
    }
    if (kind === "add") {
      if (!ro) {
        await c.query("ROLLBACK");
        return reply.status(400).send({ error: "Role required" });
      }
      m = (
        await c.query(
          "INSERT INTO membership(tenant_id,user_id,organization_id,role_id,status) SELECT $1,u.id,$3,$4,'active' FROM user_account u WHERE u.tenant_id=$1 AND u.id=$2 AND u.status='active' RETURNING id,version",
          [a.tenantId, userId, id, ro.id],
        )
      ).rows[0];
      if (!m) {
        await c.query("ROLLBACK");
        return reply.status(404).send({ error: "User not found" });
      }
    } else if (kind === "transfer") {
      const target = b.targetOrganizationId;
      if (!UUID.test(target || "") || !(await scope(pool, a, target, true))) {
        await c.query("ROLLBACK");
        return reply
          .status(404)
          .send({ error: "Target organization not found" });
      }
      await c.query(
        "UPDATE membership SET organization_id=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND version=$4",
        [target, a.tenantId, m.id, b.expectedVersion],
      );
    } else if (kind === "remove") {
      if (m.role_name === "organization_admin") {
        const admins = Number(
          (
            await c.query(
              `SELECT COUNT(*) count FROM membership x JOIN role xr ON xr.id=x.role_id AND xr.tenant_id=x.tenant_id WHERE x.tenant_id=$1 AND x.organization_id=$2 AND x.status='active' AND xr.name='organization_admin'`,
              [a.tenantId, id],
            )
          ).rows[0].count,
        );
        if (admins <= 1) {
          await c.query("ROLLBACK");
          return reply
            .status(422)
            .send({ error: "Final organization administrator is protected" });
        }
      }
      await c.query(
        "UPDATE membership SET status='revoked',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND version=$3",
        [a.tenantId, m.id, b.expectedVersion],
      );
    } else {
      const accountStatus = b.accountStatus;
      if (!ro && !["active", "suspended"].includes(accountStatus)) {
        await c.query("ROLLBACK");
        return reply
          .status(400)
          .send({ error: "Role or account status required" });
      }
      if (
        m.role_name === "organization_admin" &&
        !a.roles.includes("super_admin")
      ) {
        await c.query("ROLLBACK");
        return reply.status(403).send({ error: "Protected administrator" });
      }
      if (m.role_name === "organization_admin") {
        const admins = Number(
          (
            await c.query(
              `SELECT COUNT(*) count FROM membership x JOIN role xr ON xr.id=x.role_id AND xr.tenant_id=x.tenant_id WHERE x.tenant_id=$1 AND x.organization_id=$2 AND x.status='active' AND xr.name='organization_admin'`,
              [a.tenantId, id],
            )
          ).rows[0].count,
        );
        if (admins <= 1) {
          await c.query("ROLLBACK");
          return reply
            .status(422)
            .send({ error: "Final organization administrator is protected" });
        }
      }
      await c.query(
        "UPDATE membership SET role_id=COALESCE($1,role_id),version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND version=$4",
        [ro?.id || null, a.tenantId, m.id, b.expectedVersion],
      );
      if (accountStatus)
        await c.query(
          "UPDATE user_account SET status=$1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3",
          [accountStatus, a.tenantId, userId],
        );
    }
    const sessions = await c.query(
      "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, userId],
    );
    await audit(
      c,
      a,
      m.role_name === "organization_admin" &&
        (kind === "remove" || kind === "update")
        ? "ORGANIZATION_ADMIN_REMOVED"
        : kind === "add"
          ? "ORGANIZATION_MEMBERSHIP_ADDED"
          : kind === "remove"
            ? "ORGANIZATION_MEMBERSHIP_REMOVED"
            : kind === "transfer"
              ? "ORGANIZATION_MEMBERSHIP_TRANSFERRED"
              : "ORGANIZATION_MEMBERSHIP_UPDATED",
      `membership:${m.id}`,
      {
        organizationId: id,
        userId,
        membershipId: m.id,
        roleId: ro?.id || m.role_id,
        reason: b.reason.trim(),
        sessionRevocationCount: sessions.rowCount,
      },
    );
    await c.query("COMMIT");
    return reply.send({
      userId,
      membershipVersion: (m.version || b.expectedVersion) + 1,
    });
  } catch {
    await c.query("ROLLBACK");
    return reply.status(500).send({ error: "Membership could not be changed" });
  } finally {
    c.release();
  }
}
