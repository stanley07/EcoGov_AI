import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { loadConfig } from "@govos/configuration";
import {
  NotificationIntakeService,
  NotificationRuntimeWorker,
} from "@govos/infrastructure";
import { createApp } from "../../../apps/api/src/app.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Notification Platform (WF-2) E2E Integration Tests", () => {
  let pool: Pool;
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let roleId: string;
  let templateId: string;
  let versionId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Ensure tenant exists
      await client.query(
        `
        INSERT INTO tenant (id, name, slug, type, status)
        VALUES ($1, 'Anambra State Ministry of Environment', $2, 'ministry', 'active')
        ON CONFLICT (id) DO NOTHING
      `,
        [tenantId, `anambra-${crypto.randomBytes(4).toString("hex")}`],
      );

      // 2. Ensure user exists
      await client.query(
        `
        INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
        VALUES ($1, $2, $3, 'password_hash_placeholder', 'Chidi', 'Okafor', 'active')
        ON CONFLICT (id) DO NOTHING
      `,
        [
          userId,
          tenantId,
          `officer-${crypto.randomBytes(4).toString("hex")}@anambra.gov.ng`,
        ],
      );

      // 3. Create test role
      const roleRes = await client.query(
        `
        INSERT INTO role (tenant_id, name, description)
        VALUES ($1, 'super_admin', 'Super Admin')
        ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id
      `,
        [tenantId],
      );
      roleId = roleRes.rows[0].id;

      // 4. Create permissions
      const permInboxReadRes = await client.query(
        `
        INSERT INTO permission (tenant_id, name, description)
        VALUES ($1, 'notification:inbox:read', 'Read inbox')
        ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id
      `,
        [tenantId],
      );
      const permInboxReadId = permInboxReadRes.rows[0].id;

      const permInboxManageRes = await client.query(
        `
        INSERT INTO permission (tenant_id, name, description)
        VALUES ($1, 'notification:inbox:manage', 'Manage inbox')
        ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id
      `,
        [tenantId],
      );
      const permInboxManageId = permInboxManageRes.rows[0].id;

      const permIntakeRes = await client.query(
        `
        INSERT INTO permission (tenant_id, name, description)
        VALUES ($1, 'notification:request:create', 'Create intake')
        ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id
      `,
        [tenantId],
      );
      const permIntakeId = permIntakeRes.rows[0].id;

      // 5. Link role to permissions
      await client.query(
        `
        INSERT INTO role_permission (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
        [roleId, permInboxReadId],
      );

      await client.query(
        `
        INSERT INTO role_permission (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
        [roleId, permInboxManageId],
      );

      await client.query(
        `
        INSERT INTO role_permission (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
        [roleId, permIntakeId],
      );

      // 6. Create membership linking user to role
      await client.query(
        `
        INSERT INTO membership (tenant_id, user_id, role_id, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT DO NOTHING
      `,
        [tenantId, userId, roleId],
      );

      // 7. Create active template binding and version
      const templateRes = await client.query(
        `
        INSERT INTO notification_template (tenant_id, semantic_key, name, description, allow_tenant_override)
        VALUES ($1, 'test.semantic-key', 'Test Template', 'Description', true)
        RETURNING id
      `,
        [tenantId],
      );
      templateId = templateRes.rows[0].id;

      const versionRes = await client.query(
        `
        INSERT INTO notification_template_version (tenant_id, template_id, version_number, status, variables_schema)
        VALUES ($1, $2, 1, 'draft', '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}'::jsonb)
        RETURNING id
      `,
        [tenantId, templateId],
      );
      versionId = versionRes.rows[0].id;

      await client.query(
        `
        INSERT INTO notification_template_rendering (tenant_id, template_version_id, channel, locale, subject_template, body_template)
        VALUES ($1, $2, 'email', 'en', 'Welcome {{name}}', 'Hello {{name}}, welcome to GovOS')
      `,
        [tenantId, versionId],
      );

      await client.query(
        `
        INSERT INTO notification_template_rendering (tenant_id, template_version_id, channel, locale, subject_template, body_template)
        VALUES ($1, $2, 'in-app', 'en', 'InApp Welcome', 'Hello {{name}}, this is in-app')
      `,
        [tenantId, versionId],
      );

      await client.query(
        `
        INSERT INTO notification_template_rendering (tenant_id, template_version_id, channel, locale, subject_template, body_template)
        VALUES ($1, $2, 'webhook', 'en', 'Webhook Welcome', 'Hello webhook')
      `,
        [tenantId, versionId],
      );

      await client.query(
        `UPDATE notification_template_version SET status='published',published_at=NOW() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, versionId],
      );

      await client.query(
        `
        INSERT INTO notification_template_binding (tenant_id, semantic_key, tenant_template_version_id, status)
        VALUES ($1, 'test.semantic-key', $2, 'active')
      `,
        [tenantId, versionId],
      );

      // 8. Configure active email provider
      await client.query(
        `
        INSERT INTO notification_provider (key, name, channel, configuration_secret_reference, is_active)
        VALUES ('system-email', 'System Email', 'email', $1, true)
        ON CONFLICT (key) DO UPDATE SET is_active = true
      `,
        ["test_email"],
      );

      // 9. Configure active in-app provider
      await client.query(
        `
        INSERT INTO notification_provider (key, name, channel, configuration_secret_reference, is_active)
        VALUES ('system-in-app', 'System InApp', 'in-app', $1, true)
        ON CONFLICT (key) DO UPDATE SET is_active = true
      `,
        ["test_in_app"],
      );

      for (const [channel, provider] of [
        ["email", "system-email"],
        ["in-app", "system-in-app"],
      ] as const) {
        const route = (
          await client.query(
            `INSERT INTO notification_provider_route(tenant_id,channel) VALUES($1,$2) ON CONFLICT(tenant_id,channel) DO UPDATE SET updated_at=NOW() RETURNING id`,
            [tenantId, channel],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO notification_provider_route_entry(tenant_id,route_id,provider_key,priority) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`,
          [tenantId, route.id, provider],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Disable immutability and append-only triggers for clean-up
      await client.query(
        "ALTER TABLE notification_template_rendering DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template_version DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template_binding DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery_status_history DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery_attempt DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_inbox_item DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_destination DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_recipient DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_request DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_quiet_hours DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_suppression DISABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_provider_route DISABLE TRIGGER ALL",
      );

      await client.query("DELETE FROM session WHERE tenant_id = $1", [
        tenantId,
      ]);
      await client.query("DELETE FROM membership WHERE tenant_id = $1", [
        tenantId,
      ]);
      await client.query("DELETE FROM role_permission WHERE role_id = $1", [
        roleId,
      ]);
      await client.query("DELETE FROM role WHERE tenant_id = $1", [tenantId]);
      await client.query("DELETE FROM permission WHERE tenant_id = $1", [
        tenantId,
      ]);

      await client.query(
        "DELETE FROM notification_provider_route_entry WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_provider_route WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_inbox_item WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_delivery_status_history WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_delivery_attempt WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_delivery WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_destination WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_recipient WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_request WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM task_execution WHERE tenant_id = $1 AND task_type = 'govos.notification.delivery.v1'",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_template_binding WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_template_rendering WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_template_version WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_template WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_quiet_hours WHERE tenant_id = $1",
        [tenantId],
      );
      await client.query(
        "DELETE FROM notification_suppression WHERE tenant_id = $1",
        [tenantId],
      );

      // Delete user and tenant
      await client.query("DELETE FROM user_account WHERE tenant_id = $1", [
        tenantId,
      ]);
      await client.query("DELETE FROM tenant WHERE id = $1", [tenantId]);

      // Re-enable triggers
      await client.query(
        "ALTER TABLE notification_template_rendering ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template_version ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_template_binding ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery_status_history ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery_attempt ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_inbox_item ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_delivery ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_destination ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_recipient ENABLE TRIGGER ALL",
      );
      await client.query("ALTER TABLE notification_request ENABLE TRIGGER ALL");
      await client.query(
        "ALTER TABLE notification_quiet_hours ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_suppression ENABLE TRIGGER ALL",
      );
      await client.query(
        "ALTER TABLE notification_provider_route ENABLE TRIGGER ALL",
      );

      await client.query("COMMIT");
    } finally {
      client.release();
      await pool.end();
    }
  });

  test("1. Intake successfully resolves channels and resolves recipients", async () => {
    const idempotencyKey = crypto.randomUUID();
    const result = await NotificationIntakeService.intake(pool, {
      tenantId,
      producerNamespace: "test-namespace",
      idempotencyKey,
      variables: { name: "Officer Chidi" },
      classification: "standard",
      semanticKey: "test.semantic-key",
      recipients: [
        { recipientType: "direct_user", recipientValue: userId },
        {
          recipientType: "direct_destination",
          recipientValue: "guest@anambra.gov.ng",
        },
      ],
    });

    expect(result.requestId).toBeDefined();
    expect(result.state).toBe("accepted");

    // Check request row
    const reqRes = await pool.query(
      "SELECT * FROM notification_request WHERE id = $1",
      [result.requestId],
    );
    expect(reqRes.rows).toHaveLength(1);
    expect(reqRes.rows[0].classification).toBe("standard");

    // Check resolved recipients (direct_user + direct_destination)
    const recipsRes = await pool.query(
      "SELECT * FROM notification_recipient WHERE request_id = $1",
      [result.requestId],
    );
    expect(recipsRes.rows.length).toBeGreaterThanOrEqual(2);

    // Check deliveries created
    const delivsRes = await pool.query(
      "SELECT * FROM notification_delivery WHERE request_id = $1",
      [result.requestId],
    );
    // 2 recipients:
    // - User ID has email and in-app rendering (2 channels)
    // - Direct destination guest@anambra.gov.ng has email rendering (1 channel)
    // Total deliveries: 3
    expect(delivsRes.rows).toHaveLength(3);
  });

  test("2. Background worker leases and processes queued deliveries", async () => {
    const idempotencyKey = crypto.randomUUID();
    const intakeResult = await NotificationIntakeService.intake(pool, {
      tenantId,
      producerNamespace: "test-namespace",
      idempotencyKey,
      variables: { name: "Officer Chidi" },
      classification: "standard",
      semanticKey: "test.semantic-key",
      recipients: [{ recipientType: "direct_user", recipientValue: userId }],
    });

    // Run poll and process once
    for (let i = 0; i < 5; i++)
      await NotificationRuntimeWorker.pollAndProcess(pool);

    // Check that deliveries are marked delivered
    const delivsRes = await pool.query(
      "SELECT id, channel, state, request_id FROM notification_delivery WHERE request_id = $1",
      [intakeResult.requestId],
    );
    expect(delivsRes.rows.length).toBe(2);
    for (const d of delivsRes.rows) {
      expect(d.state).toBe("delivered");
    }

    // Check that inbox item was created for user
    const inboxRes = await pool.query(
      "SELECT * FROM notification_inbox_item WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, userId],
    );
    expect(inboxRes.rows.length).toBeGreaterThanOrEqual(1);
    expect(inboxRes.rows[0].subject).toBe("InApp Welcome");
    expect(inboxRes.rows[0].status).toBe("unread");
  });

  test("3. Inbox API endpoints retrieve and update notifications", async () => {
    // Generate mock token and session
    const token = crypto.randomBytes(32).toString("hex");
    const sessionRes = await pool.query(
      `
      INSERT INTO session (tenant_id, user_id, token, expires_at, role_id)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', $4)
      RETURNING id
    `,
      [tenantId, userId, token, roleId],
    );

    const appInstance = createApp(loadConfig(), pool);
    const headers = { authorization: `Bearer ${token}` };

    // Get inbox items
    const getRes = await appInstance.inject({
      method: "GET",
      url: "/v1/notifications/inbox",
      headers,
    });
    expect(getRes.statusCode).toBe(200);
    const items = getRes.json().items;
    expect(items.length).toBeGreaterThanOrEqual(1);

    const itemId = items[0].id;

    // Mark as read
    const readRes = await appInstance.inject({
      method: "POST",
      url: `/v1/notifications/inbox/${itemId}/read`,
      headers: { ...headers, "if-match": String(items[0].version) },
    });
    expect(readRes.statusCode).toBe(200);

    // Check status in DB
    const itemQuery = await pool.query(
      "SELECT status FROM notification_inbox_item WHERE id = $1",
      [itemId],
    );
    expect(itemQuery.rows[0].status).toBe("read");

    // Cleanup session
    await pool.query("DELETE FROM session WHERE id = $1", [
      sessionRes.rows[0].id,
    ]);
    await appInstance.close();
  });

  test("4. Quiet hours defers standard notifications but allows emergency bypass", async () => {
    // Enable quiet hours tenant-wide for the next 8 hours
    await pool.query(
      `
      INSERT INTO notification_quiet_hours (tenant_id, start_hour, start_minute, end_hour, end_minute, timezone)
      VALUES ($1, 0, 0, 23, 59, 'UTC')
      ON CONFLICT DO NOTHING
    `,
      [tenantId],
    );

    // Send standard notification
    const standardResult = await NotificationIntakeService.intake(pool, {
      tenantId,
      producerNamespace: "test-namespace",
      idempotencyKey: crypto.randomUUID(),
      variables: { name: "Officer Chidi" },
      classification: "standard",
      semanticKey: "test.semantic-key",
      recipients: [{ recipientType: "direct_user", recipientValue: userId }],
    });

    const standardDeliv = await pool.query(
      "SELECT * FROM notification_delivery WHERE request_id = $1",
      [standardResult.requestId],
    );
    expect(standardDeliv.rows[0].state).toBe("scheduled");

    // Send emergency notification
    const emergencyResult = await NotificationIntakeService.intake(pool, {
      tenantId,
      producerNamespace: "test-namespace",
      idempotencyKey: crypto.randomUUID(),
      variables: { name: "Officer Chidi" },
      classification: "emergency",
      semanticKey: "test.semantic-key",
      recipients: [{ recipientType: "direct_user", recipientValue: userId }],
    });

    const emergencyDeliv = await pool.query(
      "SELECT * FROM notification_delivery WHERE request_id = $1",
      [emergencyResult.requestId],
    );
    expect(emergencyDeliv.rows[0].state).toBe("queued");

    // Clean up quiet hours so they do not leak
    await pool.query(
      "DELETE FROM notification_quiet_hours WHERE tenant_id = $1",
      [tenantId],
    );
  });

  test("5. Webhook URL SSRF and DNS Rebinding check rejects private range IPs", async () => {
    // Active webhook route entry
    await pool.query(
      `
      INSERT INTO notification_provider_route (tenant_id, channel)
      VALUES ($1, 'webhook')
      ON CONFLICT DO NOTHING
    `,
      [tenantId],
    );

    // Configure system webhook provider
    await pool.query(
      `
      INSERT INTO notification_provider (key, name, channel, configuration_secret_reference, is_active)
      VALUES ('system-webhook', 'System Webhook', 'webhook', $1, true)
      ON CONFLICT (key) DO UPDATE SET is_active = true
    `,
      ["test_webhook"],
    );

    // Intake call for webhook endpoint
    const intakeResult = await NotificationIntakeService.intake(pool, {
      tenantId,
      producerNamespace: "test-namespace",
      idempotencyKey: crypto.randomUUID(),
      variables: { name: "SSRF test" },
      classification: "standard",
      semanticKey: "test.semantic-key",
      recipients: [
        // Webhook recipient targeting a local address
        {
          recipientType: "direct_destination",
          recipientValue: "http://127.0.0.1:8080/sensitive-endpoint",
        },
      ],
    });

    // Run background worker
    for (let i = 0; i < 5; i++)
      await NotificationRuntimeWorker.pollAndProcess(pool);

    // Verify delivery status -> should be permanent_failed
    const delivsRes = await pool.query(
      "SELECT * FROM notification_delivery WHERE request_id = $1 AND channel = 'webhook'",
      [intakeResult.requestId],
    );
    expect(delivsRes.rows[0].state).toBe("permanent_failed");
  });
});
