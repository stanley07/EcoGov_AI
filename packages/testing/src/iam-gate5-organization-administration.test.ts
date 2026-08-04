import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ORGANIZATION_ADMIN_ASSIGNABLE_ROLES,
  TENANT_ROLE_PERMISSION_MANIFESTS,
} from "@govos/core/tenant-role-catalog";

const api = readFileSync("apps/api/src/routes/organizations.ts", "utf8");
const security = readFileSync(
  "apps/api/src/routes/account-security.ts",
  "utf8",
);
const tenantIam = readFileSync("apps/api/src/routes/tenant-iam.ts", "utf8");
const routes = readFileSync("apps/web/src/layout/routes.ts", "utf8");
const navigation = readFileSync(
  "apps/web/src/layout/navigationConfig.ts",
  "utf8",
);
const listPage = readFileSync("apps/web/src/iam/OrganizationsPage.tsx", "utf8");
const detailPage = readFileSync(
  "apps/web/src/iam/OrganizationDetailPage.tsx",
  "utf8",
);

describe("IAM Gate 5 organization administration contracts", () => {
  test("organization lifecycle and optimistic concurrency endpoints are registered", () => {
    expect(api).toContain('app.get("/organizations"');
    expect(api).toContain('app.get("/organizations/:id"');
    expect(api).toContain('app.post("/organizations"');
    expect(api).toContain('app.patch("/organizations/:id"');
    expect(api).toContain("expectedVersion");
    expect(api).toContain("Organization version conflict");
  });

  test("membership, transfer, administrator, and invitation endpoints are scoped", () => {
    expect(api).toContain('"/organizations/:id/users"');
    expect(api).toContain('"/organizations/:id/users/:userId/transfer"');
    expect(api).toContain('"/organizations/:id/administrators"');
    expect(api).toContain('"/organizations/:id/invitations"');
    expect(api).toContain("m.organization_id=o.id");
    expect(api).toContain("WHERE m.tenant_id=$1");
  });

  test("delegated role ceiling excludes tenant and platform authority", () => {
    expect(ORGANIZATION_ADMIN_ASSIGNABLE_ROLES).toEqual([
      "inspector",
      "environmental_consultant",
      "citizen",
    ]);
    const delegated = TENANT_ROLE_PERMISSION_MANIFESTS.organization_admin!;
    expect(delegated).toContain("org:read");
    expect(delegated).toContain("user:mfa:reset");
    expect(delegated).not.toContain("user:write");
    expect(
      delegated.some((permission) => permission.startsWith("platform.")),
    ).toBe(false);
    expect(api).toContain('ro.name === "super_admin"');
    expect(api).toContain('ro.name === "organization_admin"');
  });

  test("tenant-wide APIs reject delegated administrators", () => {
    expect(tenantIam).toContain('current.roles.includes("organization_admin")');
    expect(tenantIam).toContain("Use organization-scoped administration");
  });

  test("security delegation is constrained to the actor organization", () => {
    expect(security).toContain("am.organization_id=m.organization_id");
    expect(security).toContain("r.name<>'organization_admin'");
  });

  test("session invalidation and ID-only audit actions cover mutations and denial", () => {
    expect(api).toContain(
      "DELETE FROM session WHERE tenant_id=$1 AND user_id=$2",
    );
    expect(api).toContain("ORGANIZATION_CREATED");
    expect(api).toContain("ORGANIZATION_ARCHIVED");
    expect(api).toContain("ORGANIZATION_ADMIN_ASSIGNED");
    expect(api).toContain("ORGANIZATION_ADMIN_REMOVED");
    expect(api).toContain("DELEGATED_ACTION_DENIED");
    expect(api).not.toMatch(/context[^\n]*(password|token|secret)/i);
  });

  test("final administrator and organization archive safeguards are present", () => {
    expect(api).toContain("Final organization administrator is protected");
    expect(api).toContain("Organization with current users cannot be archived");
    expect(api).not.toContain("DELETE FROM organization");
  });

  test("frontend routes and navigation expose organization administration", () => {
    expect(routes).toContain('path: "#/administration/organizations"');
    expect(routes).toContain(
      'path: "#/administration/organizations/:organizationId"',
    );
    expect(navigation).toContain('id: "organizations"');
    expect(navigation).toContain('requiredPermission: "org:read"');
    expect(listPage).toContain("Create organization");
    expect(detailPage).toContain("Organization users");
    expect(detailPage).toContain("Organization invitations");
    expect(detailPage).toContain("Organization settings");
  });

  test("frontend controls preserve accessible names and touch targets", () => {
    expect(listPage).toContain("minHeight: 44");
    expect(listPage).toContain("Tenant organizations");
    expect(detailPage).toContain('aria-label="Organization administration"');
    expect(detailPage).toContain('role="status"');
  });
});
