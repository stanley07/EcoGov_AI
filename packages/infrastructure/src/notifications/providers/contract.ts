export interface DeliveryEnvelope {
  tenantId: string;
  requestId: string;
  deliveryId: string;
  channel: "email" | "sms" | "in-app" | "webhook";
  destinationValue: string; // Plaintext (decrypted) destination
  subject?: string;
  body: string;
  variables: Record<string, any>;
  classification: "standard" | "legal" | "emergency";
  recipientUserId?: string; // Helpful for in-app insertions
}

export interface ProviderSendResult {
  status:
    | "success"
    | "transient_failure"
    | "permanent_failure"
    | "rate_limited"
    | "ambiguous";
  providerMessageId?: string;
  errorCode?: string;
  errorMessageRedacted?: string;
}

export interface NotificationProviderContract {
  send(
    envelope: DeliveryEnvelope,
    configuration: any,
    pool: any,
  ): Promise<ProviderSendResult>;
}
