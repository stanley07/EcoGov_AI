import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { Argon2idPasswordHasher } from "@govos/database";
import {
  assertPasswordPolicy,
  base32,
  decryptMfa,
  encryptMfa,
  makeRecoveryCodes,
  verifyTotp,
} from "../security.js";
type Actor = { userId: string; tenantId: string };
const actor = (r: FastifyRequest) => r.user as Actor,
  token = (r: FastifyRequest) => String(r.headers.authorization || "").slice(7);
async function allowed(
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
async function audit(
  c: PoolClient,
  a: Actor,
  action: string,
  target: string,
  context: object,
) {
  await c.query(
    `INSERT INTO authz_audit_log(tenant_id,user_id,action,resource,result,context) VALUES($1,$2,$3,$4,'allow',$5::jsonb)`,
    [a.tenantId, a.userId, action, `user:${target}`, JSON.stringify(context)],
  );
}
async function findTarget(c: PoolClient, a: Actor, id: string, lock = false) {
  return (
    await c.query(
      `SELECT u.*,m.status membership_status,m.version membership_version,r.name role_name,EXISTS(SELECT 1 FROM platform_role_assignment p WHERE p.user_id=u.id AND p.assignment_status='active') platform_authority FROM user_account u JOIN membership m ON m.user_id=u.id AND m.tenant_id=u.tenant_id JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE u.tenant_id=$1 AND u.id=$2 AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM membership am JOIN role ar ON ar.id=am.role_id AND ar.tenant_id=am.tenant_id WHERE am.tenant_id=$1 AND am.user_id=$3 AND am.status='active' AND (ar.name='super_admin' OR (ar.name='organization_admin' AND am.organization_id=m.organization_id AND r.name<>'organization_admin'))) ${lock ? "FOR UPDATE OF u,m" : ""}`,
      [a.tenantId, id, a.userId],
    )
  ).rows[0];
}
export function accountSecurityRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  app.post("/auth/password/change", async (r, reply) => {
    const a = actor(r),
      b = r.body as any;
    try {
      assertPasswordPolicy(b.newPassword || "");
    } catch {
      return reply
        .status(422)
        .send({ error: "Password change could not be completed" });
    }
    const c = await pool.connect(),
      h = new Argon2idPasswordHasher();
    try {
      await c.query("BEGIN");
      const u = (
        await c.query(
          "SELECT password_hash FROM user_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, a.userId],
        )
      ).rows[0];
      if (
        !u ||
        !(await h.verify(u.password_hash, b.currentPassword || "")) ||
        (await h.verify(u.password_hash, b.newPassword))
      ) {
        await c.query("ROLLBACK");
        return reply
          .status(400)
          .send({ error: "Password change could not be completed" });
      }
      const old = await c.query(
        "SELECT password_hash FROM password_history WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5",
        [a.tenantId, a.userId],
      );
      for (const x of old.rows)
        if (await h.verify(x.password_hash, b.newPassword)) {
          await c.query("ROLLBACK");
          return reply
            .status(422)
            .send({ error: "Password change could not be completed" });
        }
      const next = await h.hash(b.newPassword);
      await c.query(
        "INSERT INTO password_history(tenant_id,user_id,password_hash) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, u.password_hash],
      );
      await c.query(
        "UPDATE user_account SET password_hash=$1,password_reset_required=FALSE,password_changed_at=NOW(),updated_at=NOW() WHERE tenant_id=$2 AND id=$3",
        [next, a.tenantId, a.userId],
      );
      const revoked = await c.query(
        "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2 AND token<>$3",
        [a.tenantId, a.userId, token(r)],
      );
      await audit(c, a, "ACCOUNT_SECURITY_PASSWORD_CHANGED", a.userId, {
        sessionRevocationCount: revoked.rowCount,
      });
      await c.query("COMMIT");
      return { status: "changed", currentSessionPreserved: true };
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Password change could not be completed" });
    } finally {
      c.release();
    }
  });
  app.post("/auth/mfa/enrollment/start", async (r, reply) => {
    const a = actor(r),
      secret = base32(crypto.randomBytes(20)),
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `UPDATE user_account SET mfa_secret_encrypted=$1::jsonb,mfa_enrollment_status='pending',mfa_enrolled_at=NULL,mfa_verified_at=NULL,mfa_recovery_code_hashes=NULL,updated_at=NOW() WHERE tenant_id=$2 AND id=$3`,
        [JSON.stringify(encryptMfa(a.userId, secret)), a.tenantId, a.userId],
      );
      await audit(
        c,
        a,
        "ACCOUNT_SECURITY_MFA_ENROLLMENT_STARTED",
        a.userId,
        {},
      );
      await c.query("COMMIT");
      return reply
        .header("Cache-Control", "no-store")
        .send({
          provisioningUri: `otpauth://totp/GovOS:${a.userId}?secret=${secret}&issuer=GovOS`,
          secret,
        });
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "MFA enrollment could not start" });
    } finally {
      c.release();
    }
  });
  app.post("/auth/mfa/enrollment/verify", async (r, reply) => {
    const a = actor(r),
      { code } = r.body as any,
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      const u = (
        await c.query(
          "SELECT mfa_secret_encrypted,mfa_enrollment_status FROM user_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, a.userId],
        )
      ).rows[0];
      if (
        !u ||
        u.mfa_enrollment_status !== "pending" ||
        !verifyTotp(decryptMfa(a.userId, u.mfa_secret_encrypted), code || "")
      ) {
        await c.query("ROLLBACK");
        return reply.status(400).send({ error: "MFA verification failed" });
      }
      const codes = makeRecoveryCodes(a.userId);
      await c.query(
        `UPDATE user_account SET mfa_enrollment_status='verified',mfa_enrolled_at=NOW(),mfa_verified_at=NOW(),mfa_recovery_code_hashes=$1::jsonb,mfa_recovery_codes_generated_at=NOW(),mfa_reenrollment_required=FALSE,updated_at=NOW() WHERE tenant_id=$2 AND id=$3`,
        [JSON.stringify(codes.stored), a.tenantId, a.userId],
      );
      await c.query(
        "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2 AND token<>$3",
        [a.tenantId, a.userId, token(r)],
      );
      await audit(c, a, "ACCOUNT_SECURITY_MFA_ENROLLMENT_COMPLETED", a.userId, {
        recoveryCodeCount: 10,
      });
      await c.query("COMMIT");
      return reply
        .header("Cache-Control", "no-store")
        .send({ recoveryCodes: codes.raw });
    } catch {
      await c.query("ROLLBACK");
      return reply.status(500).send({ error: "MFA verification failed" });
    } finally {
      c.release();
    }
  });
  app.post("/auth/mfa/recovery-codes/regenerate", async (r, reply) => {
    const a = actor(r),
      b = r.body as any,
      c = await pool.connect(),
      h = new Argon2idPasswordHasher();
    try {
      await c.query("BEGIN");
      const u = (
        await c.query(
          "SELECT password_hash,mfa_secret_encrypted,mfa_enrollment_status FROM user_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, a.userId],
        )
      ).rows[0];
      if (
        !u ||
        !(await h.verify(u.password_hash, b.currentPassword || "")) ||
        u.mfa_enrollment_status !== "verified" ||
        !verifyTotp(decryptMfa(a.userId, u.mfa_secret_encrypted), b.code || "")
      ) {
        await c.query("ROLLBACK");
        return reply
          .status(403)
          .send({ error: "Recent authentication required" });
      }
      const codes = makeRecoveryCodes(a.userId);
      await c.query(
        "UPDATE user_account SET mfa_recovery_code_hashes=$1::jsonb,mfa_recovery_codes_generated_at=NOW() WHERE tenant_id=$2 AND id=$3",
        [JSON.stringify(codes.stored), a.tenantId, a.userId],
      );
      await audit(
        c,
        a,
        "ACCOUNT_SECURITY_RECOVERY_CODES_REGENERATED",
        a.userId,
        { recoveryCodeCount: 10 },
      );
      await c.query("COMMIT");
      return reply
        .header("Cache-Control", "no-store")
        .send({ recoveryCodes: codes.raw });
    } catch {
      await c.query("ROLLBACK");
      return reply
        .status(500)
        .send({ error: "Recovery codes could not be regenerated" });
    } finally {
      c.release();
    }
  });
  app.get("/auth/sessions", async (r) => {
    const a = actor(r);
    return (
      await pool.query(
        `SELECT id,created_at "createdAt",expires_at "expiresAt",last_seen_at "lastSeenAt",COALESCE(user_agent,'Unknown device') "deviceLabel",token=$3 "currentSession" FROM session WHERE tenant_id=$1 AND user_id=$2 AND expires_at>NOW() ORDER BY created_at DESC`,
        [a.tenantId, a.userId, token(r)],
      )
    ).rows;
  });
  app.delete("/auth/sessions/:sessionId", async (r, reply) => {
    const a = actor(r),
      { sessionId } = r.params as any,
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING token",
        [a.tenantId, a.userId, sessionId],
      );
      if (!q.rowCount) {
        await c.query("ROLLBACK");
        return reply.status(404).send({ error: "Session not found" });
      }
      await audit(c, a, "ACCOUNT_SECURITY_SESSION_REVOKED_SELF", a.userId, {
        sessionId,
      });
      await c.query("COMMIT");
      return { revoked: true, currentSession: q.rows[0].token === token(r) };
    } finally {
      c.release();
    }
  });
  app.post("/auth/sessions/revoke-others", async (r) => {
    const a = actor(r),
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
        "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2 AND token<>$3",
        [a.tenantId, a.userId, token(r)],
      );
      await audit(c, a, "ACCOUNT_SECURITY_OTHER_SESSIONS_REVOKED", a.userId, {
        sessionRevocationCount: q.rowCount,
      });
      await c.query("COMMIT");
      return { revokedCount: q.rowCount };
    } finally {
      c.release();
    }
  });
  app.get("/users/:userId/security", async (r, reply) => {
    if (!(await allowed(pool, r, reply, "user:read"))) return;
    const a = actor(r),
      { userId } = r.params as any,
      c = await pool.connect();
    try {
      const u = await findTarget(c, a, userId);
      if (!u || u.platform_authority)
        return reply.status(404).send({ error: "User not found" });
      const count = Number(
          (
            await c.query(
              "SELECT COUNT(*) count FROM session WHERE tenant_id=$1 AND user_id=$2 AND expires_at>NOW()",
              [a.tenantId, userId],
            )
          ).rows[0].count,
        ),
        codes =
          u.mfa_recovery_code_hashes?.codes?.filter((x: any) => !x.consumedAt)
            .length || 0;
      return {
        userId,
        status: u.status,
        membershipStatus: u.membership_status,
        membershipVersion: u.membership_version,
        passwordResetRequired: u.password_reset_required,
        passwordChangedAt: u.password_changed_at,
        mfaEnrolled: u.mfa_enrollment_status === "verified",
        mfaVerified: !!u.mfa_verified_at,
        recoveryCodeCount: codes,
        activeSessionCount: count,
      };
    } finally {
      c.release();
    }
  });
  app.get("/users/:userId/security/sessions", async (r, reply) => {
    if (!(await allowed(pool, r, reply, "user:read"))) return;
    const a = actor(r),
      { userId } = r.params as any;
    const client = await pool.connect();
    try {
      if (!(await findTarget(client, a, userId)))
        return reply.status(404).send({ error: "User not found" });
    } finally {
      client.release();
    }
    return (
      await pool.query(
        `SELECT id,created_at "createdAt",expires_at "expiresAt",last_seen_at "lastSeenAt",COALESCE(user_agent,'Unknown device') "deviceLabel" FROM session WHERE tenant_id=$1 AND user_id=$2 AND expires_at>NOW()`,
        [a.tenantId, userId],
      )
    ).rows;
  });
  app.post("/users/:userId/security/force-password-reset", async (r, reply) =>
    mutate(pool, r, reply, "user:status:write", "password"),
  );
  app.post("/users/:userId/security/mfa-reset", async (r, reply) =>
    mutate(pool, r, reply, "user:mfa:reset", "mfa"),
  );
  app.post("/users/:userId/security/sessions/revoke-all", async (r, reply) =>
    mutate(pool, r, reply, "user:session:revoke", "sessions"),
  );
  app.get("/users/:userId/security/audit", async (r, reply) => {
    if (!(await allowed(pool, r, reply, "user:read"))) return;
    const a = actor(r),
      { userId } = r.params as any,
      q = r.query as any,
      limit = Math.min(Number(q.limit) || 25, 100),
      offset = Math.max(Number(q.offset) || 0, 0);
    const client = await pool.connect();
    try {
      if (!(await findTarget(client, a, userId)))
        return reply.status(404).send({ error: "User not found" });
    } finally {
      client.release();
    }
    return (
      await pool.query(
        `SELECT action "eventType",created_at "timestamp",user_id "actorId",resource "targetId",context->>'reason' reason,context->>'sessionRevocationCount' "sessionRevocationCount" FROM authz_audit_log WHERE tenant_id=$1 AND resource=$2 AND action LIKE 'ACCOUNT_SECURITY_%' ORDER BY created_at ${q.sortOrder === "asc" ? "ASC" : "DESC"} LIMIT $3 OFFSET $4`,
        [a.tenantId, `user:${userId}`, limit, offset],
      )
    ).rows;
  });
  done();
}
async function mutate(
  pool: Pool,
  r: FastifyRequest,
  reply: FastifyReply,
  perm: string,
  kind: "password" | "mfa" | "sessions",
) {
  if (!(await allowed(pool, r, reply, perm))) return;
  const a = actor(r),
    { userId } = r.params as any,
    { reason } = r.body as any;
  if (userId === a.userId)
    return reply
      .status(403)
      .send({ error: "Use self-service security controls" });
  if (!reason?.trim())
    return reply.status(400).send({ error: "Reason is required" });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const u = await findTarget(c, a, userId, true);
    if (!u || u.platform_authority) {
      await c.query("ROLLBACK");
      return reply.status(404).send({ error: "User not found" });
    }
    let event = "ACCOUNT_SECURITY_ALL_SESSIONS_REVOKED_ADMIN";
    if (kind === "password") {
      await c.query(
        "UPDATE user_account SET password_reset_required=TRUE,password_reset_at=NOW(),password_reset_by=$1 WHERE tenant_id=$2 AND id=$3",
        [a.userId, a.tenantId, userId],
      );
      event = "ACCOUNT_SECURITY_PASSWORD_RESET_REQUIRED";
    } else if (kind === "mfa") {
      await c.query(
        `UPDATE user_account SET mfa_enrollment_status='unenrolled',mfa_secret_encrypted=NULL,mfa_recovery_code_hashes=NULL,mfa_enrolled_at=NULL,mfa_verified_at=NULL,mfa_recovery_codes_generated_at=NULL,mfa_reset_at=NOW(),mfa_reset_by=$1,mfa_reset_reason=$2,mfa_reenrollment_required=TRUE WHERE tenant_id=$3 AND id=$4`,
        [a.userId, reason.trim(), a.tenantId, userId],
      );
      event = "ACCOUNT_SECURITY_MFA_RESET";
    }
    const q = await c.query(
      "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, userId],
    );
    await audit(c, a, event, userId, {
      reason: reason.trim(),
      sessionRevocationCount: q.rowCount,
    });
    await c.query("COMMIT");
    return { status: "completed", sessionsRevoked: q.rowCount };
  } catch {
    await c.query("ROLLBACK");
    return reply
      .status(500)
      .send({ error: "Security action could not be completed" });
  } finally {
    c.release();
  }
}
