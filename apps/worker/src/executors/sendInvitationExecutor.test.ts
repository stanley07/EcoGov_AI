import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encryptPayload } from "@govos/core";
import { DevelopmentMailbox } from "@govos/infrastructure";
import { SendInvitationExecutor } from "./sendInvitationExecutor.js";

describe("NOTIFY-1 development notification provider", () => {
  const key = "a".repeat(64);
  const tenantId = "00000000-0000-0000-0000-000000000001";
  const secretToken = "never-log-this-token";
  const activationUrl = `http://localhost/#/accept?token=${secretToken}`;
  let mailboxPath: string;
  let oldEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    oldEnv = { ...process.env };
    mailboxPath = await fs.mkdtemp(path.join(os.tmpdir(), "govos-mailbox-"));
    process.env.DEV_MAILBOX_PATH = mailboxPath;
    process.env.ENCRYPTION_KEY = key;
    process.env.NODE_ENV = "development";
  });

  afterEach(async () => {
    process.env = oldEnv;
    await fs.rm(mailboxPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function executor() {
    const encrypted_payload = encryptPayload({ invitationId: "invite-1", recipientEmail: "owner@example.test", activationUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() }, key, "v1");
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ tenant_id: tenantId, encrypted_payload }] }) };
    return new SendInvitationExecutor(pool as never);
  }

  test("is never enabled implicitly", async () => {
    delete process.env.GOVOS_NOTIFICATION_PROVIDER;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await executor().execute({ taskId: "task-disabled" });
    expect(await fs.readdir(mailboxPath)).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).not.toContain(secretToken);
    expect(log.mock.calls.flat().join(" ")).not.toContain(activationUrl);
  });

  test("stores protected notification content without logging secrets", async () => {
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await executor().execute({ taskId: "task-enabled" });
    const raw = await fs.readFile(path.join(mailboxPath, "task-enabled.json"), "utf8");
    expect(raw).not.toContain(secretToken);
    expect(raw).not.toContain(activationUrl);
    expect(log).not.toHaveBeenCalled();
    const safe = await new DevelopmentMailbox().view("task-enabled");
    expect(safe).toMatchObject({ tenantId, deliveryStatus: "received", recipientEmail: "owner@example.test" });
    expect(JSON.stringify(safe)).not.toContain(secretToken);
  });

  test("controlled open decrypts in memory and status/delete operations work", async () => {
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    await executor().execute({ taskId: "task-lifecycle" });
    const mailbox = new DevelopmentMailbox();
    expect((await mailbox.open("task-lifecycle", key)).activationUrl).toBe(activationUrl);
    await mailbox.markDelivered("task-lifecycle");
    expect((await mailbox.view("task-lifecycle")).deliveryStatus).toBe("delivered");
    await mailbox.delete("task-lifecycle");
    await expect(mailbox.view("task-lifecycle")).rejects.toThrow();
  });

  test("worker retry is idempotent and creates one mailbox document", async () => {
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    const instance = executor();
    await instance.execute({ taskId: "task-retry" });
    await instance.execute({ taskId: "task-retry" });
    expect(await fs.readdir(mailboxPath)).toEqual(["task-retry.json"]);
  });

  test("development adapter rejects calls when provider is disabled", async () => {
    process.env.GOVOS_NOTIFICATION_PROVIDER = "production";
    await expect(new DevelopmentMailbox().deliver({ notificationId: "task-direct", tenantId, notificationType: "invitation", subject: "subject", body: "body", payload: { invitationId: "invite", recipientEmail: "owner@example.test", activationUrl }, encryptionKey: key })).rejects.toThrow("disabled");
  });

  test("production cannot activate the development provider", async () => {
    process.env.NODE_ENV = "production";
    process.env.GOVOS_NOTIFICATION_PROVIDER = "development";
    await expect(executor().execute({ taskId: "task-production" })).rejects.toThrow("disabled");
    expect(await fs.readdir(mailboxPath)).toEqual([]);
  });
});
