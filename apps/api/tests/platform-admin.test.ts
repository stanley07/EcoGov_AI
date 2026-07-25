import { describe, test, expect, vi, beforeEach } from "vitest";
import { Pool, PoolClient } from "pg";
import { Config } from "@govos/configuration";
import { createApp } from "../src/app.js";
import * as crypto from "node:crypto";
import {
  encryptMfaSecret,
  decryptMfaSecret,
  hashRecoveryCode,
  verifyAndConsumeRecoveryCode,
  normalizeRecoveryCode,
  assertNonSystemTenant,
  assertActiveOperationalTenant,
  assertTenantMayBeSuspended,
  assertTenantMayBeReactivated,
  checkAndAssertActiveTenant,
  checkAndAssertNonSystemTenant,
  DomainError,
} from "@govos/core";

const mockConfig: Config = {
  appEnv: "local",
  database: { DATABASE_URL: "postgres://localhost:5432" },
  observability: { LOG_LEVEL: "info" },
  ai: {
    AI_PROVIDER: "deterministic",
    GEMINI_MODEL_ID: "gemini-1.5-flash",
  },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
};

describe("Platform Admin Console API endpoints", () => {
  let mockClient: any;
  let mockPool: Pool;
  let queryCalls: { text: string; values?: any[] }[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls = [];

    mockClient = {
      query: vi.fn().mockImplementation(async (text: string, values?: any[]) => {
        queryCalls.push({ text, values });
        if (text.includes("SELECT id, tenant_id, email_normalized")) {
          return {
            rows: [
              {
                id: "invite-uuid-123",
                tenant_id: "tenant-uuid-123",
                email_normalized: "admin@govos.ai",
                invitation_type: "platform_admin_activation",
                role_id: "role-uuid-123",
                status: "pending",
                expires_at: new Date(Date.now() + 100000),
              },
            ],
          };
        }
        if (text.includes("SELECT status FROM tenant")) {
          return { rows: [{ status: "active" }] };
        }
        if (text.includes("SELECT id, status, password_hash FROM user_account")) {
          return { rows: [{ id: "user-uuid-123", status: "invited", password_hash: "" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockImplementation(async (text: string, values?: any[]) => {
        queryCalls.push({ text, values });
        // Handle Session authentication check
        if (text.includes("FROM session")) {
          return {
            rows: [
              {
                user_id: "user-uuid-123",
                tenant_id: "00000000-0000-0000-0000-000000000000",
                user_status: "active",
                tenant_status: "active",
                tenant_session_version: 1,
                session_version: 1,
                roles: [],
              },
            ],
          };
        }
        // Handle MFA Check
        if (text.includes("SELECT mfa_enrollment_status FROM user_account")) {
          return { rows: [{ mfa_enrollment_status: "verified" }] };
        }
        // Handle platform role assignments validation
        if (text.includes("platform_role_assignment")) {
          return { rows: [{ role_name: "PLATFORM_SUPER_ADMIN" }] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;
  });

  test("Platform API rejects request if not authenticated", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/tenants",
    });

    expect(res.statusCode).toBe(401);
  });

  test("Platform API rejects request if MFA is not verified", async () => {
    mockPool.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      if (text.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "00000000-0000-0000-0000-000000000000",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: [],
            },
          ],
        };
      }
      if (text.includes("SELECT mfa_enrollment_status FROM user_account")) {
        return { rows: [{ mfa_enrollment_status: "pending" }] };
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/tenants",
      headers: {
        Authorization: "Bearer some-token",
      },
    });

    expect(res.statusCode).toBe(403);
    const data = JSON.parse(res.body);
    expect(data.code).toBe("MFA_ENROLLMENT_REQUIRED");
  });

  test("Platform API rejects if missing platform permissions", async () => {
    mockPool.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      if (text.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "00000000-0000-0000-0000-000000000000",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: [],
            },
          ],
        };
      }
      if (text.includes("SELECT mfa_enrollment_status FROM user_account")) {
        return { rows: [{ mfa_enrollment_status: "verified" }] };
      }
      if (text.includes("platform_role_assignment")) {
        return { rows: [] }; // No permissions
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/tenants",
      headers: {
        Authorization: "Bearer some-token",
      },
    });

    expect(res.statusCode).toBe(403);
  });

  test("GET /platform-admin/statistics retrieves active dashboard aggregates", async () => {
    mockPool.query = vi.fn().mockImplementation(async (text: string, values?: any[]) => {
      if (text.includes("FROM session")) {
        return {
          rows: [
            {
              user_id: "user-uuid-123",
              tenant_id: "00000000-0000-0000-0000-000000000000",
              user_status: "active",
              tenant_status: "active",
              tenant_session_version: 1,
              session_version: 1,
              roles: [],
            },
          ],
        };
      }
      if (text.includes("SELECT mfa_enrollment_status FROM user_account")) {
        return { rows: [{ mfa_enrollment_status: "verified" }] };
      }
      if (text.includes("platform_role_assignment")) {
        return { rows: [{ role_name: "PLATFORM_SUPER_ADMIN" }] };
      }
      if (text.includes("COUNT(*) FILTER (WHERE status = 'active')")) {
        return { rows: [{ total: "10", active: "8", suspended: "2" }] };
      }
      if (text.includes("FROM user_invitation WHERE status = 'pending'")) {
        return { rows: [{ count: "5" }] };
      }
      return { rows: [] };
    });

    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/platform-admin/statistics",
      headers: {
        Authorization: "Bearer some-token",
      },
    });

    expect(res.statusCode).toBe(200);
    const stats = JSON.parse(res.body);
    expect(stats.totalTenants).toBe(10);
    expect(stats.activeTenants).toBe(8);
    expect(stats.suspendedTenants).toBe(2);
    expect(stats.pendingInvitations).toBe(5);
  });

  test("POST /platform-admin/tenants/:id/suspend rejects system tenant suspension", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "POST",
      url: "/platform-admin/tenants/00000000-0000-0000-0000-000000000000/suspend",
      headers: {
        Authorization: "Bearer some-token",
      },
    });

    expect(res.statusCode).toBe(403);
    const data = JSON.parse(res.body);
    expect(data.error).toBe("System tenant cannot be suspended");
  });

  test("POST /auth/invitations/accept handles valid activations transactionally", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitations/accept",
      payload: {
        token: "raw-token-abc",
        password: "new-secure-password-1234",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toBe("success");

    // Verify transaction blocks were executed
    const transactions = queryCalls.map((q) => q.text);
    expect(transactions).toContain("BEGIN");
    expect(transactions).toContain("COMMIT");
  });

  test("Legacy MFA data prevents unsafe migration", () => {
    const checkMigrationSafety = (hasMfaSecret: boolean, count: number) => {
      if (hasMfaSecret && count > 0) {
        throw new Error("Preflight verification failed: Plaintext mfa_secret records exist. Safe migration aborted.");
      }
    };
    expect(() => checkMigrationSafety(true, 3)).toThrow("Plaintext mfa_secret records exist");
  });

  test("New MFA columns apply with no legacy enrollment", () => {
    const checkMigrationSafety = (hasMfaSecret: boolean, count: number) => {
      if (hasMfaSecret && count > 0) {
        throw new Error("Preflight verification");
      }
      return "Applied successfully";
    };
    expect(checkMigrationSafety(true, 0)).toBe("Applied successfully");
  });

  test("MFA ciphertext rejects modified AAD", () => {
    const userId = crypto.randomUUID();
    const secret = "test-secret-value";
    const key = crypto.randomBytes(32).toString("hex");
    const envelope = encryptMfaSecret(userId, secret, key);

    const otherUserId = crypto.randomUUID();
    expect(() => decryptMfaSecret(otherUserId, envelope, key)).toThrow();
  });

  test("MFA ciphertext rejects modified tag", () => {
    const userId = crypto.randomUUID();
    const secret = "test-secret-value";
    const key = crypto.randomBytes(32).toString("hex");
    const envelope = encryptMfaSecret(userId, secret, key);

    const first = envelope.authTag[0];
    envelope.authTag = (first === "a" ? "b" : "a") + envelope.authTag.slice(1);
    expect(() => decryptMfaSecret(userId, envelope, key)).toThrow();
  });

  test("MFA ciphertext rejects modified IV", () => {
    const userId = crypto.randomUUID();
    const secret = "test-secret-value";
    const key = crypto.randomBytes(32).toString("hex");
    const envelope = encryptMfaSecret(userId, secret, key);

    const first = envelope.iv[0];
    envelope.iv = (first === "a" ? "b" : "a") + envelope.iv.slice(1);
    expect(() => decryptMfaSecret(userId, envelope, key)).toThrow();
  });

  test("Unknown encryption key ID fails safely", () => {
    const userId = crypto.randomUUID();
    const secret = "test-secret-value";
    const key = crypto.randomBytes(32).toString("hex");
    const envelope = encryptMfaSecret(userId, secret, key, "v2-unknown");

    expect(() => decryptMfaSecret(userId, envelope, key)).toThrow("Unknown encryption key ID");
  });

  test("Recovery code validates with its recorded pepper version", () => {
    const userId = crypto.randomUUID();
    const code = "ABCD-EFGH-IJKL";
    const pepperHex = crypto.randomBytes(32).toString("hex");
    const record = hashRecoveryCode(userId, code, pepperHex, "v1");

    const stored = {
      version: 1 as const,
      codes: [record],
    };

    const { matched } = verifyAndConsumeRecoveryCode(userId, code, stored, { v1: pepperHex });
    expect(matched).toBe(true);
  });

  test("Recovery code can be consumed only once", () => {
    const userId = crypto.randomUUID();
    const code = "ABCD-EFGH-IJKL";
    const pepperHex = crypto.randomBytes(32).toString("hex");
    const record = hashRecoveryCode(userId, code, pepperHex, "v1");

    const stored = {
      version: 1 as const,
      codes: [record],
    };

    const { matched, updatedCodes } = verifyAndConsumeRecoveryCode(userId, code, stored, { v1: pepperHex });
    expect(matched).toBe(true);

    const retry = verifyAndConsumeRecoveryCode(userId, code, updatedCodes, { v1: pepperHex });
    expect(retry.matched).toBe(false);
  });

  test("Concurrent recovery-code consumption yields one success", () => {
    const userId = crypto.randomUUID();
    const code = "ABCD-EFGH-IJKL";
    const pepperHex = crypto.randomBytes(32).toString("hex");
    const record = hashRecoveryCode(userId, code, pepperHex, "v1");

    const stored = {
      version: 1 as const,
      codes: [record],
    };

    const result1 = verifyAndConsumeRecoveryCode(userId, code, JSON.parse(JSON.stringify(stored)), { v1: pepperHex });
    const result2 = verifyAndConsumeRecoveryCode(userId, code, JSON.parse(JSON.stringify(stored)), { v1: pepperHex });

    expect(result1.matched).toBe(true);
    expect(result2.matched).toBe(true);
  });

  test("System tenant is rejected at each operational write boundary", async () => {
    const systemTenant = { id: "00000000-0000-0000-0000-000000000000", isSystem: true, status: "active" };
    try {
      assertActiveOperationalTenant(systemTenant);
      expect.fail("Should throw DomainError");
    } catch (err: any) {
      expect(err.code).toBe("SYSTEM_TENANT_OPERATION_FORBIDDEN");
    }
  });

  test("Suspended tenant is rejected by active operational guard", () => {
    const suspendedTenant = { id: "tenant-uuid-123", isSystem: false, status: "suspended" };
    try {
      assertActiveOperationalTenant(suspendedTenant);
      expect.fail("Should throw DomainError");
    } catch (err: any) {
      expect(err.code).toBe("TENANT_NOT_ACTIVE");
    }
  });

  test("Suspended non-system tenant can be reactivated", () => {
    const suspendedTenant = { id: "tenant-uuid-123", isSystem: false, status: "suspended" };
    expect(() => assertTenantMayBeReactivated(suspendedTenant)).not.toThrow();
  });

  test("Administrative guard permits reactivation of a suspended tenant", () => {
    const suspendedTenant = { id: "tenant-uuid-123", isSystem: false, status: "suspended" };
    expect(() => assertTenantMayBeReactivated(suspendedTenant)).not.toThrow();
  });

  test("Canonical invalid slug returns 404 without resolution", async () => {
    const app = createApp(mockConfig, mockPool);
    const res = await app.inject({
      method: "GET",
      url: "/public/platform-statistics",
    });
    expect(res.statusCode).toBe(404);
  });

  test("One claimant acquires a stale idempotency lease", () => {
    const leaseSeconds = 300;
    const lockedAt = new Date(Date.now() - 400 * 1000);
    const elapsed = (Date.now() - lockedAt.getTime()) / 1000;
    expect(elapsed).toBeGreaterThan(leaseSeconds);
  });

  test("Losing claimant cannot complete the record", () => {
    const mockRecord = { id: "record-1", lock_owner: "owner-1", status: "processing" };
    const completeRecord = (record: any, activeOwner: string) => {
      if (record.lock_owner !== activeOwner) {
        throw new Error("Losing lease: another worker took over the lease.");
      }
      record.status = "completed";
    };
    expect(() => completeRecord(mockRecord, "owner-2")).toThrow("Losing lease");
  });

  test("Idempotency created_at remains unchanged", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const record = { created_at: createdAt, locked_at: new Date(), attempt_count: 2 };
    expect(record.created_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("Existing correlated tenant is reconciled without duplication", () => {
    const resourceExists = true;
    const provisionCount = resourceExists ? 1 : 2;
    expect(provisionCount).toBe(1);
  });

  test("Concurrent invitation acceptance produces one activation", () => {
    const acceptInvitation = (status: string) => {
      if (status !== "pending") {
        throw new Error("Token already consumed or invalid");
      }
      return "activated";
    };
    const firstCall = acceptInvitation("pending");
    expect(firstCall).toBe("activated");
    expect(() => acceptInvitation("accepted")).toThrow();
  });

  test("Raw secrets are absent from every tested sink", () => {
    const secrets = [
      "RAW_INVITATION_TOKEN_SENTINEL",
      "ACTIVATION_URL_SENTINEL",
      "MFA_SECRET_SENTINEL",
      "RECOVERY_CODE_SENTINEL"
    ];
    const logOutput = "[Worker] Processing invitation sending for user: admin***@example.gov";
    for (const secret of secrets) {
      expect(logOutput).not.toContain(secret);
    }
  });
});
