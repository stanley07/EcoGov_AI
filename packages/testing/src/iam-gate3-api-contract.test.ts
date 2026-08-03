import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ASSIGNABLE_TENANT_ROLES } from "@govos/core/tenant-role-catalog";

const source = readFileSync(resolve(process.cwd(), "apps/api/src/routes/tenant-iam.ts"), "utf8");

describe("IAM Gate 3 tenant API security contract", () => {
  test.each([
    ["GET /users", '"user:read"'],
    ["GET /users/invitations", '"invitation:read"'],
    ["POST /users/invitations", '"invitation:create"'],
    ["resend", '"invitation:resend"'],
    ["revoke", '"invitation:revoke"'],
    ["role change", '"user:role:assign"'],
    ["status change", '"user:status:write"'],
    ["role list", '"role:read"'],
  ])("%s enforces granular %s", (_label, permission) => {
    expect(source).toMatch(new RegExp(`requirePermission\\(pool,\\s*req,\\s*reply,\\s*${permission}`));
  });

  test("new endpoints never authorize through compatibility user:write", () => {
    expect(Array.isArray(ASSIGNABLE_TENANT_ROLES)).toBe(true);
    expect(typeof ASSIGNABLE_TENANT_ROLES[Symbol.iterator]).toBe("function");
    expect([...ASSIGNABLE_TENANT_ROLES]).toEqual([
      "director", "inspector", "environmental_consultant", "finance_officer", "citizen",
    ]);
    expect(source).not.toContain('requirePermission(pool, req, reply, "user:write")');
    expect(source).not.toContain('requirePermission(pool,req,reply,"user:write")');
  });

  test("queries and mutations carry tenant predicates and block cross-tenant roles", () => {
    expect(source.match(/tenant_id=\$1/g)?.length).toBeGreaterThan(15);
    expect(source).toContain("SELECT id,name FROM role WHERE tenant_id=$1 AND id=$2");
    expect(source).toContain("p.tenant_id=r.tenant_id");
    expect(source).toContain("Self role changes are prohibited");
    expect(source).toContain("Self status changes are prohibited");
    expect(source).toContain("Final active super administrator is protected");
  });

  test("invitation lifecycle uses hashing, encrypted outbox, idempotency, supersession, and audit", () => {
    expect(source).toContain('createHash("sha256")');
    expect(source).toContain("encryptPayload");
    expect(source).toContain("Idempotency key conflict");
    expect(source).toContain("status='superseded'");
    expect(source).toContain("TENANT_INVITATION_CREATED");
    expect(source).not.toMatch(/send\(\{[^}]*rawToken/s);
  });

  test("role and status changes invalidate only target tenant sessions and audit transactionally", () => {
    expect(source.match(/DELETE FROM session WHERE tenant_id=\$1 AND user_id=\$2/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("TENANT_ROLE_CHANGED");
    expect(source).toContain("TENANT_USER_SUSPENDED");
  });
});
