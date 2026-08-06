import { FastifyInstance, FastifyRequest } from "fastify";
import { Pool } from "pg";
import * as crypto from "node:crypto";
import { NotificationIntakeService } from "@govos/infrastructure";

async function permitted(
  pool: Pool,
  req: FastifyRequest,
  name: string,
): Promise<boolean> {
  const user = req.user;
  if (!user) return false;
  const result = await pool.query(
    `SELECT 1 FROM membership m JOIN role_permission rp ON rp.role_id=m.role_id JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND p.name=$3 LIMIT 1`,
    [user.tenantId, user.userId, name],
  );
  return Boolean(result.rowCount);
}
const safeError = (reply: any, status = 400) =>
  reply
    .status(status)
    .send({
      code: "NOTIFICATION_REQUEST_REJECTED",
      message: "Notification operation could not be completed",
    });

export function notificationRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  app.post("/v1/notifications/requests", async (req, reply) => {
    if (!req.user) return safeError(reply, 401);
    if (!(await permitted(pool, req, "notification:request:create")))
      return safeError(reply, 403);
    const body = req.body as any;
    if (
      body?.classification === "emergency" &&
      !(await permitted(pool, req, "notification:request:create:emergency"))
    )
      return safeError(reply, 403);
    if (
      body?.recipients?.some(
        (r: any) => r?.recipientType === "direct_destination",
      ) &&
      !(await permitted(pool, req, "notification:request:create:direct"))
    )
      return safeError(reply, 403);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key || key.length > 255)
      return safeError(reply, 400);
    try {
      const result = await NotificationIntakeService.intake(pool, {
        ...body,
        tenantId: req.user.tenantId,
        idempotencyKey: key,
      });
      return reply
        .status(202)
        .send({ requestId: result.requestId, state: result.state });
    } catch (error) {
      const status =
        (error as Error & { statusCode?: number }).statusCode || 400;
      return safeError(reply, status);
    }
  });

  app.post(
    "/internal/notifications/provider-callbacks/:callbackEndpointId",
    async (req, reply) => {
      const generic = () => reply.status(200).send({ received: true });
      try {
        const { callbackEndpointId } = req.params as {
          callbackEndpointId: string;
        };
        const endpoint = (
          await pool.query(
            `SELECT id,tenant_id,provider_key,signature_algorithm,verification_key_reference,replay_window_seconds FROM notification_provider_callback_endpoint WHERE opaque_endpoint_id=$1 AND is_active=true`,
            [callbackEndpointId],
          )
        ).rows[0];
        if (!endpoint) return generic();
        const timestamp = String(req.headers["x-provider-timestamp"] || "");
        const nonce = String(req.headers["x-provider-nonce"] || "");
        const supplied = String(req.headers["x-provider-signature"] || "");
        const seconds = Number(timestamp);
        if (
          !nonce ||
          !supplied ||
          !Number.isFinite(seconds) ||
          Math.abs(Date.now() / 1000 - seconds) > endpoint.replay_window_seconds
        )
          return generic();
        const secret =
          process.env[
            `GOVOS_SECRET_${String(endpoint.verification_key_reference)
              .replace(/[^A-Za-z0-9]/g, "_")
              .toUpperCase()}`
          ];
        if (!secret) return generic();
        const raw =
          (req as any).rawBody instanceof Buffer
            ? (req as any).rawBody
            : Buffer.from(JSON.stringify(req.body));
        const expected = crypto
          .createHmac("sha256", secret)
          .update(Buffer.concat([Buffer.from(`${timestamp}.${nonce}.`), raw]))
          .digest();
        let actual: Buffer;
        try {
          actual = Buffer.from(supplied, "hex");
        } catch {
          return generic();
        }
        if (
          actual.length !== expected.length ||
          !crypto.timingSafeEqual(actual, expected)
        )
          return generic();
        const body = req.body as any;
        const messageId = String(body?.provider_message_id || "");
        if (!messageId) return generic();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const reservation = await client.query(
            `INSERT INTO notification_provider_callback(tenant_id,endpoint_id,provider_message_id,raw_payload_redacted,callback_nonce,payload_hash) VALUES($1,$2,$3,'{}',$4,$5) ON CONFLICT(tenant_id,endpoint_id,callback_nonce) DO NOTHING RETURNING id`,
            [
              endpoint.tenant_id,
              endpoint.id,
              messageId,
              nonce,
              crypto.createHash("sha256").update(raw).digest("hex"),
            ],
          );
          if (!reservation.rowCount) {
            await client.query("ROLLBACK");
            return generic();
          }
          const delivery = (
            await client.query(
              `SELECT id,request_id,state FROM notification_delivery WHERE tenant_id=$1 AND provider_message_id=$2 FOR UPDATE`,
              [endpoint.tenant_id, messageId],
            )
          ).rows[0];
          if (
            delivery &&
            ["provider_accepted", "sending"].includes(delivery.state) &&
            body.status === "delivered"
          ) {
            await client.query(
              `UPDATE notification_delivery SET state='delivered',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND state=$3`,
              [endpoint.tenant_id, delivery.id, delivery.state],
            );
            await client.query(
              `INSERT INTO notification_delivery_status_history(tenant_id,request_id,delivery_id,sequence,old_state,new_state,transition_reason,provider_callback_id) SELECT $1,$2,$3,COALESCE(MAX(sequence),0)+1,$4,'delivered','PROVIDER_CALLBACK',$5 FROM notification_delivery_status_history WHERE tenant_id=$1 AND request_id=$2`,
              [
                endpoint.tenant_id,
                delivery.request_id,
                delivery.id,
                delivery.state,
                reservation.rows[0].id,
              ],
            );
          }
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
        return generic();
      } catch {
        return generic();
      }
    },
  );

  app.get("/v1/notifications/inbox", async (req, reply) => {
    if (!req.user) return safeError(reply, 401);
    if (!(await permitted(pool, req, "notification:inbox:read")))
      return safeError(reply, 403);
    const q = req.query as { cursor?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    let cursorDate: string | null = null,
      cursorId: string | null = null;
    if (q.cursor) {
      try {
        const parts = Buffer.from(q.cursor, "base64url").toString().split("|");
        cursorDate = parts[0] || null;
        cursorId = parts[1] || null;
      } catch {
        return safeError(reply, 400);
      }
    }
    const result = await pool.query(
      `SELECT id,delivery_id,status,subject,body_preview,rendered_body,created_at,version FROM notification_inbox_item WHERE tenant_id=$1 AND user_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
      [req.user.tenantId, req.user.userId, cursorDate, cursorId, limit + 1],
    );
    const items = result.rows.slice(0, limit);
    const last = items[items.length - 1];
    return reply.send({
      items,
      nextCursor:
        result.rows.length > limit && last
          ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString(
              "base64url",
            )
          : null,
    });
  });

  for (const [action, state] of [
    ["read", "read"],
    ["unread", "unread"],
    ["archive", "archived"],
  ] as const)
    app.post(`/v1/notifications/inbox/:id/${action}`, async (req, reply) => {
      if (!req.user) return safeError(reply, 401);
      if (!(await permitted(pool, req, "notification:inbox:manage")))
        return safeError(reply, 403);
      const expected = Number(req.headers["if-match"]);
      if (!Number.isInteger(expected)) return safeError(reply, 400);
      const { id } = req.params as { id: string };
      const result = await pool.query(
        `UPDATE notification_inbox_item SET status=$1,version=version+1,updated_at=NOW() WHERE tenant_id=$2 AND user_id=$3 AND id=$4 AND version=$5 RETURNING id,status,version`,
        [state, req.user.tenantId, req.user.userId, id, expected],
      );
      if (!result.rowCount) return safeError(reply, 409);
      return reply.send(result.rows[0]);
    });
  done();
}
