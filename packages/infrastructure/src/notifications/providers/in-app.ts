import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";

export class InAppProvider implements NotificationProviderContract {
  async send(
    envelope: DeliveryEnvelope,
    _configuration: any,
    pool: any,
  ): Promise<ProviderSendResult> {
    if (!envelope.recipientUserId) {
      return {
        status: "permanent_failure",
        errorMessageRedacted:
          "Missing recipientUserId in envelope for in-app delivery.",
      };
    }

    try {
      const sanitize = (value: string) =>
        value
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim();
      const subject = sanitize(envelope.subject || "Notification").slice(
        0,
        255,
      );
      const renderedBody = sanitize(envelope.body).slice(0, 20000);
      const bodyPreview = renderedBody.substring(0, 500);

      const query = `
        INSERT INTO notification_inbox_item (
          tenant_id,
          user_id,
          delivery_id,
          subject,
          body_preview,
          rendered_body
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;
      const values = [
        envelope.tenantId,
        envelope.recipientUserId,
        envelope.deliveryId,
        subject,
        bodyPreview,
        renderedBody,
      ];

      const result = await pool.query(query, values);

      return {
        status: "success",
        providerMessageId: result.rows[0].id,
      };
    } catch (error: any) {
      const isConstraintError = error.code && error.code.startsWith("23");
      return {
        status: isConstraintError ? "permanent_failure" : "transient_failure",
        errorMessageRedacted: `Failed to insert notification_inbox_item: ${error.message}`,
      };
    }
  }
}
