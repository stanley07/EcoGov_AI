import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { encryptPayload } from "@govos/core";
import { ASSIGNABLE_TENANT_ROLES } from "@govos/core/tenant-role-catalog";
import { buildInvitationActivationUrl } from "@govos/core/invitation-routes";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SORT = new Set(["name", "email", "status", "role", "createdAt"]);
const INVITE_SORT = new Set(["createdAt", "expiresAt", "email", "status", "role"]);
const ROLE_SET = new Set<string>(ASSIGNABLE_TENANT_ROLES);

type Actor = { userId: string; tenantId: string; roles: string[] };
type Query = Record<string, string | undefined>;

function actor(req: FastifyRequest): Actor {
  if (!req.user) throw new Error("Authenticated actor missing");
  return req.user;
}

function paging(query: Query) {
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

async function requirePermission(pool: Pool, req: FastifyRequest, reply: FastifyReply, permission: string) {
  const current = actor(req);
  if (current.roles.includes("organization_admin")) {
    reply.status(403).send({ error: "Use organization-scoped administration" });
    return false;
  }
  const result = await pool.query(
    `SELECT 1 FROM membership m
     JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id
     JOIN role_permission rp ON rp.role_id=r.id
     JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id
     WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND p.name=$3 LIMIT 1`,
    [current.tenantId, current.userId, permission],
  );
  if (!result.rowCount) {
    reply.status(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}

function headers(reply: FastifyReply, total: number, limit: number, offset: number) {
  reply.header("X-Total-Count", String(total));
  reply.header("X-Limit", String(limit));
  reply.header("X-Offset", String(offset));
}

async function assertRole(client: PoolClient, tenantId: string, roleId: string) {
  const role = await client.query<{ id: string; name: string }>(
    "SELECT id,name FROM role WHERE tenant_id=$1 AND id=$2 FOR SHARE",
    [tenantId, roleId],
  );
  const row = role.rows[0];
  if (!row || !ROLE_SET.has(row.name)) throw Object.assign(new Error("Role is not assignable"), { statusCode: 403 });
  return row;
}

async function enqueueInvitation(client: PoolClient, input: {
  tenantId: string; tenantName: string; invitationId: string; email: string; rawToken: string; tokenHash: string; expiresAt: Date;
}) {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) throw new Error("Notification encryption is unavailable");
  const encrypted = encryptPayload({
    invitationId: input.invitationId,
    recipientEmail: input.email,
    activationUrl: buildInvitationActivationUrl(process.env.PUBLIC_WEB_URL || "http://localhost:3000", input.rawToken),
    expiresAt: input.expiresAt.toISOString(),
    tenantName: input.tenantName,
  }, encryptionKey, "v1");
  const taskId = `task-${crypto.randomUUID()}`;
  await client.query(`INSERT INTO task_execution
    (tenant_id,task_id,task_type,payload_hash,status,available_at,attempt_count,max_attempts,encrypted_payload)
    VALUES ($1,$2,'govos.notification.invitation.send',$3,'pending',NOW(),0,5,$4)`,
    [input.tenantId, taskId, input.tokenHash, JSON.stringify(encrypted)]);
  return taskId;
}

async function audit(client: PoolClient, tenantId: string, userId: string, action: string, resource: string, context: object) {
  await client.query(`INSERT INTO authz_audit_log (tenant_id,user_id,action,resource,result,context)
    VALUES ($1,$2,$3,$4,'allow',$5::jsonb)`, [tenantId, userId, action, resource, JSON.stringify(context)]);
}

export function tenantIamRoutes(app: FastifyInstance, { pool }: { pool: Pool }, done: () => void) {
  app.get("/users/roles", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "role:read"))) return;
    const current = actor(req);
    const result = await pool.query(`SELECT id,name,description FROM role
      WHERE tenant_id=$1 AND name=ANY($2::text[]) ORDER BY name`, [current.tenantId, [...ASSIGNABLE_TENANT_ROLES]]);
    return result.rows.map((row) => ({ ...row, displayName: row.name === "environmental_consultant" ? "Environmental Consultant / Subcontractor" : row.name.replaceAll("_", " ") }));
  });

  app.get("/users", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "user:read"))) return;
    const current = actor(req); const query = req.query as Query; const { limit, offset } = paging(query);
    const sort = SORT.has(query.sortBy || "") ? query.sortBy! : "name";
    const columns: Record<string, string> = { name: "u.last_name", email: "u.email", status: "u.status", role: "r.name", createdAt: "u.created_at" };
    const order = query.sortOrder === "desc" ? "DESC" : "ASC";
    const values: unknown[] = [current.tenantId]; const where = ["u.tenant_id=$1", "u.deleted_at IS NULL", "m.status IN ('active','invited')"];
    if (query.search) { values.push(`%${query.search.trim().toLowerCase()}%`); where.push(`(lower(u.email) LIKE $${values.length} OR lower(concat(u.first_name,' ',u.last_name)) LIKE $${values.length})`); }
    if (query.status) { values.push(query.status); where.push(`(u.status=$${values.length} OR m.status=$${values.length})`); }
    if (query.role) { values.push(query.role); where.push(`r.name=$${values.length}`); }
    if (query.organizationId) { values.push(query.organizationId); where.push(`m.organization_id=$${values.length}`); }
    const base = `FROM user_account u JOIN membership m ON m.tenant_id=u.tenant_id AND m.user_id=u.id JOIN role r ON r.tenant_id=m.tenant_id AND r.id=m.role_id LEFT JOIN organization o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id WHERE ${where.join(" AND ")}`;
    const total = Number((await pool.query(`SELECT COUNT(*)::text count ${base}`, values)).rows[0]?.count || 0);
    values.push(limit, offset);
    const rows = await pool.query(`SELECT u.id,u.first_name AS "firstName",u.last_name AS "lastName",u.email,u.status AS "accountStatus",m.status AS "membershipStatus",m.version AS "membershipVersion",r.id AS "roleId",r.name AS "roleName",o.id AS "organizationId",o.name AS "organizationName",u.created_at AS "createdAt" ${base} ORDER BY ${columns[sort]} ${order},u.id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    headers(reply, total, limit, offset); return rows.rows;
  });

  app.get("/users/:userId", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "user:read"))) return;
    const current = actor(req); const { userId } = req.params as { userId: string };
    const result = await pool.query(`SELECT u.id,u.first_name AS "firstName",u.last_name AS "lastName",u.email,u.status AS "accountStatus",m.status AS "membershipStatus",m.version AS "membershipVersion",r.id AS "roleId",r.name AS "roleName",o.id AS "organizationId",o.name AS "organizationName",u.created_at AS "createdAt"
      FROM user_account u JOIN membership m ON m.tenant_id=u.tenant_id AND m.user_id=u.id JOIN role r ON r.tenant_id=m.tenant_id AND r.id=m.role_id LEFT JOIN organization o ON o.tenant_id=m.tenant_id AND o.id=m.organization_id
      WHERE u.tenant_id=$1 AND u.id=$2 AND u.deleted_at IS NULL AND m.status IN ('active','invited')`, [current.tenantId, userId]);
    if (!result.rowCount) return reply.status(404).send({ error: "User not found" });
    return result.rows[0];
  });

  app.get("/users/invitations", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "invitation:read"))) return;
    const current = actor(req); const query = req.query as Query; const { limit, offset } = paging(query);
    const sort = INVITE_SORT.has(query.sortBy || "") ? query.sortBy! : "createdAt";
    const columns: Record<string, string> = { createdAt: "i.created_at", expiresAt: "i.expires_at", email: "i.display_email", status: "i.status", role: "r.name" };
    const order = query.sortOrder === "asc" ? "ASC" : "DESC";
    const values: unknown[] = [current.tenantId]; const where = ["i.tenant_id=$1", "i.invitation_type='tenant_user_activation'"];
    if (query.search) { values.push(`%${query.search.trim().toLowerCase()}%`); where.push(`lower(i.display_email) LIKE $${values.length}`); }
    if (query.status) { values.push(query.status); where.push(`i.status=$${values.length}`); }
    if (query.role) { values.push(query.role); where.push(`r.name=$${values.length}`); }
    const base = `FROM user_invitation i JOIN role r ON r.tenant_id=i.tenant_id AND r.id=i.role_id WHERE ${where.join(" AND ")}`;
    const total = Number((await pool.query(`SELECT COUNT(*)::text count ${base}`, values)).rows[0]?.count || 0);
    values.push(limit, offset);
    const rows = await pool.query(`SELECT i.id,i.display_email AS email,i.status,i.expires_at AS "expiresAt",i.created_at AS "createdAt",i.accepted_at AS "acceptedAt",i.revoked_at AS "revokedAt",i.superseded_at AS "supersededAt",r.id AS "roleId",r.name AS "roleName" ${base} ORDER BY ${columns[sort]} ${order},i.id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    headers(reply, total, limit, offset); return rows.rows;
  });

  app.get("/users/invitations/:invitationId", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "invitation:read"))) return;
    const current = actor(req); const { invitationId } = req.params as { invitationId: string };
    const result = await pool.query(`SELECT i.id,i.display_email AS email,i.status,i.expires_at AS "expiresAt",i.created_at AS "createdAt",r.id AS "roleId",r.name AS "roleName" FROM user_invitation i JOIN role r ON r.id=i.role_id AND r.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.id=$2 AND i.invitation_type='tenant_user_activation'`, [current.tenantId, invitationId]);
    if (!result.rowCount) return reply.status(404).send({ error: "Invitation not found" }); return result.rows[0];
  });

  app.post("/users/invitations", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "invitation:create"))) return;
    if (!(await requirePermission(pool, req, reply, "user:invite"))) return;
    const current = actor(req); const key = String(req.headers["idempotency-key"] || "");
    const body = req.body as { email?: string; firstName?: string; lastName?: string; roleId?: string; organizationId?: string };
    if (!key || key.length > 255 || !body.email || !EMAIL.test(body.email) || !body.firstName?.trim() || !body.lastName?.trim() || !body.roleId || !UUID.test(body.roleId)) return reply.status(400).send({ error: "Invalid invitation request" });
    if (body.organizationId) return reply.status(422).send({ error: "Organization-scoped roles are not assignable in Gate 3" });
    const email = body.email.trim().toLowerCase(); const requestHash = crypto.createHash("sha256").update(JSON.stringify({ email, firstName: body.firstName.trim(), lastName: body.lastName.trim(), roleId: body.roleId })).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const replay = await client.query<{ request_hash: string; response_status: number; response_payload: unknown }>("SELECT request_hash,response_status,response_payload FROM idempotency_record WHERE actor_user_id=$1 AND operation_name='tenant.invitation.create' AND idempotency_key=$2 FOR UPDATE", [current.userId, key]);
      if (replay.rows[0]) { if (replay.rows[0].request_hash !== requestHash) { await client.query("ROLLBACK"); return reply.status(409).send({ error: "Idempotency key conflict" }); } await client.query("ROLLBACK"); return reply.status(replay.rows[0].response_status || 201).send(replay.rows[0].response_payload); }
      const role = await assertRole(client, current.tenantId, body.roleId);
      const duplicate = await client.query("SELECT id FROM user_invitation WHERE tenant_id=$1 AND email_normalized=$2 AND invitation_type='tenant_user_activation' AND status='pending'", [current.tenantId, email]);
      if (duplicate.rowCount) { await client.query("ROLLBACK"); return reply.status(409).send({ error: "A pending invitation already exists" }); }
      const tenant = (await client.query<{ name: string }>("SELECT name FROM tenant WHERE id=$1 AND status='active' AND is_system=FALSE", [current.tenantId])).rows[0]; if (!tenant) throw new Error("Tenant unavailable");
      let user = (await client.query<{ id: string; status: string }>("SELECT id,status FROM user_account WHERE tenant_id=$1 AND email=$2 AND deleted_at IS NULL FOR UPDATE", [current.tenantId, email])).rows[0];
      if (user?.status === "active") { await client.query("ROLLBACK"); return reply.status(409).send({ error: "User already belongs to this tenant" }); }
      if (!user) { user = { id: crypto.randomUUID(), status: "invited" }; await client.query(`INSERT INTO user_account (id,tenant_id,email,password_hash,first_name,last_name,status) VALUES ($1,$2,$3,$4,$5,$6,'invited')`, [user.id,current.tenantId,email,`invited-placeholder-${crypto.randomBytes(16).toString("hex")}`,body.firstName.trim(),body.lastName.trim()]); }
      const membership = await client.query("SELECT id FROM membership WHERE tenant_id=$1 AND user_id=$2 AND status IN ('active','invited')", [current.tenantId,user.id]);
      if (membership.rowCount) { await client.query("ROLLBACK"); return reply.status(409).send({ error: "A current tenant membership already exists" }); }
      await client.query("INSERT INTO membership (tenant_id,user_id,role_id,status) VALUES ($1,$2,$3,'invited')", [current.tenantId,user.id,role.id]);
      const rawToken = crypto.randomBytes(32).toString("base64url"); const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex"); const invitationId = crypto.randomUUID(); const expiresAt = new Date(Date.now()+24*60*60*1000);
      await client.query(`INSERT INTO user_invitation (id,tenant_id,email_normalized,display_email,invitation_type,role_id,token_hash,status,expires_at,created_by,updated_at) VALUES ($1,$2,$3,$4,'tenant_user_activation',$5,$6,'pending',$7,$8,NOW())`, [invitationId,current.tenantId,email,body.email.trim(),role.id,tokenHash,expiresAt,current.userId]);
      const taskId = await enqueueInvitation(client,{ tenantId:current.tenantId,tenantName:tenant.name,invitationId,email,rawToken,tokenHash,expiresAt });
      const payload = { id: invitationId, status: "pending", taskId }; await client.query(`INSERT INTO idempotency_record (actor_user_id,idempotency_key,operation_name,request_hash,status,response_status,response_payload,resource_type,resource_id,completed_at,expires_at) VALUES ($1,$2,'tenant.invitation.create',$3,'completed',201,$4::jsonb,'user_invitation',$5,NOW(),NOW()+INTERVAL '24 hours')`, [current.userId,key,requestHash,JSON.stringify(payload),invitationId]);
      await audit(client,current.tenantId,current.userId,"TENANT_INVITATION_CREATED",`invitation:${invitationId}`,{ invitationId,roleId:role.id,idempotencyKey:key,taskId }); await client.query("COMMIT"); return reply.status(201).send(payload);
    } catch (error) { await client.query("ROLLBACK"); const status = Number((error as { statusCode?: number }).statusCode)||500; return reply.status(status).send({ error: status===500 ? "Invitation could not be created" : (error as Error).message }); } finally { client.release(); }
  });

  app.post("/users/invitations/:invitationId/resend", async (req, reply) => {
    if (!(await requirePermission(pool, req, reply, "invitation:resend"))) return; const current=actor(req); const { invitationId }=req.params as { invitationId:string }; const client=await pool.connect();
    try { await client.query("BEGIN"); const invite=(await client.query<any>(`SELECT i.*,t.name tenant_name FROM user_invitation i JOIN tenant t ON t.id=i.tenant_id WHERE i.tenant_id=$1 AND i.id=$2 AND i.invitation_type='tenant_user_activation' FOR UPDATE OF i`,[current.tenantId,invitationId])).rows[0]; if(!invite){await client.query("ROLLBACK");return reply.status(404).send({error:"Invitation not found"});} if(invite.status!=="pending"||new Date(invite.expires_at)<=new Date()){await client.query("ROLLBACK");return reply.status(409).send({error:"Invitation cannot be resent"});} await client.query("UPDATE user_invitation SET status='superseded',superseded_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2",[current.tenantId,invitationId]); const rawToken=crypto.randomBytes(32).toString("base64url");const tokenHash=crypto.createHash("sha256").update(rawToken).digest("hex");const id=crypto.randomUUID();const expiresAt=new Date(Date.now()+24*60*60*1000);await client.query(`INSERT INTO user_invitation (id,tenant_id,email_normalized,display_email,invitation_type,role_id,token_hash,status,expires_at,created_by,updated_at) VALUES ($1,$2,$3,$4,'tenant_user_activation',$5,$6,'pending',$7,$8,NOW())`,[id,current.tenantId,invite.email_normalized,invite.display_email,invite.role_id,tokenHash,expiresAt,current.userId]);const taskId=await enqueueInvitation(client,{tenantId:current.tenantId,tenantName:invite.tenant_name,invitationId:id,email:invite.email_normalized,rawToken,tokenHash,expiresAt});await audit(client,current.tenantId,current.userId,"TENANT_INVITATION_RESENT",`invitation:${id}`,{invitationId:id,supersededInvitationId:invitationId,taskId});await client.query("COMMIT");return reply.status(201).send({id,status:"pending",taskId}); } catch {await client.query("ROLLBACK");return reply.status(500).send({error:"Invitation could not be resent"});}finally{client.release();}
  });

  app.post("/users/invitations/:invitationId/revoke", async (req, reply) => {
    if (!(await requirePermission(pool,req,reply,"invitation:revoke"))) return;const current=actor(req);const {invitationId}=req.params as {invitationId:string};const client=await pool.connect();try{await client.query("BEGIN");const invitation=(await client.query<any>("SELECT id,email_normalized,role_id,status FROM user_invitation WHERE tenant_id=$1 AND id=$2 AND invitation_type='tenant_user_activation' FOR UPDATE",[current.tenantId,invitationId])).rows[0];if(!invitation){await client.query("ROLLBACK");return reply.status(404).send({error:"Invitation not found"});}if(invitation.status!=="pending"){await client.query("ROLLBACK");return reply.status(409).send({error:"Invitation cannot be revoked"});}await client.query("UPDATE user_invitation SET status='revoked',revoked_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2",[current.tenantId,invitationId]);await client.query(`UPDATE membership m SET status='revoked',version=version+1,updated_at=NOW() FROM user_account u WHERE m.tenant_id=$1 AND m.user_id=u.id AND u.tenant_id=m.tenant_id AND u.email=$2 AND m.role_id=$3 AND m.status='invited'`,[current.tenantId,invitation.email_normalized,invitation.role_id]);await audit(client,current.tenantId,current.userId,"TENANT_INVITATION_REVOKED",`invitation:${invitationId}`,{invitationId});await client.query("COMMIT");return reply.send({id:invitationId,status:"revoked"});}catch{await client.query("ROLLBACK");return reply.status(500).send({error:"Invitation could not be revoked"});}finally{client.release();}
  });

  app.patch("/users/:userId/role", async (req,reply)=>{if(!(await requirePermission(pool,req,reply,"user:role:assign")))return;const current=actor(req);const{userId}=req.params as{userId:string};const body=req.body as{roleId?:string;organizationId?:string;expectedVersion?:number;reason?:string};if(userId===current.userId)return reply.status(403).send({error:"Self role changes are prohibited"});if(!body.roleId||!UUID.test(body.roleId)||!Number.isInteger(body.expectedVersion)||!body.reason?.trim())return reply.status(400).send({error:"Invalid role change request"});if(body.organizationId)return reply.status(422).send({error:"Organization-scoped roles are deferred"});const client=await pool.connect();try{await client.query("BEGIN");const role=await assertRole(client,current.tenantId,body.roleId);const membership=(await client.query<any>(`SELECT m.id,m.version,r.name role_name FROM membership m JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' FOR UPDATE OF m`,[current.tenantId,userId])).rows[0];if(!membership){await client.query("ROLLBACK");return reply.status(404).send({error:"User not found"});}if(membership.role_name==="super_admin"){await client.query("ROLLBACK");return reply.status(403).send({error:"Protected administrator cannot be changed"});}if(membership.version!==body.expectedVersion){await client.query("ROLLBACK");return reply.status(409).send({error:"Membership version conflict"});}await client.query("UPDATE membership SET role_id=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3 AND version=$4",[role.id,current.tenantId,membership.id,body.expectedVersion]);await client.query("DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",[current.tenantId,userId]);await audit(client,current.tenantId,current.userId,"TENANT_ROLE_CHANGED",`user:${userId}`,{targetUserId:userId,oldRoleName:membership.role_name,newRoleId:role.id,reason:body.reason.trim()});await client.query("COMMIT");return reply.send({userId,roleId:role.id,membershipVersion:body.expectedVersion!+1});}catch(error){await client.query("ROLLBACK");return reply.status(Number((error as any).statusCode)||500).send({error:Number((error as any).statusCode)?(error as Error).message:"Role could not be changed"});}finally{client.release();}});

  app.patch("/users/:userId/status",async(req,reply)=>{if(!(await requirePermission(pool,req,reply,"user:status:write")))return;const current=actor(req);const{userId}=req.params as{userId:string};const body=req.body as{status?:"active"|"suspended";expectedVersion?:number;reason?:string};if(userId===current.userId)return reply.status(403).send({error:"Self status changes are prohibited"});if(!["active","suspended"].includes(body.status||"")||!Number.isInteger(body.expectedVersion)||!body.reason?.trim())return reply.status(400).send({error:"Invalid status request"});const client=await pool.connect();try{await client.query("BEGIN");const target=(await client.query<any>(`SELECT u.status,m.id membership_id,m.version,r.name role_name FROM user_account u JOIN membership m ON m.tenant_id=u.tenant_id AND m.user_id=u.id JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE u.tenant_id=$1 AND u.id=$2 AND m.status='active' FOR UPDATE OF u,m`,[current.tenantId,userId])).rows[0];if(!target){await client.query("ROLLBACK");return reply.status(404).send({error:"User not found"});}if(target.version!==body.expectedVersion){await client.query("ROLLBACK");return reply.status(409).send({error:"Membership version conflict"});}if(target.role_name==="super_admin"&&body.status==="suspended"){const admins=Number((await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM membership m JOIN user_account u ON u.id=m.user_id AND u.tenant_id=m.tenant_id JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.status='active' AND u.status='active' AND r.name='super_admin'`,[current.tenantId])).rows[0]?.count||0);if(admins<=1){await client.query("ROLLBACK");return reply.status(422).send({error:"Final active super administrator is protected"});}}await client.query("UPDATE user_account SET status=$1,updated_at=NOW() WHERE tenant_id=$2 AND id=$3",[body.status,current.tenantId,userId]);await client.query("UPDATE membership SET version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND version=$3",[current.tenantId,target.membership_id,body.expectedVersion]);await client.query("DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",[current.tenantId,userId]);await audit(client,current.tenantId,current.userId,body.status==="suspended"?"TENANT_USER_SUSPENDED":"TENANT_USER_REACTIVATED",`user:${userId}`,{targetUserId:userId,fromStatus:target.status,toStatus:body.status,reason:body.reason.trim()});await client.query("COMMIT");return reply.send({userId,status:body.status,membershipVersion:body.expectedVersion!+1});}catch{await client.query("ROLLBACK");return reply.status(500).send({error:"Status could not be changed"});}finally{client.release();}});

  done();
}
