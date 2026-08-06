import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";

export class EmailProvider implements NotificationProviderContract {
  async send(
    envelope: DeliveryEnvelope,
    configuration: any,
    _pool: any,
  ): Promise<ProviderSendResult> {
    // Simulate some logic with config
    const failureRate = configuration?.failureRate || 0;
    if (Math.random() < failureRate) {
      return {
        status: "transient_failure",
        errorMessageRedacted: "Simulated failure",
      };
    }

    return {
      status: "success",
      providerMessageId: `email-${envelope.deliveryId}`,
    };
  }
}
