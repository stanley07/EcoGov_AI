import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encryptPayload } from "@govos/core";
import { NotificationIntakeService } from "@govos/infrastructure";
import { SendInvitationExecutor } from "./sendInvitationExecutor.js";

describe("WF-2 legacy invitation compatibility adapter", () => {
  const key = "a".repeat(64);
  const tenantId = "00000000-0000-0000-0000-000000000001";
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = key;
    vi.spyOn(NotificationIntakeService, "intake").mockResolvedValue({
      requestId: "canonical-request",
      state: "accepted",
    });
  });
  afterEach(() => vi.restoreAllMocks());
  function makeExecutor(overrides: Record<string, unknown> = {}) {
    const encrypted_payload = encryptPayload(
      {
        invitationId: "invite-1",
        recipientEmail: "owner@example.test",
        activationUrl: "https://govos.test/#/accept?token=secret",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        ...overrides,
      },
      key,
      "v1",
    );
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("notification_template("))
          return { rows: [{ id: "template" }] };
        if (sql.includes("SELECT id FROM notification_template_version"))
          return { rows: [{ id: "version" }] };
        if (sql.includes("notification_provider_route("))
          return { rows: [{ id: "route" }] };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ tenant_id: tenantId, encrypted_payload }],
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    return {
      executor: new SendInvitationExecutor(pool as never),
      pool,
      client,
    };
  }
  test("delegates legacy payload to canonical intake with stable task idempotency", async () => {
    const { executor } = makeExecutor();
    await executor.execute({ taskId: "task-1" });
    expect(NotificationIntakeService.intake).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId,
        producerNamespace: "legacy.invitation",
        idempotencyKey: "task-1",
        semanticKey: "iam.invitation",
        recipients: [
          {
            recipientType: "direct_destination",
            recipientValue: "owner@example.test",
          },
        ],
      }),
    );
  });
  test("duplicate execution reuses the same canonical identity", async () => {
    const { executor } = makeExecutor();
    await executor.execute({ taskId: "task-duplicate" });
    await executor.execute({ taskId: "task-duplicate" });
    expect(
      vi.mocked(NotificationIntakeService.intake).mock.calls[0]?.[1],
    ).toMatchObject({
      idempotencyKey: "task-duplicate",
    });
    expect(
      vi.mocked(NotificationIntakeService.intake).mock.calls[1]?.[1],
    ).toMatchObject({
      idempotencyKey: "task-duplicate",
    });
  });
  test("rejects malformed decrypted payload before canonical mutation", async () => {
    const { executor } = makeExecutor({ recipientEmail: "" });
    await expect(executor.execute({ taskId: "task-invalid" })).rejects.toThrow(
      "missing fields",
    );
    expect(NotificationIntakeService.intake).not.toHaveBeenCalled();
  });
  test("requires the encrypted task payload", async () => {
    const { executor, pool } = makeExecutor();
    pool.query.mockResolvedValueOnce({
      rows: [{ tenant_id: tenantId, encrypted_payload: null }],
    });
    await expect(executor.execute({ taskId: "task-empty" })).rejects.toThrow(
      "does not have an encrypted payload",
    );
  });
});
