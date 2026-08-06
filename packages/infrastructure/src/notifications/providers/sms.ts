import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";

export class SmsProvider implements NotificationProviderContract {
  async send(
    envelope: DeliveryEnvelope,
    configuration: any,
    _pool: any,
  ): Promise<ProviderSendResult> {
    const failureRate = configuration?.failureRate || 0;
    if (Math.random() < failureRate) {
      return {
        status: "transient_failure",
        errorMessageRedacted: "Simulated failure",
      };
    }

    return {
      status: "success",
      providerMessageId: `sms-${envelope.deliveryId}`,
    };
  }
}
