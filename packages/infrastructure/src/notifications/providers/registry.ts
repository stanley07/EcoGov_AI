import { Pool } from "pg";
import {
  DeliveryEnvelope,
  ProviderSendResult,
  NotificationProviderContract,
} from "./contract.js";
import { DevelopmentProvider } from "./development.js";
import { EmailProvider } from "./email.js";
import { SmsProvider } from "./sms.js";
import { InAppProvider } from "./in-app.js";
import { WebhookProvider } from "./webhook.js";
import { decryptForTenant } from "../encryption.js";

export interface DeliveryLeaseContext {
  tenantId: string;
  taskId: string;
  owner: string;
  fencingToken: string;
}

export function getProviderAdapter(key: string): NotificationProviderContract {
  switch (key) {
    case "development":
      return new DevelopmentProvider();
    case "email":
    case "system-email":
      return new EmailProvider();
    case "sms":
    case "system-sms":
      return new SmsProvider();
    case "in-app":
    case "system-in-app":
      return new InAppProvider();
    case "webhook":
    case "system-webhook":
      return new WebhookProvider();
    default:
      throw new Error(`Unsupported provider key: ${key}`);
  }
}

export async function sendDelivery(
  pool: Pool,
  deliveryId: string,
  lease: DeliveryLeaseContext,
): Promise<ProviderSendResult> {
  const deliveryQuery = `
    SELECT
      d.id as delivery_id,
      d.tenant_id,
      d.channel,
      d.request_id,
      dest.encrypted_value,
      dest.recipient_id,
      req.variables,
      req.classification,
      COALESCE(tr.subject_template, 'No Subject') as subject,
      COALESCE(tr.body_template, 'No Body') as body,
      r.resolved_user_id
    FROM notification_delivery d
    JOIN notification_destination dest ON dest.tenant_id=d.tenant_id AND d.destination_id = dest.id
    JOIN notification_request req ON req.tenant_id=d.tenant_id AND d.request_id = req.id
    LEFT JOIN notification_template_rendering tr ON tr.template_version_id = COALESCE(req.tenant_template_version_id, req.catalog_template_version_id) AND tr.channel = d.channel
    LEFT JOIN notification_recipient r ON r.tenant_id=d.tenant_id AND dest.recipient_id = r.id
    JOIN task_execution te ON te.tenant_id=d.tenant_id AND te.id=d.task_execution_id
    WHERE d.id = $1 AND d.tenant_id=$2 AND te.id=$3 AND te.status='processing' AND te.lease_owner=$4 AND te.fencing_token=$5 AND te.lease_expires_at>NOW()
  `;

  const deliveryResult = await pool.query(deliveryQuery, [
    deliveryId,
    lease.tenantId,
    lease.taskId,
    lease.owner,
    lease.fencingToken,
  ]);

  if (deliveryResult.rowCount === 0) {
    throw new Error("Delivery not found");
  }

  const delivery = deliveryResult.rows[0];
  const tenantId = delivery.tenant_id;

  // Decrypt destination value
  let destinationValue = "";
  try {
    destinationValue = decryptForTenant(tenantId, delivery.encrypted_value);
  } catch (err) {
    // If we fail to decrypt, permanent failure
    await appendStatus(
      pool,
      tenantId,
      delivery.request_id,
      deliveryId,
      "queued",
      "permanent_failed",
      "Failed to decrypt destination",
    );
    return {
      status: "permanent_failure",
      errorMessageRedacted: "Failed to decrypt destination",
    };
  }

  // Resolve Provider Key
  const routeQuery = `
    SELECT pre.provider_key
    FROM notification_provider_route pr
    JOIN notification_provider_route_entry pre ON pr.id = pre.route_id
    WHERE pr.tenant_id = $1 AND pr.channel = $2
    ORDER BY pre.priority DESC
    LIMIT 1
  `;
  const routeResult = await pool.query(routeQuery, [
    tenantId,
    delivery.channel,
  ]);
  const providerKey =
    routeResult.rowCount && routeResult.rowCount > 0
      ? routeResult.rows[0].provider_key
      : null;

  if (!providerKey)
    return {
      status: "permanent_failure",
      errorCode: "PROVIDER_ROUTE_MISSING",
      errorMessageRedacted: "Provider route unavailable",
    };

  let configuration = {};

  // Fetch Provider Config
  const providerQuery = `
    SELECT configuration_secret_reference
    FROM notification_provider
    WHERE key = $1 AND is_active = TRUE
  `;
  const providerResult = await pool.query(providerQuery, [providerKey]);

  if (providerResult.rowCount && providerResult.rowCount > 0) {
    const reference = String(
      providerResult.rows[0].configuration_secret_reference,
    );
    const envName = `GOVOS_SECRET_${reference.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
    const value = process.env[envName];
    if (providerKey !== "development" && !value)
      return {
        status: "permanent_failure",
        errorCode: "PROVIDER_SECRET_UNAVAILABLE",
        errorMessageRedacted: "Provider configuration unavailable",
      };
    configuration = value ? JSON.parse(value) : {};
  }

  const envelope: DeliveryEnvelope = {
    tenantId: tenantId,
    requestId: delivery.request_id,
    deliveryId: delivery.delivery_id,
    channel: delivery.channel,
    destinationValue: destinationValue,
    subject: delivery.subject,
    body: delivery.body,
    variables: delivery.variables,
    classification: delivery.classification,
    recipientUserId: delivery.resolved_user_id,
  };

  const adapter = getProviderAdapter(providerKey);

  const startTime = Date.now();
  const sendResult = await adapter.send(envelope, configuration, pool);
  const latencyMs = Date.now() - startTime;

  // Map ProviderSendResult to delivery state
  let newState = "delivered";
  if (sendResult.status === "transient_failure") newState = "transient_failed";
  else if (sendResult.status === "permanent_failure")
    newState = "permanent_failed";
  else if (sendResult.status === "rate_limited") newState = "rate_limited";
  else if (sendResult.status === "ambiguous") newState = "transient_failed";

  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const fence = await client.query(
      `SELECT 1 FROM task_execution WHERE tenant_id=$1 AND id=$2 AND status='processing' AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>NOW() FOR UPDATE`,
      [tenantId, lease.taskId, lease.owner, lease.fencingToken],
    );
    if (!fence.rowCount) throw new Error("notification lease lost");
    // Insert attempt
    await client.query(
      `
      INSERT INTO notification_delivery_attempt (
        tenant_id, delivery_id, attempt_number, provider_key,
        status, error_code, error_message_redacted, provider_message_id, latency_ms
      ) VALUES ($1, $2,
        COALESCE((SELECT MAX(attempt_number) FROM notification_delivery_attempt WHERE delivery_id = $2), 0) + 1,
        $3, $4, $5, $6, $7, $8)
    `,
      [
        tenantId,
        deliveryId,
        providerKey,
        sendResult.status,
        sendResult.errorCode || null,
        sendResult.errorMessageRedacted || null,
        sendResult.providerMessageId || null,
        latencyMs,
      ],
    );

    // Update delivery state
    await client.query(
      `
      UPDATE notification_delivery
      SET state = $1, provider_message_id=$3, updated_at = NOW(), version = version + 1
      WHERE tenant_id=$4 AND id = $2 AND task_execution_id=$5
    `,
      [
        newState,
        deliveryId,
        sendResult.providerMessageId || null,
        tenantId,
        lease.taskId,
      ],
    );

    // Insert history
    await appendStatus(
      client,
      tenantId,
      delivery.request_id,
      deliveryId,
      "sending",
      newState,
      sendResult.errorMessageRedacted || "Provider transition",
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return sendResult;
}

async function appendStatus(
  pool: Pick<Pool, "query">,
  tenantId: string,
  requestId: string,
  deliveryId: string,
  oldState: string,
  newState: string,
  reason: string,
) {
  await pool.query(
    `
    INSERT INTO notification_delivery_status_history (
      tenant_id, request_id, delivery_id, sequence, old_state, new_state, transition_reason
    ) VALUES ($1, $2, $3,
      COALESCE((SELECT MAX(sequence) FROM notification_delivery_status_history WHERE request_id = $2), 0) + 1,
      $4, $5, $6)
  `,
    [tenantId, requestId, deliveryId, oldState, newState, reason],
  );
}
