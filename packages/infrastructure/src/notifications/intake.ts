import { Pool } from "pg";
import crypto from "crypto";
import { encryptForTenant } from "./encryption.js";
import { checkQuietHours } from "./quiet-hours.js";
import { validateTemplateVariables } from "./template-validator.js";

export interface CreateNotificationRequestInput {
  tenantId: string;
  organizationId?: string;
  producerNamespace: string;
  idempotencyKey: string;
  variables: Record<string, unknown>;
  classification: "standard" | "legal" | "emergency";
  priority?: number;
  semanticKey: string;
  recipients: Array<{
    recipientType:
      | "direct_user"
      | "direct_destination"
      | "role"
      | "organization"
      | "workflow_work_item"
      | "escalation_target";
    recipientValue: string;
  }>;
}

export class NotificationIntakeService {
  static async intake(
    pool: Pool,
    input: CreateNotificationRequestInput,
  ): Promise<{ requestId: string; state: string }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Enforce advisory locks for idempotency
      const lockKeyStr = `${input.tenantId}:${input.producerNamespace}:${input.idempotencyKey}`;
      const lockKey = crypto
        .createHash("md5")
        .update(lockKeyStr)
        .digest()
        .readInt32BE(0);
      await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

      // Check idempotency
      const existRes = await client.query(
        `
        SELECT id, state FROM notification_request
        WHERE tenant_id = $1 AND producer_namespace = $2 AND idempotency_key = $3
      `,
        [input.tenantId, input.producerNamespace, input.idempotencyKey],
      );

      if (existRes.rows.length > 0) {
        await client.query("COMMIT");
        return {
          requestId: existRes.rows[0].id,
          state: existRes.rows[0].state,
        };
      }

      // Resolve template binding
      const bindingQuery = input.organizationId
        ? `
          SELECT v.template_id, v.id as version_id, v.variables_schema, b.tenant_template_version_id, b.catalog_template_version_id, b.application_key
          FROM notification_template_binding b
          JOIN notification_template_version v ON v.id = COALESCE(b.tenant_template_version_id, b.catalog_template_version_id)
          WHERE b.tenant_id = $1 AND b.semantic_key = $2 AND (b.organization_id = $3 OR b.organization_id IS NULL)
            AND b.status = 'active' AND b.effective_from <= NOW() AND (b.effective_to IS NULL OR b.effective_to > NOW())
            AND v.status='published'
          ORDER BY b.organization_id DESC NULLS LAST LIMIT 1
          FOR UPDATE OF b, v
        `
        : `
          SELECT v.template_id, v.id as version_id, v.variables_schema, b.tenant_template_version_id, b.catalog_template_version_id, b.application_key
          FROM notification_template_binding b
          JOIN notification_template_version v ON v.id = COALESCE(b.tenant_template_version_id, b.catalog_template_version_id)
          WHERE b.tenant_id = $1 AND b.semantic_key = $2 AND b.organization_id IS NULL AND b.status = 'active'
            AND b.effective_from <= NOW() AND (b.effective_to IS NULL OR b.effective_to > NOW()) AND v.status='published'
          LIMIT 1
          FOR UPDATE OF b, v
        `;

      const bindingParams = input.organizationId
        ? [input.tenantId, input.semanticKey, input.organizationId]
        : [input.tenantId, input.semanticKey];

      const bindingRes = await client.query(bindingQuery, bindingParams);

      if (bindingRes.rows.length === 0) {
        const error = new Error("WF_BINDING_MISSING");
        (error as Error & { statusCode?: number }).statusCode = 422;
        throw error;
      }

      const {
        version_id: versionId,
        variables_schema: schema,
        tenant_template_version_id: tenantVersionId,
        catalog_template_version_id: catalogVersionId,
      } = bindingRes.rows[0];

      // Validate variables
      const validRes = validateTemplateVariables(schema, input.variables);
      if (!validRes.valid) {
        throw new Error(
          "Invalid template variables: " + JSON.stringify(validRes.errors),
        );
      }

      // Insert request
      const reqRes = await client.query(
        `
        INSERT INTO notification_request (
          tenant_id, organization_id, producer_namespace, idempotency_key,
          classification, priority, state, semantic_key,
        tenant_template_version_id, catalog_template_version_id, application_key, variables
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `,
        [
          input.tenantId,
          input.organizationId,
          input.producerNamespace,
          input.idempotencyKey,
          input.classification,
          input.priority || 0,
          "accepted",
          input.semanticKey,
          tenantVersionId || null,
          catalogVersionId || null,
          bindingRes.rows[0].application_key || null,
          input.variables,
        ],
      );

      const requestId = reqRes.rows[0].id;

      // Resolve channels for this version
      const channelsRes = await client.query(
        `
        SELECT channel
        FROM notification_template_rendering
        WHERE template_version_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
      `,
        [versionId, input.tenantId],
      );

