import { describe, expect, test, vi } from "vitest";
import {
  assertDevelopmentMailboxEnvironment,
  openDevelopmentMailboxItem,
  parseMailboxItemId,
  type MailboxMappingDatabase,
  type MailboxReader,
} from "../../../scripts/iam/open-development-mailbox.js";

const mailboxId = "task-01a603ce-0615-420a-af34-80ec6f36a7b3";
const invitationId = "8ed96e80-72b8-4573-a599-a5d0f568f2d7";
const activationUrl = "http://localhost:3000/#/accept-invitation?token=secret-test-value";
const environment = {
  NODE_ENV: "development",
  DEV_MAILBOX_ENABLED: "true",
  GOVOS_NOTIFICATION_PROVIDER: "development",
};
const encryptionKey = "a".repeat(64);

function dependencies(overrides?: {
  deliveryStatus?: "received" | "delivered";
  rowCount?: number;
  taskStatus?: string;
  invitationStatus?: string;
  membershipStatus?: string;
  payloadInvitationId?: string;
  payloadUrl?: string;
}) {
  const mailbox: MailboxReader = {
    view: vi.fn().mockResolvedValue({
      notificationId: mailboxId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      deliveryStatus: overrides?.deliveryStatus ?? "received",
    }),
    open: vi.fn().mockResolvedValue({
      invitationId: overrides?.payloadInvitationId ?? invitationId,
      recipientEmail: "owner@example.test",
      activationUrl: overrides?.payloadUrl ?? activationUrl,
    }),
  };
  const database: MailboxMappingDatabase = {
    query: vi.fn().mockResolvedValue({
      rowCount: overrides?.rowCount ?? 1,
      rows: overrides?.rowCount === 0 ? [] : [{
        task_status: overrides?.taskStatus ?? "completed",
        invitation_status: overrides?.invitationStatus ?? "pending",
        membership_status: overrides?.membershipStatus ?? "invited",
      }],
    }),
  };
  return { mailbox, database, launchBrowser: vi.fn().mockResolvedValue(undefined) };
}

describe("IAM-1 Gate 2 owner-local mailbox opener", () => {
  test("requires exactly one explicit mailbox item ID", () => {
    expect(parseMailboxItemId(["--mailbox-id", mailboxId])).toBe(mailboxId);
    expect(() => parseMailboxItemId([])).toThrow("Exactly one");
    expect(() => parseMailboxItemId(["--mailbox-id", mailboxId, "extra"])).toThrow("Exactly one");
  });

  test.each(["*", "task-*", "task-?", "task-[1]", "../task"])(
    "rejects wildcard or path-like mailbox ID %s",
    (value) => expect(() => parseMailboxItemId(["--mailbox-id", value])).toThrow(),
  );

  test("fails closed outside the exact development environment", () => {
    expect(() => assertDevelopmentMailboxEnvironment(environment)).not.toThrow();
    expect(() => assertDevelopmentMailboxEnvironment({ ...environment, NODE_ENV: "production" })).toThrow("disabled");
    expect(() => assertDevelopmentMailboxEnvironment({ ...environment, DEV_MAILBOX_ENABLED: "false" })).toThrow("disabled");
    expect(() => assertDevelopmentMailboxEnvironment({ ...environment, GOVOS_NOTIFICATION_PROVIDER: "production" })).toThrow("disabled");
    expect(() => assertDevelopmentMailboxEnvironment({ ...environment, CI: "true" })).toThrow("CI");
  });

  test("opens the exact received item only after mapping and state verification", async () => {
    const deps = dependencies();
    await openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps });
    expect(deps.mailbox.view).toHaveBeenCalledOnce();
    expect(deps.mailbox.view).toHaveBeenCalledWith(mailboxId);
    expect(deps.mailbox.open).toHaveBeenCalledOnce();
    expect(deps.database.query).toHaveBeenCalledOnce();
    expect(deps.launchBrowser).toHaveBeenCalledOnce();
  });

  test("refuses a mailbox item that is not received without decrypting", async () => {
    const deps = dependencies({ deliveryStatus: "delivered" });
    await expect(openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps })).rejects.toThrow("received state");
    expect(deps.mailbox.open).not.toHaveBeenCalled();
    expect(deps.launchBrowser).not.toHaveBeenCalled();
  });

  test("refuses missing or ambiguous database mappings", async () => {
    const deps = dependencies({ rowCount: 0 });
    await expect(openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps })).rejects.toThrow("mapping integrity");
    expect(deps.launchBrowser).not.toHaveBeenCalled();
  });

  test.each([
    { taskStatus: "pending" },
    { invitationStatus: "accepted" },
    { membershipStatus: "active" },
  ])("refuses invalid task, invitation, or membership state %#", async (override) => {
    const deps = dependencies(override);
    await expect(openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps })).rejects.toThrow("pending state");
    expect(deps.launchBrowser).not.toHaveBeenCalled();
  });

  test("refuses a non-loopback activation target", async () => {
    const deps = dependencies({ payloadUrl: "https://example.test/accept?token=secret-test-value" });
    await expect(openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps })).rejects.toThrow("approved local URL");
    expect(deps.launchBrowser).not.toHaveBeenCalled();
  });

  test("does not print decrypted invitation material", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    const deps = dependencies();
    await openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps });
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });

  test("performs no persistence through the mailbox interface", async () => {
    const deps = dependencies();
    await openDevelopmentMailboxItem({ mailboxId, environment, encryptionKey, ...deps });
    expect(Object.keys(deps.mailbox).sort()).toEqual(["open", "view"]);
    expect(deps.database.query).toHaveBeenCalledWith(expect.stringMatching(/^SELECT/), expect.any(Array));
  });
});
