import { Pool } from "pg";
import { TaskExecutor, decryptPayload } from "@govos/core";
import { DevelopmentMailbox, DevelopmentNotificationPayload } from "@govos/infrastructure";

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
      [taskId]
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
      throw new Error("ENCRYPTION_KEY must be set in env and be exactly 64 hex characters (32 bytes)");
    }

    // Decrypt GCM envelope safely
    const decrypted = decryptPayload(envelope, encryptionKey);

    // Validate decrypted payload fields
    if (!decrypted.invitationId || !decrypted.recipientEmail || !decrypted.activationUrl) {
      throw new Error("Invalid decrypted task payload: missing fields");
    }

    if (process.env.GOVOS_NOTIFICATION_PROVIDER === "development") {
      await new DevelopmentMailbox().deliver({
        notificationId: taskId,
        tenantId: res.rows[0].tenant_id,
        notificationType: "tenant-invitation",
        subject: "Your GovOS invitation is ready",
        body: "A secure invitation is available for this recipient in the protected development mailbox.",
        payload: decrypted as DevelopmentNotificationPayload,
        encryptionKey,
      });
      return;
    }

    // Mask recipient email for logging
    const emailParts = (decrypted.recipientEmail as string).split("@");
    const firstPart = emailParts[0] || "";
    const secondPart = emailParts[1] || "";
    const maskedEmail = (firstPart[0] || "") + "***@" + secondPart;

    // Log only non-sensitive metadata (no raw token, no activation URL)
    console.log(`[Worker] Processing invitation sending for user: ${maskedEmail}`);
    console.log(`Invitation notification queued for ${maskedEmail}`);
  }
}
