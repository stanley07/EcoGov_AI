import * as crypto from "node:crypto";
import * as https from "node:https";
import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";
import { validateWebhookUrl } from "../ssrf-webhook.js";

export class WebhookProvider implements NotificationProviderContract {
  async send(
    envelope: DeliveryEnvelope,
    configuration: any,
  ): Promise<ProviderSendResult> {
    try {
      const target = await validateWebhookUrl(envelope.destinationValue);
      const secret = String(configuration?.secret || "");
      const keyId = String(configuration?.keyId || "");
      if (!secret || !keyId)
        return {
          status: "permanent_failure",
          errorCode: "WEBHOOK_KEY_MISSING",
          errorMessageRedacted: "Webhook signing configuration unavailable",
        };
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomUUID();
      const body = JSON.stringify({
        requestId: envelope.requestId,
        deliveryId: envelope.deliveryId,
        subject: envelope.subject,
        body: envelope.body,
        variables: envelope.variables,
        classification: envelope.classification,
      });
      const signature = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${nonce}.${body}`)
        .digest("hex");
      const status = await new Promise<number>((resolve, reject) => {
        const request = https.request(
          {
            protocol: "https:",
            hostname: target.url.hostname,
            port: target.url.port || 443,
            path: `${target.url.pathname}${target.url.search}`,
            method: "POST",
            servername: target.url.hostname,
            rejectUnauthorized: true,
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              "x-govos-timestamp": timestamp,
              "x-govos-nonce": nonce,
              "x-govos-key-id": keyId,
              "x-govos-signature": signature,
            },
            lookup: (_hostname, _opts, callback) =>
              callback(null, target.address, target.family),
          },
          (response) => {
            response.resume();
            resolve(response.statusCode || 0);
          },
        );
        request.setTimeout(10000, () => request.destroy(new Error("timeout")));
        request.on("error", reject);
        request.end(body);
      });
      if (status >= 200 && status < 300) return { status: "success" };
      if (status === 429) return { status: "rate_limited" };
      if (status >= 500) return { status: "transient_failure" };
      return {
        status: "permanent_failure",
        errorMessageRedacted: "Webhook rejected request",
      };
    } catch (error) {
      return {
        status: "permanent_failure",
        errorMessageRedacted: "Webhook delivery blocked or failed",
      };
    }
  }
}
