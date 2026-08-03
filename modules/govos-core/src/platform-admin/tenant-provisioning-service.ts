import * as crypto from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { encryptPayload } from "../crypto.js";
import { buildInvitationActivationUrl } from "../invitation-routes.js";

// Input schema validation
export const ProvisionTenantInputSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
  type: z.enum(["ministry", "agency", "department"]),
  adminEmail: z.string().email(),
  adminName: z.string().min(2).max(255),
  region: z.string().optional(),
  lga: z.string().optional(),
  primaryColor: z.string().optional(),
});

export type ProvisionTenantInput = z.infer<typeof ProvisionTenantInputSchema>;

// Standard roles and permissions to seed per tenant
const DEFAULT_SEED_ROLES = [
  { name: "super_admin", description: "Full management access" },
  { name: "organization_admin", description: "Manage org settings" },
  { name: "director", description: "Review director decisions" },
  { name: "inspector", description: "Conduct audits" },
  { name: "facility_owner", description: "Register facilities" },
  { name: "citizen", description: "Public reporting" },
];

const DEFAULT_SEED_PERMISSIONS = [
  "org:read",
  "org:write",
  "facility:read",
  "facility:write",
  "facility:register",
  "facility:review",
  "audit:read",
  "complaint:review",
  "complaint:contact:read",
  "workbench:queue:read",
];

const OFFICER_PERMS = ["complaint:review", "complaint:contact:read", "workbench:queue:read"];

export class TenantProvisioningService {
  constructor(private pool: Pool) {}