      const channels = channelsRes.rows.map(
        (r) => r.channel as "email" | "sms" | "in-app" | "webhook",
      );

      // Resolve recipients to user IDs or direct destinations
      const resolvedRecipients: Array<{
        recipientType: string;
        recipientValue: string;
        resolvedUserId: string | null;
      }> = [];

      for (const r of input.recipients) {
        if (r.recipientType === "direct_user") {
          const active = await client.query(
            `SELECT u.id FROM user_account u JOIN membership m ON m.tenant_id=u.tenant_id AND m.user_id=u.id AND m.status='active' WHERE u.tenant_id=$1 AND u.id=$2 AND u.status='active' AND ($3::uuid IS NULL OR m.organization_id=$3) LIMIT 1`,
            [input.tenantId, r.recipientValue, input.organizationId || null],
          );
          if (active.rowCount)
            resolvedRecipients.push({
              recipientType: "direct_user",
              recipientValue: r.recipientValue,
              resolvedUserId: r.recipientValue,
            });
        } else if (r.recipientType === "direct_destination") {
          resolvedRecipients.push({
            recipientType: "direct_destination",
            recipientValue: r.recipientValue,
            resolvedUserId: null,
          });
        } else if (r.recipientType === "role") {
          const usersRes = await client.query(
            `
            SELECT DISTINCT m.user_id as id
            FROM membership m
            JOIN role r ON m.role_id = r.id
            JOIN user_account u ON u.tenant_id=m.tenant_id AND u.id=m.user_id AND u.status='active'
            WHERE m.tenant_id = $1 AND r.id = $2 AND m.status = 'active' AND ($3::uuid IS NULL OR m.organization_id=$3)
          `,
            [input.tenantId, r.recipientValue, input.organizationId || null],
          );
          for (const u of usersRes.rows) {
            resolvedRecipients.push({
              recipientType: "role",
              recipientValue: r.recipientValue,
              resolvedUserId: u.id,
            });
          }
        } else if (r.recipientType === "organization") {
          const usersRes = await client.query(
            `
            SELECT DISTINCT user_id as id
            FROM membership
            WHERE tenant_id = $1 AND organization_id = $2 AND status = 'active'
          `,
            [input.tenantId, r.recipientValue],
          );
          for (const u of usersRes.rows) {
            resolvedRecipients.push({
              recipientType: "organization",
              recipientValue: r.recipientValue,
              resolvedUserId: u.id,
            });
          }
        } else if (
          r.recipientType === "workflow_work_item" ||
          r.recipientType === "escalation_target"
        ) {
          const usersRes = await client.query(
            `SELECT DISTINCT COALESCE(w.assignee_user_id,w.claimed_by) id FROM workflow_work_item w WHERE w.tenant_id=$1 AND w.id=$2 AND w.organization_id=$3 AND w.status IN ('open','claimed','in_progress')`,
            [input.tenantId, r.recipientValue, input.organizationId],
          );
          for (const u of usersRes.rows)
            if (u.id)
              resolvedRecipients.push({
                recipientType: r.recipientType,
                recipientValue: r.recipientValue,
                resolvedUserId: u.id,
              });
        }
      }

      // De-duplicate resolved recipients by (resolvedUserId, recipientValue)
      const uniqueRecipients = new Map<
        string,
        (typeof resolvedRecipients)[0]
      >();
      for (const rr of resolvedRecipients) {
        const key = rr.resolvedUserId
          ? `user:${rr.resolvedUserId}`
          : `val:${rr.recipientValue}`;
        if (!uniqueRecipients.has(key)) {
          uniqueRecipients.set(key, rr);
        }
      }

      let overallState = "accepted";

