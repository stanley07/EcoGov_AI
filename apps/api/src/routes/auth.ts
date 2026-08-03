import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { Argon2idPasswordHasher } from "@govos/database";
import { decryptMfa, recoveryDigest, verifyTotp } from "../security.js";

const INVALID_CREDENTIALS = { error: "Invalid workspace, email, or password" };
const normalizeSlug = (value: unknown) =>
  typeof value === "string" &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;

export function authRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // Login Route
  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["tenantSlug", "email", "password"],
          properties: {
            tenantSlug: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              mfaRequired: { type: "boolean" },
              challengeToken: { type: "string" },
              passwordResetRequired: { type: "boolean" },
              resetToken: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  tenantName: { type: "string" },
                  organizationName: { type: "string" },
                  email: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  roles: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const {
        tenantSlug: rawSlug,
        email: rawEmail,
        password,
      } = req.body as Record<string, string>;
      const tenantSlug = normalizeSlug(rawSlug),
        email =
          typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
      if (!tenantSlug || !email || !password)
        return reply.status(401).send(INVALID_CREDENTIALS);

      const hasher = new Argon2idPasswordHasher();

      // Fetch user and roles
      const query = `
      SELECT u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.password_hash,
             u.password_reset_required,u.mfa_enrollment_status,u.mfa_secret_encrypted,u.mfa_recovery_code_hashes,
             t.name as tenant_name, t.session_version,m.role_id,
             (SELECT name FROM organization WHERE id = (SELECT organization_id FROM membership WHERE user_id = u.id LIMIT 1)) as org_name,
             COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
      FROM user_account u
      JOIN tenant t ON t.id=u.tenant_id AND t.slug=$1 AND t.status='active' AND t.deleted_at IS NULL AND t.is_system=FALSE
      JOIN membership m ON m.user_id=u.id AND m.tenant_id=u.tenant_id AND m.status='active'
      JOIN role r ON r.id=m.role_id AND r.tenant_id=m.tenant_id
      WHERE u.email=$2 AND u.status='active' AND u.deleted_at IS NULL
      GROUP BY u.id,u.tenant_id,t.name,t.session_version,u.email,u.first_name,u.last_name,u.password_hash,m.role_id
    `;

      const result = await pool.query(query, [tenantSlug, email]);
      if (result.rows.length !== 1)
        return reply.status(401).send(INVALID_CREDENTIALS);

      const user = result.rows[0];
      const isValid = await hasher.verify(user.password_hash, password);
      if (!isValid) return reply.status(401).send(INVALID_CREDENTIALS);
      if (user.password_reset_required) {
        const raw = crypto.randomBytes(32).toString("base64url"),
          hash = crypto
            .createHash("sha256")
            .update(`password-reset:${raw}`)
            .digest("hex");
        await pool.query(
          "DELETE FROM pending_auth_challenge WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL",
          [user.tenant_id, user.id],
        );
        await pool.query(
          `INSERT INTO pending_auth_challenge(tenant_id,user_id,role_id,challenge_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`,
          [user.tenant_id, user.id, user.role_id, hash],
        );
        return reply.send({ passwordResetRequired: true, resetToken: raw });
      }

      // Transparent rehash if the stored hash uses an outdated settings format
      if (hasher.needsRehash(user.password_hash)) {
        const rehashed = await hasher.hash(password);
        await pool.query(
          "UPDATE user_account SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [rehashed, user.id],
        );
      }

      if (
        user.mfa_enrollment_status === "verified" &&
        user.mfa_secret_encrypted
      ) {
        const raw = crypto.randomBytes(32).toString("base64url"),
          hash = crypto.createHash("sha256").update(`mfa:${raw}`).digest("hex");
        await pool.query(
          "DELETE FROM pending_auth_challenge WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL",
          [user.tenant_id, user.id],
        );
        await pool.query(
          `INSERT INTO pending_auth_challenge(tenant_id,user_id,role_id,challenge_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')`,
          [user.tenant_id, user.id, user.role_id, hash],
        );
        return reply.send({ mfaRequired: true, challengeToken: raw });
      }
      // Generate tenant-bound session token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

      const sessionQuery = `
      INSERT INTO session (tenant_id,user_id,role_id,token,expires_at,session_version,user_agent,ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `;
      await pool.query(sessionQuery, [
        user.tenant_id,
        user.id,
        user.role_id,
        token,
        expiresAt,
        user.session_version,
        String(req.headers["user-agent"] || "").slice(0, 255) || null,
        req.ip || null,
      ]);

      return reply.send({
        token,
        user: {
          id: user.id,
          tenantId: user.tenant_id,
          tenantName: user.tenant_name,
          organizationName: user.org_name,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          roles: user.roles,
        },
      });
    },
  );

  app.post("/auth/mfa/challenge", async (req, reply) => {
    const { challengeToken, code, recoveryCode } = req.body as {
      challengeToken?: string;
      code?: string;
      recoveryCode?: string;
    };
    if (!challengeToken || (!code && !recoveryCode))
      return reply
        .status(401)
        .send({ error: "Authentication challenge failed" });
    const hash = crypto
      .createHash("sha256")
      .update(`mfa:${challengeToken}`)
      .digest("hex"),
      client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query(
          `SELECT c.*,u.email,u.first_name,u.last_name,u.mfa_secret_encrypted,u.mfa_recovery_code_hashes,t.name tenant_name,t.session_version,r.name role_name FROM pending_auth_challenge c JOIN user_account u ON u.id=c.user_id AND u.tenant_id=c.tenant_id JOIN tenant t ON t.id=c.tenant_id JOIN role r ON r.id=c.role_id AND r.tenant_id=c.tenant_id WHERE c.challenge_hash=$1 AND c.consumed_at IS NULL AND c.expires_at>NOW() AND c.attempt_count<5 AND u.status='active' AND t.status='active' FOR UPDATE OF c,u`,
          [hash],
        )
      ).rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return reply
          .status(401)
          .send({ error: "Authentication challenge failed" });
      }
      let valid = false;
      if (code)
        valid = verifyTotp(
          decryptMfa(row.user_id, row.mfa_secret_encrypted),
          code,
        );
      if (recoveryCode && row.mfa_recovery_code_hashes?.codes) {
        const digest = recoveryDigest(row.user_id, recoveryCode);
        for (const item of row.mfa_recovery_code_hashes.codes) {
          if (
            !item.consumedAt &&
            item.digest.length === digest.length &&
            crypto.timingSafeEqual(
              Buffer.from(item.digest),
              Buffer.from(digest),
            )
          ) {
            item.consumedAt = new Date().toISOString();
            valid = true;
            break;
          }
        }
        if (valid)
          await client.query(
            "UPDATE user_account SET mfa_recovery_code_hashes=$1::jsonb WHERE tenant_id=$2 AND id=$3",
            [
              JSON.stringify(row.mfa_recovery_code_hashes),
              row.tenant_id,
              row.user_id,
            ],
          );
      }
      if (!valid) {
        await client.query(
          "UPDATE pending_auth_challenge SET attempt_count=attempt_count+1 WHERE id=$1",
          [row.id],
        );
        await client.query("COMMIT");
        return reply
          .status(401)
          .send({ error: "Authentication challenge failed" });
      }
      await client.query(
        "UPDATE pending_auth_challenge SET consumed_at=NOW() WHERE id=$1",
        [row.id],
      );
      const token = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + 86400000);
      await client.query(
        `INSERT INTO session(tenant_id,user_id,role_id,token,expires_at,session_version,user_agent,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.tenant_id,
          row.user_id,
          row.role_id,
          token,
          expiresAt,
          row.session_version,
          String(req.headers["user-agent"] || "").slice(0, 255) || null,
          req.ip || null,
        ],
      );
      await client.query(
        `INSERT INTO authz_audit_log(tenant_id,user_id,action,resource,result,context) VALUES($1,$2,'ACCOUNT_SECURITY_MFA_CHALLENGE_COMPLETED',$3,'allow',$4::jsonb)`,
        [
          row.tenant_id,
          row.user_id,
          `user:${row.user_id}`,
          JSON.stringify({ recoveryCodeUsed: !!recoveryCode }),
        ],
      );
      await client.query("COMMIT");
      return reply.send({
        token,
        user: {
          id: row.user_id,
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          roles: [row.role_name],
        },
      });
    } catch {
      await client.query("ROLLBACK");
      return reply
        .status(401)
        .send({ error: "Authentication challenge failed" });
    } finally {
      client.release();
    }
  });

  app.post("/auth/password/reset-required", async (req, reply) => {
    const { resetToken, currentPassword, newPassword } = req.body as { resetToken?: string; currentPassword?: string; newPassword?: string };
    if (!resetToken || !currentPassword || !newPassword) return reply.status(400).send({ error: "Password reset could not be completed" });
    const { assertPasswordPolicy } = await import("../security.js");
    try { assertPasswordPolicy(newPassword); } catch { return reply.status(422).send({ error: "Password reset could not be completed" }); }
    const hash=crypto.createHash("sha256").update(`password-reset:${resetToken}`).digest("hex"),client=await pool.connect(),hasher=new Argon2idPasswordHasher();
    try { await client.query("BEGIN"); const row=(await client.query(`SELECT c.id,c.tenant_id,c.user_id,u.password_hash FROM pending_auth_challenge c JOIN user_account u ON u.id=c.user_id AND u.tenant_id=c.tenant_id WHERE c.challenge_hash=$1 AND c.consumed_at IS NULL AND c.expires_at>NOW() AND c.attempt_count<5 AND u.password_reset_required=TRUE FOR UPDATE OF c,u`,[hash])).rows[0];
      if(!row||!(await hasher.verify(row.password_hash,currentPassword))||await hasher.verify(row.password_hash,newPassword)){if(row)await client.query("UPDATE pending_auth_challenge SET attempt_count=attempt_count+1 WHERE id=$1",[row.id]);await client.query("COMMIT");return reply.status(400).send({error:"Password reset could not be completed"});}
      const history=await client.query("SELECT password_hash FROM password_history WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5",[row.tenant_id,row.user_id]);for(const prior of history.rows)if(await hasher.verify(prior.password_hash,newPassword)){await client.query("ROLLBACK");return reply.status(422).send({error:"Password reset could not be completed"});}
      const next=await hasher.hash(newPassword);await client.query("INSERT INTO password_history(tenant_id,user_id,password_hash) VALUES($1,$2,$3)",[row.tenant_id,row.user_id,row.password_hash]);await client.query("UPDATE user_account SET password_hash=$1,password_reset_required=FALSE,password_changed_at=NOW(),updated_at=NOW() WHERE tenant_id=$2 AND id=$3",[next,row.tenant_id,row.user_id]);await client.query("DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",[row.tenant_id,row.user_id]);await client.query("UPDATE pending_auth_challenge SET consumed_at=NOW() WHERE id=$1",[row.id]);await client.query(`INSERT INTO authz_audit_log(tenant_id,user_id,action,resource,result,context) VALUES($1,$2,'ACCOUNT_SECURITY_PASSWORD_RESET_COMPLETED',$3,'allow','{}'::jsonb)`,[row.tenant_id,row.user_id,`user:${row.user_id}`]);await client.query("COMMIT");return reply.send({status:"changed"});
    } catch {await client.query("ROLLBACK");return reply.status(500).send({error:"Password reset could not be completed"});} finally {client.release();}
  });

  // Accept Invitation Route
  app.post(
    "/auth/invitations/accept",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
            password: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (req, reply) => {
      const { token, password } = req.body as {
        token: string;
        password?: string;
      };

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const client = await pool.connect();
      const hasher = new Argon2idPasswordHasher();

      try {
        await client.query("BEGIN");

        // Lock invitation record
        const inviteRes = await client.query(
          `SELECT id, tenant_id, organization_id, email_normalized, invitation_type, role_id, status, expires_at
           FROM user_invitation WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        );

        if (inviteRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply
            .status(404)
            .send({ error: "Invitation not found or invalid token" });
        }

        const invite = inviteRes.rows[0];

        if (invite.status !== "pending") {
          await client.query("ROLLBACK");
          return reply
            .status(400)
            .send({ error: `Invitation is already ${invite.status}` });
        }

        if (new Date(invite.expires_at) <= new Date()) {
          await client.query(
            "UPDATE user_invitation SET status = 'expired', updated_at = NOW() WHERE id = $1",
            [invite.id],
          );
          await client.query("COMMIT");
          return reply.status(400).send({ error: "Invitation has expired" });
        }

        // Verify tenant is active
        const tenantRes = await client.query(
          "SELECT status FROM tenant WHERE id = $1",
          [invite.tenant_id],
        );
        if (tenantRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Tenant not found" });
        }
        if (tenantRes.rows[0].status !== "active") {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            code: "TENANT_SUSPENDED",
            error: `Tenant is currently ${tenantRes.rows[0].status}`,
          });
        }

        // Get user details
        const userRes = await client.query(
          "SELECT id, status, password_hash FROM user_account WHERE tenant_id = $1 AND email = $2",
          [invite.tenant_id, invite.email_normalized],
        );

        if (userRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply
            .status(400)
            .send({
              error:
                "User account associated with this invitation does not exist",
            });
        }

        const user = userRes.rows[0];

        let passwordHashToStore = user.password_hash;
        if (user.status === "invited") {
          if (!password) {
            await client.query("ROLLBACK");
            return reply
              .status(400)
              .send({
                error: "password is required to activate a new identity",
              });
          }
          passwordHashToStore = await hasher.hash(password);
        }

        // Activate based on invitation type
        if (invite.invitation_type === "platform_admin_activation") {
          // Update user status & password
          await client.query(
            `UPDATE user_account
             SET status = 'active', password_hash = $1, updated_at = NOW(), mfa_enrollment_status = 'verified'
             WHERE id = $2`,
            [passwordHashToStore, user.id],
          );

          // Update platform role assignment status to 'active'
          await client.query(
            `UPDATE platform_role_assignment
             SET assignment_status = 'active', updated_at = NOW()
             WHERE user_id = $1 AND role_name = 'PLATFORM_SUPER_ADMIN'`,
            [user.id],
          );
        } else if (
          invite.invitation_type === "tenant_admin_activation" ||
          invite.invitation_type === "tenant_user_activation"
        ) {
          // Update user status & password
          await client.query(
            `UPDATE user_account
             SET status = 'active', password_hash = $1, updated_at = NOW()
             WHERE id = $2`,
            [passwordHashToStore, user.id],
          );

          // Update membership status to 'active'
          await client.query(
            `UPDATE membership
             SET status = 'active', updated_at = NOW()
             WHERE tenant_id = $1 AND user_id = $2 AND organization_id IS NOT DISTINCT FROM $3`,
            [invite.tenant_id, user.id, invite.organization_id],
          );
        }

        // Mark invitation as accepted
        await client.query(
          `UPDATE user_invitation
           SET status = 'accepted', accepted_at = NOW(), accepted_by = $1, updated_at = NOW()
           WHERE id = $2`,
          [user.id, invite.id],
        );

        // Invalidate competing pending invitations for the same email/tenant/type
        await client.query(
          `UPDATE user_invitation
           SET status = 'superseded', superseded_at = NOW(), updated_at = NOW()
           WHERE tenant_id = $1 AND email_normalized = $2 AND invitation_type = $3 AND status = 'pending' AND id <> $4`,
          [
            invite.tenant_id,
            invite.email_normalized,
            invite.invitation_type,
            invite.id,
          ],
        );

        // Audit Log
        await client.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'INVITATION_ACCEPTED', $3, 'allow', $4)`,
          [
            invite.tenant_id,
            user.id,
            `invitation:${invite.id}`,
            JSON.stringify({ invitationType: invite.invitation_type }),
          ],
        );

        await client.query("COMMIT");
        return reply.send({ status: "success", userId: user.id });
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    },
  );

  done();
}