  /**
   * Safe entrypoint handling idempotency lookup, recovery, and routing.
   */
  public async provision(
    actorUserId: string,
    idempotencyKey: string,
    rawInput: unknown
  ): Promise<{ status: number; payload: any }> {
    // 1. Validate inputs
    const parsed = ProvisionTenantInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        status: 400,
        payload: { error: `Validation failed: ${parsed.error.message}` },
      };
    }

    const input = parsed.data;
    if (input.slug === "platform" || input.slug === "govos-platform" || input.slug === "system" || input.slug === "00000000-0000-0000-0000-000000000000") {
      return {
        status: 400,
        payload: { error: "Invalid slug name: reserved for system tenant." },
      };
    }

    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");

    const operationName = "platform-admin.tenant.create";
    let recordId: string | null = null;
    const lockOwner = crypto.randomUUID();

    // 2. Check idempotency record
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the idempotency record first
      const lockQuery = `
        SELECT id, status, response_status, response_payload, request_hash, locked_at, lock_owner, attempt_count, resource_id
        FROM idempotency_record
        WHERE actor_user_id = $1 AND operation_name = $2 AND idempotency_key = $3
        FOR UPDATE
      `;
      const idempRes = await client.query(lockQuery, [
        actorUserId,
        operationName,
        idempotencyKey,
      ]);

      if (idempRes.rows.length > 0) {
        const record = idempRes.rows[0];
        recordId = record.id;

        if (record.request_hash !== requestHash) {
          await client.query("ROLLBACK");
          return {
            status: 409,
            payload: {
              code: "IDEMPOTENCY_KEY_REUSED",
              error: "This idempotency key has been used with a different request body.",
            },
          };
        }

        if (record.status === "completed") {
          await client.query("ROLLBACK");
          return {
            status: record.response_status,
            payload: record.response_payload,
          };
        }

        if (record.status === "processing") {
          const leaseSeconds = parseInt(process.env.IDEMPOTENCY_PROCESSING_LEASE_SECONDS || "300", 10);
          const elapsed = record.locked_at ? (Date.now() - new Date(record.locked_at).getTime()) / 1000 : Infinity;

          if (elapsed < leaseSeconds) {
            await client.query("ROLLBACK");
            return {
              status: 425,
              payload: {
                error: "Operation is currently in progress. Please retry later.",
              },
            };
          }

          let tenantId = record.resource_id;

          if (!tenantId) {
            // 1. Check via explicit idempotencyRecordId/provisioningCorrelationId correlation
            const correlationCheck = await client.query(
              `SELECT tenant_id FROM authz_audit_log
               WHERE user_id = $1 AND action = 'TENANT_CREATED' AND context->>'idempotencyRecordId' = $2
               LIMIT 1`,
              [actorUserId, record.id]
            );
            if (correlationCheck.rows.length > 0) {
              tenantId = correlationCheck.rows[0].tenant_id;
            }
          }

          if (!tenantId) {
            // 2. Transitional compatibility fallback (actor + slug)
            const fallbackCheck = await client.query(
              `SELECT tenant_id FROM authz_audit_log
               WHERE user_id = $1 AND action = 'TENANT_CREATED' AND context->>'slug' = $2
               LIMIT 1`,
              [actorUserId, input.slug]
            );
            if (fallbackCheck.rows.length > 0) {
              tenantId = fallbackCheck.rows[0].tenant_id;
            }
          }

          if (tenantId) {
            const orgRes = await client.query("SELECT id FROM organization WHERE tenant_id = $1 LIMIT 1", [tenantId]);
            const userRes = await client.query("SELECT id FROM user_account WHERE tenant_id = $1 LIMIT 1", [tenantId]);
            const inviteRes = await client.query("SELECT id FROM user_invitation WHERE tenant_id = $1 LIMIT 1", [tenantId]);
            const taskRes = await client.query("SELECT task_id FROM task_execution WHERE tenant_id = $1 LIMIT 1", [tenantId]);

            const responsePayload = {
              tenantId,
              organizationId: orgRes.rows[0]?.id || "",
              adminUserId: userRes.rows[0]?.id || "",
              taskId: taskRes.rows[0]?.task_id || "",
              invitationId: inviteRes.rows[0]?.id || "",
            };

            await client.query(
              `UPDATE idempotency_record
               SET status = 'completed', response_status = 201, response_payload = $1, completed_at = NOW(), updated_at = NOW(), lock_owner = NULL, locked_at = NULL, resource_type = 'tenant', resource_id = $3
               WHERE id = $2`,
              [JSON.stringify(responsePayload), record.id, tenantId]
            );
            await client.query("COMMIT");
            return { status: 201, payload: responsePayload };
          }

          // Resource does not exist, claim a new lease
          const leaseClaimRes = await client.query(
            `UPDATE idempotency_record
             SET locked_at = NOW(),
                 lock_owner = $1,
                 attempt_count = attempt_count + 1,
                 updated_at = NOW()
             WHERE id = $2
               AND status = 'processing'
               AND (
                 lock_owner IS NULL
                 OR locked_at IS NULL
                 OR locked_at < NOW() - make_interval(secs => $3)
               )`,
            [lockOwner, record.id, leaseSeconds]
          );
          if (leaseClaimRes.rowCount === 0) {
            await client.query("ROLLBACK");
            return {
              status: 425,
              payload: { error: "Failed to claim lease on idempotency record." },
            };
          }
        } else if (record.status === "failed") {
          // Re-claim lease on failed records
          const failedReclaimRes = await client.query(
            `UPDATE idempotency_record
             SET status = 'processing',
                 locked_at = NOW(),
                 lock_owner = $1,
                 attempt_count = attempt_count + 1,
                 updated_at = NOW()
             WHERE id = $2 AND status = 'failed'`,
            [lockOwner, record.id]
          );
          if (failedReclaimRes.rowCount === 0) {
            await client.query("ROLLBACK");
            return {
              status: 425,
              payload: { error: "Failed to reclaim failed idempotency record." },
            };
          }
        }
      } else {
        // Create new idempotency record in 'processing' status
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        const insertRes = await client.query(
          `INSERT INTO idempotency_record (
             actor_user_id, idempotency_key, operation_name, request_hash, status, expires_at, locked_at, lock_owner, attempt_count
           ) VALUES ($1, $2, $3, $4, 'processing', $5, NOW(), $6, 1)
           RETURNING id`,
          [actorUserId, idempotencyKey, operationName, requestHash, expiresAt, lockOwner]
        );
        recordId = insertRes.rows[0].id;
      }

      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    } finally {
      client.release();
    }

    // 3. Execute transactional provisioning
    const txClient = await this.pool.connect();
    try {
      await txClient.query("BEGIN");

      // Check slug collision
      const slugCheck = await txClient.query(
        "SELECT id FROM tenant WHERE slug = $1",
        [input.slug]
      );
      if (slugCheck.rows.length > 0) {
        throw new Error(`CONFL:Slug ${input.slug} is already taken.`);
      }

      // Create Tenant
      const tenantId = crypto.randomUUID();
      await txClient.query(
        `INSERT INTO tenant (id, name, slug, type, status, is_system)
         VALUES ($1, $2, $3, $4, 'active', FALSE)`,
        [tenantId, input.name, input.slug, input.type]
      );

      // Create Organization
      const orgId = crypto.randomUUID();
      await txClient.query(
        `INSERT INTO organization (id, tenant_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        [orgId, tenantId, `${input.name} headquarters`]
      );

      // Resolve or create identity user
      let userId = "";
      const emailNormalized = input.adminEmail.trim().toLowerCase();
      const userCheck = await txClient.query(
        "SELECT id, status FROM user_account WHERE tenant_id = $1 AND email = $2",
        [tenantId, emailNormalized]
      );

      if (userCheck.rows.length > 0) {
        userId = userCheck.rows[0].id;
      } else {
        userId = crypto.randomUUID();
        const dummyHash = "invited-placeholder-hash-" + crypto.randomBytes(16).toString("hex");
        await txClient.query(
          `INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
           VALUES ($1, $2, $3, $4, $5, '', 'invited')`,
          [userId, tenantId, emailNormalized, dummyHash, input.adminName]
        );
      }

      // Seed roles
      const roleMap = new Map<string, string>();
      for (const r of DEFAULT_SEED_ROLES) {
        const rId = crypto.randomUUID();
        await txClient.query(
          `INSERT INTO role (id, tenant_id, name, description, is_system)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [rId, tenantId, r.name, r.description]
        );
        roleMap.set(r.name, rId);
      }

      // Seed permissions and map to roles
      const superAdminRoleId = roleMap.get("super_admin")!;
      const directorRoleId = roleMap.get("director")!;
      const inspectorRoleId = roleMap.get("inspector")!;

      for (const perm of DEFAULT_SEED_PERMISSIONS) {
        const permRes = await txClient.query(
          `INSERT INTO permission (tenant_id, name, description)
           VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, perm, `Permission to ${perm}`]
        );
        const permId = permRes.rows[0].id;

        // Map everything to super_admin
        await txClient.query(
          `INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)`,
          [superAdminRoleId, permId]
        );

        // Map officer perms
        if (OFFICER_PERMS.includes(perm)) {
          await txClient.query(
            `INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)`,
            [directorRoleId, permId]
          );
          await txClient.query(
            `INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)`,
            [inspectorRoleId, permId]
          );
        }
      }

      // Create membership
      await txClient.query(
        `INSERT INTO membership (tenant_id, user_id, organization_id, role_id, status)
         VALUES ($1, $2, $3, $4, 'invited')`,
        [tenantId, userId, orgId, superAdminRoleId]
      );

      // Create hashed invitation
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await txClient.query(
        `INSERT INTO user_invitation (
          id, tenant_id, email_normalized, display_email, invitation_type,
          role_id, token_hash, status, expires_at, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, 'tenant_admin_activation', $5, $6, 'pending', $7, $8, NOW())`,
        [
          invitationId,
          tenantId,
          emailNormalized,
          input.adminEmail.trim(),
          superAdminRoleId,
          tokenHash,
          expiresAt,
          actorUserId,
        ]
      );

      // Encrypt GCM payload for the outbox
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey || encryptionKey.length !== 64) {
        throw new Error("ENCRYPTION_KEY must be set in env and be exactly 64 hex characters (32 bytes)");
      }

      const envelopePayload = {
        invitationId,
        recipientEmail: emailNormalized,
        activationUrl: buildInvitationActivationUrl(
          process.env.PUBLIC_WEB_URL || "http://localhost:3000",
          rawToken,
        ),
        expiresAt: expiresAt.toISOString(),
        tenantName: input.name,
      };

      const encryptedEnvelope = encryptPayload(envelopePayload, encryptionKey, "v1");

      // Insert Task Outbox record
      const taskId = `task-${crypto.randomUUID()}`;
      await txClient.query(
        `INSERT INTO task_execution (
           tenant_id, task_id, task_type, payload_hash, status, available_at, attempt_count, max_attempts, encrypted_payload
         ) VALUES ($1, $2, 'govos.notification.invitation.send', $3, 'pending', NOW(), 0, 5, $4)`,
        [tenantId, taskId, tokenHash, JSON.stringify(encryptedEnvelope)]
      );

      // Audit Log with explicit correlation metadata
      await txClient.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'TENANT_CREATED', $3, 'allow', $4)`,
        [
          tenantId,
          actorUserId,
          `tenant:${tenantId}`,
          JSON.stringify({
            tenantId,
            slug: input.slug,
            orgId,
            taskId,
            invitationId,
            idempotencyRecordId: recordId,
            provisioningCorrelationId: recordId,
          }),
        ]
      );

      const responsePayload = {
        tenantId,
        organizationId: orgId,
        adminUserId: userId,
        taskId,
        invitationId,
      };

      // Complete Idempotency record with explicit resource reference within the same transaction
      const idempUpdateRes = await txClient.query(
        `UPDATE idempotency_record
         SET status = 'completed', response_status = 201, response_payload = $1, completed_at = NOW(), updated_at = NOW(), lock_owner = NULL, locked_at = NULL, resource_type = 'tenant', resource_id = $4
         WHERE id = $2 AND lock_owner = $3 AND status = 'processing'`,
        [JSON.stringify(responsePayload), recordId, lockOwner, tenantId]
      );
      if (idempUpdateRes.rowCount === 0) {
        throw new Error("Losing lease: another worker took over the lease.");
      }

      await txClient.query("COMMIT");

      return { status: 201, payload: responsePayload };
    } catch (err: any) {
      await txClient.query("ROLLBACK");

      // Check if collision error
      if (err.message && err.message.startsWith("CONFL:")) {
        // Log idempotency failure as failed operation
        const msg = err.message.substring(6);
        await this.pool.query(
          `UPDATE idempotency_record
           SET status = 'failed', response_status = 409, response_payload = $1, completed_at = NOW(), updated_at = NOW(), lock_owner = NULL, locked_at = NULL, last_error_code = 'CONFL'
           WHERE id = $2 AND lock_owner = $3`,
          [JSON.stringify({ error: msg }), recordId, lockOwner]
        );
        return { status: 409, payload: { error: msg } };
      }

      // Mark idempotency record as failed
      await this.pool.query(
        `UPDATE idempotency_record
         SET status = 'failed', response_status = 500, response_payload = $1, completed_at = NOW(), updated_at = NOW(), lock_owner = NULL, locked_at = NULL, last_error_code = 'ERROR'
         WHERE id = $2 AND lock_owner = $3`,
        [JSON.stringify({ error: err.message }), recordId, lockOwner]
      );

      throw err;
    } finally {
      txClient.release();
    }
  }
}
