import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { Argon2idPasswordHasher } from "@govos/database";

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
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
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
      const { email, password } = req.body as Record<string, string>;
      if (!email || !password) {
        return reply
          .status(400)
          .send({ error: "Email and password are required" });
      }

      const hasher = new Argon2idPasswordHasher();

      // Fetch user and roles
      const query = `
      SELECT u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.password_hash,
             t.name as tenant_name, t.session_version,
             (SELECT name FROM organization WHERE id = (SELECT organization_id FROM membership WHERE user_id = u.id LIMIT 1)) as org_name,
             COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
      FROM user_account u
      JOIN tenant t ON t.id = u.tenant_id
      LEFT JOIN membership m ON m.user_id = u.id
      LEFT JOIN role r ON r.id = m.role_id
      WHERE u.email = $1 AND u.deleted_at IS NULL
      GROUP BY u.id, u.tenant_id, t.name, t.session_version, u.email, u.first_name, u.last_name, u.password_hash
    `;

      const result = await pool.query(query, [email]);
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      const user = result.rows[0];
      const isValid = await hasher.verify(user.password_hash, password);
      if (!isValid) {
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      // Transparent rehash if the stored hash uses an outdated settings format
      if (hasher.needsRehash(user.password_hash)) {
        const rehashed = await hasher.hash(password);
        await pool.query(
          "UPDATE user_account SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [rehashed, user.id],
        );
      }

      // Generate session token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

      const sessionQuery = `
      INSERT INTO session (tenant_id, user_id, token, expires_at, session_version)
      VALUES ($1, $2, $3, $4, $5)
    `;
      await pool.query(sessionQuery, [
        user.tenant_id,
        user.id,
        token,
        expiresAt,
        user.session_version,
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
      const { token, password } = req.body as { token: string; password?: string };

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const client = await pool.connect();
      const hasher = new Argon2idPasswordHasher();

      try {
        await client.query("BEGIN");

        // Lock invitation record
        const inviteRes = await client.query(
          `SELECT id, tenant_id, email_normalized, invitation_type, role_id, status, expires_at
           FROM user_invitation WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash]
        );

        if (inviteRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Invitation not found or invalid token" });
        }

        const invite = inviteRes.rows[0];

        if (invite.status !== "pending") {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: `Invitation is already ${invite.status}` });
        }

        if (new Date(invite.expires_at) <= new Date()) {
          await client.query(
            "UPDATE user_invitation SET status = 'expired', updated_at = NOW() WHERE id = $1",
            [invite.id]
          );
          await client.query("COMMIT");
          return reply.status(400).send({ error: "Invitation has expired" });
        }

        // Verify tenant is active
        const tenantRes = await client.query(
          "SELECT status FROM tenant WHERE id = $1",
          [invite.tenant_id]
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
          [invite.tenant_id, invite.email_normalized]
        );

        if (userRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "User account associated with this invitation does not exist" });
        }

        const user = userRes.rows[0];

        let passwordHashToStore = user.password_hash;
        if (user.status === "invited") {
          if (!password) {
            await client.query("ROLLBACK");
            return reply.status(400).send({ error: "password is required to activate a new identity" });
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
            [passwordHashToStore, user.id]
          );

          // Update platform role assignment status to 'active'
          await client.query(
            `UPDATE platform_role_assignment
             SET assignment_status = 'active', updated_at = NOW()
             WHERE user_id = $1 AND role_name = 'PLATFORM_SUPER_ADMIN'`,
            [user.id]
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
            [passwordHashToStore, user.id]
          );

          // Update membership status to 'active'
          await client.query(
            `UPDATE membership
             SET status = 'active', updated_at = NOW()
             WHERE tenant_id = $1 AND user_id = $2`,
            [invite.tenant_id, user.id]
          );
        }

        // Mark invitation as accepted
        await client.query(
          `UPDATE user_invitation
           SET status = 'accepted', accepted_at = NOW(), accepted_by = $1, updated_at = NOW()
           WHERE id = $2`,
          [user.id, invite.id]
        );

        // Invalidate competing pending invitations for the same email/tenant/type
        await client.query(
          `UPDATE user_invitation
           SET status = 'superseded', superseded_at = NOW(), updated_at = NOW()
           WHERE tenant_id = $1 AND email_normalized = $2 AND invitation_type = $3 AND status = 'pending' AND id <> $4`,
          [invite.tenant_id, invite.email_normalized, invite.invitation_type, invite.id]
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
          ]
        );

        await client.query("COMMIT");
        return reply.send({ status: "success", userId: user.id });
      } catch (err: any) {
        await client.query("ROLLBACK");
        return reply.status(500).send({ error: err.message });
      } finally {
        client.release();
      }
    }
  );

  done();
}