      for (const [_, rr] of uniqueRecipients) {
        // Insert Recipient record
        const recipInsRes = await client.query(
          `
          INSERT INTO notification_recipient (
            tenant_id, request_id, recipient_type, resolved_user_id
          ) VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
          [input.tenantId, requestId, rr.recipientType, rr.resolvedUserId],
        );
        const recipientId = recipInsRes.rows[0].id;

        // User lookup details if user
        let finalDestEmail = "";
        let finalDestPhone = "";

        if (rr.resolvedUserId) {
          const uRes = await client.query(
            "SELECT email FROM user_account WHERE tenant_id = $1 AND id = $2",
            [input.tenantId, rr.resolvedUserId],
          );
          if (uRes.rows.length > 0) {
            finalDestEmail = uRes.rows[0].email;
          }
        }

        for (const channel of channels) {
          // Determine plaintext destination value
          let destVal = "";
          if (rr.recipientType === "direct_destination") {
            if (channel === "email" && rr.recipientValue.includes("@"))
              destVal = rr.recipientValue;
            if (channel === "sms" && !rr.recipientValue.includes("@"))
              destVal = rr.recipientValue;
            if (
              channel === "webhook" &&
              (rr.recipientValue.startsWith("http://") ||
                rr.recipientValue.startsWith("https://"))
            )
              destVal = rr.recipientValue;
          } else if (rr.resolvedUserId) {
            if (channel === "email") destVal = finalDestEmail;
            if (channel === "sms") destVal = finalDestPhone;
            if (channel === "in-app") destVal = rr.resolvedUserId;
          }
          if (!destVal) continue;

          // Check policy
          let skip = false;
          const policyRes = await client.query(
            `
            SELECT is_enabled FROM notification_channel_policy
            WHERE tenant_id = $1 AND channel = $2
            ${input.organizationId ? "AND (organization_id = $3 OR organization_id IS NULL)" : "AND organization_id IS NULL"}
            ORDER BY organization_id DESC NULLS LAST LIMIT 1
          `,
            input.organizationId
              ? [input.tenantId, channel, input.organizationId]
              : [input.tenantId, channel],
          );
          if (
            policyRes.rows.length > 0 &&
            policyRes.rows[0].is_enabled === false
          ) {
            skip = true;
          }

          // Check user preference
          if (!skip && rr.resolvedUserId) {
            const prefRes = await client.query(
              `
              SELECT is_subscribed FROM notification_user_preference
              WHERE tenant_id = $1 AND user_id = $2 AND channel = $3
            `,
              [input.tenantId, rr.resolvedUserId, channel],
            );
            if (
              prefRes.rows.length > 0 &&
              prefRes.rows[0].is_subscribed === false
            ) {
              skip = true;
            }
          }

          if (skip) continue;

          // Encrypt & hash destination value
          const digest = crypto
            .createHash("sha256")
            .update(destVal)
            .digest("hex");
          const encryptedDest = encryptForTenant(input.tenantId, destVal);

          // Check suppression
          const suppRes = await client.query(
            `
            SELECT id FROM notification_suppression
            WHERE tenant_id = $1 AND channel = $2 AND destination_digest = $3
          `,
            [input.tenantId, channel, digest],
          );
          if (suppRes.rows.length > 0) {
            continue;
          }

          // Scheduling
          let scheduledAt = new Date(Date.now() - 60000);
          let state = "queued";

          if (input.classification !== "emergency") {
            const inQuietHours = await checkQuietHours(
              input.tenantId,
              rr.resolvedUserId,
              channel,
              pool,
              false,
            );
            if (inQuietHours) {
              state = "scheduled";
              // Set to end of quiet hours or default delay
              scheduledAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
            }
          }

          if (state === "scheduled") {
            overallState = "scheduled";
          }

          // Insert destination
          const destInsRes = await client.query(
            `
            INSERT INTO notification_destination (
              tenant_id, recipient_id, channel, encrypted_value, destination_digest
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `,
            [input.tenantId, recipientId, channel, encryptedDest, digest],
          );
          const destinationId = destInsRes.rows[0].id;

          // Insert delivery
          const delivRes = await client.query(
            `
            INSERT INTO notification_delivery (
              tenant_id, request_id, destination_id, channel, state, scheduled_at, next_attempt_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $6)
            RETURNING id
          `,
            [
              input.tenantId,
              requestId,
              destinationId,
              channel,
              state,
              scheduledAt,
            ],
          );
          const deliveryId = delivRes.rows[0].id;

          const taskId = crypto.randomUUID();
          const payloadHash = crypto
            .createHash("sha256")
            .update(`${input.tenantId}:${deliveryId}`)
            .digest("hex");
          const taskRes = await client.query(
            `INSERT INTO task_execution(tenant_id,task_id,task_type,payload_hash,status,available_at,max_attempts) VALUES($1,$2,'govos.notification.delivery.v1',$3,'pending',$4,5) RETURNING id`,
            [input.tenantId, taskId, payloadHash, scheduledAt],
          );
          await client.query(
            `UPDATE notification_delivery SET task_execution_id=$1 WHERE tenant_id=$2 AND id=$3`,
            [taskRes.rows[0].id, input.tenantId, deliveryId],
          );

          // Insert delivery status history
          await client.query(
            `
            INSERT INTO notification_delivery_status_history (
              tenant_id, request_id, delivery_id, sequence, old_state, new_state, transition_reason
            ) VALUES (
              $1, $2, $3,
              COALESCE((SELECT MAX(sequence) FROM notification_delivery_status_history WHERE request_id = $2), 0) + 1,
              NULL, $4, $5
            )
          `,
            [
              input.tenantId,
              requestId,
              deliveryId,
              state,
              "Initial state from intake",
            ],
          );
        }
      }

      // Update request state
      await client.query(
        `
        UPDATE notification_request
        SET state = $1, updated_at = NOW(), version = version + 1
        WHERE id = $2
      `,
        [overallState, requestId],
      );

      await client.query("COMMIT");
      return { requestId, state: overallState };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
