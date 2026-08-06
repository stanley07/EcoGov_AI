import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { repairBootstrap } from "./repair-bootstrap.js";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.APP_ENV = "local";
  process.env.AI_PROVIDER = "deterministic";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "password123Secure!";
  process.env.ADMIN_FIRST_NAME = "Admin";
  process.env.ADMIN_LAST_NAME = "User";
});
afterEach(() => { process.env = { ...originalEnv }; });

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});

vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => {
      return {
        connect: mockConnect,
        end: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

interface DBState {
  tenantExists: boolean;
  organizationExists: boolean;
  existingRoles: any[];
  existingPermissions: any[];
  existingUser: any | null;
  existingMembership: any | null;
  deterministicIdOccupiedByEmail: string | null;
  queriesRun: { sql: string; params?: any[] }[];
}

describe("GovOS Bootstrap Repair Command", () => {
  let state: DBState;
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();

    state = {
      tenantExists: true,
      organizationExists: true,
      existingRoles: [],
      existingPermissions: [],
      existingUser: null,
      existingMembership: null,
      deterministicIdOccupiedByEmail: null,
      queriesRun: [],
    };

    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
      state.queriesRun.push({ sql, params });

      if (
        sql.includes("BEGIN") ||
        sql.includes("COMMIT") ||
        sql.includes("ROLLBACK") ||
        sql.includes("pg_advisory_xact_lock")
      ) {
        return { rows: [] };
      }
      if (sql.includes("FROM tenant")) {
        if (state.tenantExists) {
          return {
            rows: [
              {
                id: "00000000-0000-0000-0000-000000000001",
                name: "Anambra State Ministry of Environment",
              },
            ],
          };
        }
        return { rows: [] };
      }
      if (sql.includes("FROM organization")) {
        if (state.organizationExists) {
          return {
            rows: [
              { id: "00000000-0000-0000-0000-000000000010", name: "Anambra State Ministry of Environment Headquarters" },
            ],
          };
        }
        return { rows: [] };
      }
      if (sql.includes("FROM role WHERE")) {
        const id = params?.[1];
        const name = params?.[2];
        const found = state.existingRoles.find(
          (r) => r.id === id || r.name === name,
        );
        return { rows: found ? [found] : [] };
      }
      if (sql.includes("INSERT INTO role (")) {
        const id = params?.[0];
        const name = params?.[2];
        const found = state.existingRoles.find(
          (r) => r.id === id || r.name === name,
        );
        if (found) {
          return { rows: [] };
        }
        const newRole = { id, name };
        state.existingRoles.push(newRole);
        return { rows: [{ id }] };
      }
      if (sql.includes("INSERT INTO permission")) {
        const name = params?.[1];
        const found = state.existingPermissions.find((p) => p.name === name);
        if (found) {
          return { rows: [] };
        }
        const newPerm = { id: `perm-${name}`, name };
        state.existingPermissions.push(newPerm);
        return { rows: [{ id: newPerm.id }] };
      }
      if (sql.includes("FROM permission")) {
        return { rows: state.existingPermissions };
      }
      if (sql.includes("INSERT INTO role_permission")) {
        return { rows: [] };
      }
      if (sql.includes("FROM user_account WHERE tenant_id = $1 AND email = $2")) {
        if (state.existingUser && state.existingUser.email === params?.[1]) {
          return { rows: [state.existingUser] };
        }
        return { rows: [] };
      }
      if (sql.includes("FROM user_account WHERE id = $1")) {
        if (state.deterministicIdOccupiedByEmail) {
          return { rows: [{ email: state.deterministicIdOccupiedByEmail }] };
        }
        if (state.existingUser && state.existingUser.id === params?.[0]) {
          return { rows: [{ email: state.existingUser.email }] };
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO user_account")) {
        const id = params?.[0];
        const email = params?.[2];
        state.existingUser = { id, email, password_hash: params?.[3] };
        return { rows: [] };
      }
      if (sql.includes("SELECT COUNT(rp.permission_id)")) {
        // Verification query
        if (state.existingMembership) {
          return { rows: [{ count: "10" }] };
        }
        return { rows: [{ count: "0" }] };
      }
      if (sql.includes("FROM membership")) {
        if (state.existingMembership) {
          return { rows: [state.existingMembership] };
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO membership")) {
        state.existingMembership = { id: "membership-uuid" };
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO authz_audit_log")) {
        return { rows: [] };
      }
      throw new Error(`Unhandled query in mock: ${sql}`);
    });
  });

  it("proves repair works on a database containing tenant and organization but no users", async () => {
    await repairBootstrap();

    expect(state.existingUser).not.toBeNull();
    expect(state.existingUser.email).toBe("admin@example.com");
    expect(state.existingMembership).not.toBeNull();
    expect(state.existingRoles).toHaveLength(6);
    expect(state.existingPermissions).toHaveLength(10);

    const beginCalled = state.queriesRun.some((q) => q.sql === "BEGIN");
    const commitCalled = state.queriesRun.some((q) => q.sql === "COMMIT");
    expect(beginCalled).toBe(true);
    expect(commitCalled).toBe(true);
  });

  it("proves repair is idempotent", async () => {
    // Run once
    await repairBootstrap();
    const firstRolesCount = state.existingRoles.length;
    const firstPermissionsCount = state.existingPermissions.length;

    // Run twice
    await repairBootstrap();
    expect(state.existingRoles).toHaveLength(firstRolesCount);
    expect(state.existingPermissions).toHaveLength(firstPermissionsCount);
  });

  it("proves plaintext passwords never appear in logs or audit context", async () => {
    await repairBootstrap();

    // Plaintext password should not be logged to console
    const logOutput = consoleLogSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logOutput).not.toContain("password123Secure!");

    // Plaintext password should not appear in audit log context
    const auditCall = state.queriesRun.find((q) =>
      q.sql.includes("INSERT INTO authz_audit_log"),
    );
    expect(auditCall).toBeDefined();
    const auditContext = JSON.parse(auditCall?.params?.[2]);
    expect(JSON.stringify(auditContext)).not.toContain("password123Secure!");
    expect(JSON.stringify(auditContext)).not.toContain("$argon2id$");
  });

  it("proves existing administrator account is preserved, and missing membership/RBAC records are repaired", async () => {
    // Seed existing administrator user with a pre-existing password hash
    const initialHash = "pre-existing-hash-unmodified";
    state.existingUser = {
      id: "00000000-0000-0000-0000-000000001001",
      email: "admin@example.com",
      password_hash: initialHash,
    };

    // Run repair
    await repairBootstrap();

    // Verify existing administrator was preserved
    expect(state.existingUser.password_hash).toBe(initialHash);

    // Verify membership and roles were repaired/seeded
    expect(state.existingMembership).not.toBeNull();
    expect(state.existingRoles).toHaveLength(6);
    expect(state.existingPermissions).toHaveLength(10);
  });

  it("proves failure rolls back all repair records (forced rollback test)", async () => {
    // Cause a forced failure on permission insert
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
      state.queriesRun.push({ sql, params });

      if (sql.includes("BEGIN") || sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (sql.includes("FROM tenant")) {
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              name: "Anambra State Ministry of Environment",
            },
          ],
        };
      }
      if (sql.includes("FROM organization")) {
        return {
          rows: [
            { id: "00000000-0000-0000-0000-000000000010", name: "Anambra State Ministry of Environment Headquarters" },
          ],
        };
      }
      if (sql.includes("FROM role")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO role")) {
        // Throw an error here to force failure and test transaction rollback
        throw new Error("Simulated database constraint failure");
      }
      if (sql.includes("ROLLBACK")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(repairBootstrap()).rejects.toThrow(
      "Simulated database constraint failure",
    );

    const rollbackCalled = state.queriesRun.some((q) => q.sql === "ROLLBACK");
    expect(rollbackCalled).toBe(true);
  });
});
