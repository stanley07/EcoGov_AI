import { Pool } from "pg";
import { TaskExecutor, decryptPayload } from "@govos/core";
import { NotificationIntakeService } from "@govos/infrastructure";
import { logger } from "@govos/observability";

export class SendInvitationExecutor implements TaskExecutor {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public async execute(payload: Record<string, unknown>): Promise<void> {
    const { taskId } = payload as { taskId?: string };
    if (!taskId) {
      throw new Error("Missing taskId in payload");
    }

    // Retrieve encrypted payload from DB
    const res = await this.pool.query(
      "SELECT tenant_id, encrypted_payload FROM task_execution WHERE task_id = $1",
      [taskId],
    );

    if (res.rows.length === 0) {
      throw new Error(`Task ${taskId} not found in database`);
    }

    const envelope = res.rows[0].encrypted_payload;
    if (!envelope) {
      throw new Error(`Task ${taskId} does not have an encrypted payload`);
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error(
        "ENCRYPTION_KEY must be set in env and be exactly 64 hex characters (32 bytes)",
      );
    }

    // Decrypt GCM envelope safely
    const decrypted = decryptPayload(envelope, encryptionKey);

    // Validate decrypted payload fields
    if (
      !decrypted.invitationId ||
      !decrypted.recipientEmail ||
      !decrypted.activationUrl
    ) {
      throw new Error("Invalid decrypted task payload: missing fields");
    }

    const tenantId = String(res.rows[0].tenant_id);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const template = (
        await client.query(
          `INSERT INTO notification_template(tenant_id,semantic_key,name,allow_tenant_override) VALUES($1,'iam.invitation','GovOS invitation',false) ON CONFLICT(tenant_id,semantic_key) WHERE tenant_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`,
          [tenantId],
        )
      ).rows[0];
      let version = (
        await client.query(
          `SELECT id FROM notification_template_version WHERE tenant_id=$1 AND template_id=$2 AND status='published' ORDER BY version_number DESC LIMIT 1`,
          [tenantId, template.id],
        )
      ).rows[0];
      if (!version) {
        version = (
          await client.query(
            `INSERT INTO notification_template_version(tenant_id,template_id,version_number,status,variables_schema) VALUES($1,$2,1,'draft','{"type":"object","properties":{"activationUrl":{"type":"string"}},"required":["activationUrl"]}'::jsonb) RETURNING id`,
            [tenantId, template.id],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO notification_template_rendering(tenant_id,template_version_id,channel,locale,subject_template,body_template) VALUES($1,$2,'email','en','Your GovOS invitation is ready','A secure invitation is available for this recipient.')`,
          [tenantId, version.id],
        );
        await client.query(
          `UPDATE notification_template_version SET status='published',published_at=NOW() WHERE tenant_id=$1 AND id=$2`,
          [tenantId, version.id],
        );
      }
      await client.query(
        `INSERT INTO notification_template_binding(tenant_id,semantic_key,tenant_template_version_id,status) VALUES($1,'iam.invitation',$2,'active') ON CONFLICT(tenant_id,semantic_key) WHERE organization_id IS NULL AND status='active' DO NOTHING`,
        [tenantId, version.id],
      );
      await client.query(
        `INSERT INTO notification_provider(key,name,channel,configuration_secret_reference,is_active) VALUES('development','Development mailbox','email','none',true) ON CONFLICT(key) DO UPDATE SET is_active=true`,
      );
      const route = (
        await client.query(
          `INSERT INTO notification_provider_route(tenant_id,channel) VALUES($1,'email') ON CONFLICT(tenant_id,channel) DO UPDATE SET updated_at=NOW() RETURNING id`,
          [tenantId],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO notification_provider_route_entry(tenant_id,route_id,provider_key,priority) VALUES($1,$2,'development',0) ON CONFLICT(tenant_id,route_id,provider_key) DO NOTHING`,
        [tenantId, route.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await NotificationIntakeService.intake(this.pool, {
      tenantId,
      producerNamespace: "legacy.invitation",
      idempotencyKey: taskId,
      variables: {
        activationUrl: decrypted.activationUrl,
        invitationId: decrypted.invitationId,
      },
      classification: "standard",
      semanticKey: "iam.invitation",
      recipients: [
        {
          recipientType: "direct_destination",
          recipientValue: String(decrypted.recipientEmail),
        },
      ],
    });
    logger.info(
      {
        metric: "notification.compatibility.invitation.legacy_fallback_count",
        value: 1,
      },
      "Legacy invitation routed through canonical notification intake",
    );
  }
}
