import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "@govos/configuration";
import { DevelopmentMailbox } from "@govos/infrastructure";
import { createApp } from "../../../apps/api/src/app.js";

describe("NOTIFY-1 development mailbox HTTP safeguards", () => {
  const oldEnv = { ...process.env };
  afterEach(() => { process.env = { ...oldEnv }; });

  function app() {
    return createApp(loadConfig(), { query: async () => ({ rows: [] }) } as never);
  }

  test("returns 404 when mailbox is disabled", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_MAILBOX_ENABLED;
    const instance = app();
    const response = await instance.inject({ method: "GET", url: "/internal/dev-mailbox" });
    expect(response.statusCode).toBe(404);
    await instance.close();
  });

  test("production returns 404 even if the development provider is selected", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_MAILBOX_ENABLED = "true";
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    const instance = app();
    const response = await instance.inject({ method: "GET", url: "/internal/dev-mailbox" });
    expect(response.statusCode).toBe(404);
    await instance.close();
  });

  test("enabled mailbox still requires authenticated platform authorization", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_MAILBOX_ENABLED = "true";
    const instance = app();
    const response = await instance.inject({ method: "GET", url: "/internal/dev-mailbox" });
    expect(response.statusCode).toBe(401);
    await instance.close();
  });

  test("authorized platform developer can list, view, open, mark, and delete", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "govos-mailbox-api-"));
    process.env.NODE_ENV = "development";
    process.env.DEV_MAILBOX_ENABLED = "true";
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    process.env.DEV_MAILBOX_PATH = root;
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    const mailbox = new DevelopmentMailbox();
    await mailbox.deliver({ notificationId: "task-api", tenantId: "tenant-1", notificationType: "invitation", subject: "subject", body: "body", payload: { invitationId: "invite-1", recipientEmail: "owner@example.test", activationUrl: "http://localhost/#/accept?token=protected" }, encryptionKey: process.env.ENCRYPTION_KEY });
    const pool = { query: async (sql: string) => {
      if (sql.includes("FROM session")) return { rows: [{ user_id: "dev-user", tenant_id: "system", user_status: "active", tenant_status: "active", tenant_session_version: 1, session_version: 1, roles: [] }] };
      if (sql.includes("mfa_enrollment_status")) return { rows: [{ mfa_enrollment_status: "verified" }] };
      if (sql.includes("platform_role_assignment")) return { rows: [{ role_name: "PLATFORM_SUPER_ADMIN" }] };
      return { rows: [] };
    } };
    const instance = createApp(loadConfig(), pool as never);
    const headers = { authorization: "Bearer dev-token" };
    expect((await instance.inject({ method: "GET", url: "/internal/dev-mailbox", headers })).statusCode).toBe(200);
    expect((await instance.inject({ method: "GET", url: "/internal/dev-mailbox/task-api", headers })).body).not.toContain("protected");
    expect((await instance.inject({ method: "POST", url: "/internal/dev-mailbox/task-api/open", headers })).json()).toMatchObject({ invitationId: "invite-1" });
    expect((await instance.inject({ method: "POST", url: "/internal/dev-mailbox/task-api/delivered", headers })).statusCode).toBe(204);
    expect((await instance.inject({ method: "DELETE", url: "/internal/dev-mailbox/task-api", headers })).statusCode).toBe(204);
    await instance.close();
    await fs.rm(root, { recursive: true, force: true });
  });
});
