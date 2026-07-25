import * as crypto from "node:crypto";
import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import { encryptPayload } from "@govos/core";

function getArgs(): { email: string; name: string } {
  const args = process.argv.slice(2);
  let email = "";
  let name = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email") {
      email = args[i + 1] || "";
    }
    if (args[i] === "--name") {
      name = args[i + 1] || "";
    }
  }
  return { email, name };
}

export async function bootstrapPlatformAdmin() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.database.DATABASE_URL,
  });

  const { email, name } = getArgs();

  // Validate environment controls
  if (process.env.ALLOW_PLATFORM_BOOTSTRAP !== "true") {
    console.error("Platform bootstrap is disabled (ALLOW_PLATFORM_BOOTSTRAP is not true).");
    process.exit(1);
  }

  const configuredSecret = process.env.PLATFORM_BOOTSTRAP_SECRET;
  if (!configuredSecret || configuredSecret.length < 16) {
    console.error("PLATFORM_BOOTSTRAP_SECRET must be set and be at least 16 characters long.");
    process.exit(1);
  }

  // Parse arguments and validate
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: npm run govos:bootstrap-platform-admin -- --email <email> --name <name>");
    console.error("Error: A valid --email argument is required.");
    process.exit(1);
  }

  if (!name || name.trim().length < 2) {
    console.error("Usage: npm run govos:bootstrap-platform-admin -- --email <email> --name <name>");
    console.error("Error: A valid --name argument (at least 2 chars) is required.");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Check if an active Platform Super Admin already exists
    const superAdminCheck = await client.query(
      `SELECT COUNT(*) FROM platform_role_assignment
       WHERE role_name = 'PLATFORM_SUPER_ADMIN' AND assignment_status = 'active'`
    );
    if (parseInt(superAdminCheck.rows[0].count, 10) > 0) {
      console.error("Error: A Platform Super Admin already exists. Refusing to run bootstrap.");
      process.exit(1);
    }

    // Resolve or create identity user
    await client.query("BEGIN");

    const systemTenantId = "00000000-0000-0000-0000-000000000000";
    const emailNormalized = email.trim().toLowerCase();

    // Check if user already exists
    let userId = "";
    const userCheck = await client.query(
      "SELECT id FROM user_account WHERE tenant_id = $1 AND email = $2",
      [systemTenantId, emailNormalized]
    );

    if (userCheck.rows.length > 0) {
      userId = userCheck.rows[0].id;
    } else {
      userId = crypto.randomUUID();
      // Set dummy password hash to satisfy NOT NULL constraint securely
      const dummyHash = "invited-placeholder-hash-" + crypto.randomBytes(16).toString("hex");
      await client.query(
        `INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
         VALUES ($1, $2, $3, $4, $5, '', 'invited')`,
        [userId, systemTenantId, emailNormalized, dummyHash, name.trim()]
      );
    }

    // Assign Platform role as pending_activation
    const assignmentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO platform_role_assignment (id, user_id, role_name, assignment_status)
       VALUES ($1, $2, 'PLATFORM_SUPER_ADMIN', 'pending_activation')
       ON CONFLICT (user_id, role_name) WHERE assignment_status IN ('pending_activation', 'active') DO UPDATE
       SET assignment_status = 'pending_activation', revoked_at = NULL, revoked_by = NULL, updated_at = NOW()`,
      [assignmentId, userId]
    );

    // Create user invitation
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await client.query(
      `INSERT INTO user_invitation (
        id, tenant_id, email_normalized, display_email, invitation_type,
        token_hash, status, expires_at, created_by, updated_at
      ) VALUES ($1, $2, $3, $4, 'platform_admin_activation', $5, 'pending', $6, $7, NOW())`,
      [invitationId, systemTenantId, emailNormalized, email.trim(), tokenHash, expiresAt, userId]
    );

    // Cryptographic Outbox Notification Payload
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error("ENCRYPTION_KEY must be set in env and be exactly 64 hex characters (32 bytes)");
    }

    const payload = {
      invitationId,
      recipientEmail: emailNormalized,
      activationUrl: `http://localhost:8080/auth/invitations/accept?token=${rawToken}`,
      expiresAt: expiresAt.toISOString(),
      name: name.trim(),
    };

    const encryptedEnvelope = encryptPayload(payload, encryptionKey, "v1");

    const taskId = `task-${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO task_execution (
         tenant_id, task_id, task_type, payload_hash, status, available_at, attempt_count, max_attempts, encrypted_payload
       ) VALUES ($1, $2, 'govos.notification.invitation.send', $3, 'pending', NOW(), 0, 5, $4)`,
      [systemTenantId, taskId, tokenHash, JSON.stringify(encryptedEnvelope)]
    );

    // Audit log
    await client.query(
      `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
       VALUES ($1, $2, 'PLATFORM_ADMIN_BOOTSTRAP_REQUESTED', $3, 'allow', $4)`,
      [
        systemTenantId,
        userId,
        `user:${userId}`,
        JSON.stringify({
          email: emailNormalized,
          role: "PLATFORM_SUPER_ADMIN",
          taskId,
          invitationId,
        }),
      ]
    );

    await client.query("COMMIT");

    console.log("Platform Administrator bootstrap initiated successfully.");
    const emailParts = emailNormalized.split("@");
    const firstPart = emailParts[0] || "";
    const secondPart = emailParts[1] || "";
    const maskedEmail = (firstPart[0] || "") + "***@" + secondPart;
    console.log(`Invitation notification queued for ${maskedEmail}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Platform bootstrap encountered an error:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
