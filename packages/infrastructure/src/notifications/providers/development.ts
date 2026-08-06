import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";
import { DevelopmentMailbox } from "../../development-mailbox.js";

export class DevelopmentProvider implements NotificationProviderContract {
  async send(
    envelope: DeliveryEnvelope,
    _configuration: any,
    _pool: any,
  ): Promise<ProviderSendResult> {
    const mailbox = new DevelopmentMailbox();

    // We need to bypass the strict payload requirement or map what we have.
    // DevelopmentMailbox requires a specific payload shape for old features,
    // we'll provide default fallbacks for now.
    const payload = {
      invitationId: envelope.deliveryId,
      recipientEmail: envelope.destinationValue,
      activationUrl: envelope.variables?.activationUrl,
      ...envelope.variables,
    } as any;

    try {
      await mailbox.deliver({
        notificationId: envelope.deliveryId,
        tenantId: envelope.tenantId,
        notificationType: envelope.channel,
        subject: envelope.subject || "",
        body: envelope.body,
        payload: payload,
        encryptionKey: process.env.ENCRYPTION_KEY || "",
      });
      return { status: "success" };
    } catch (err: any) {
      if (err.message === "Development notification provider is disabled") {
        return {
          status: "permanent_failure",
          errorMessageRedacted: err.message,
        };
      }
      return { status: "transient_failure", errorMessageRedacted: err.message };
    }
  }
}
