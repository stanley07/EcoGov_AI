import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { matchRoute, resolveRoute } from "../layout/routes.js";
import { navigationGroups } from "../layout/navigationConfig.js";

const root = resolve(process.cwd(), "apps/web/src");
const pageSource = readFileSync(resolve(root, "iam/UsersAccessPage.tsx"), "utf8");
const landingSource = readFileSync(resolve(root, "LandingPage.tsx"), "utf8");
const mainSource = readFileSync(resolve(root, "main.tsx"), "utf8");

describe("IAM Gate 3 Users & Access frontend", () => {
  test("authorized tenant users can resolve the canonical route", () => {
    expect(matchRoute("#/users-access")?.route).toMatchObject({ id: "users-access", requiredPermission: "user:read" });
    expect(resolveRoute({ hash: "#/users-access", authenticated: true, permissions: ["user:read"], canAccessPlatformAdmin: false })).toMatchObject({ tab: "users-access", denied: false });
  });

  test("unauthorized direct access resolves Access Restricted", () => {
    expect(resolveRoute({ hash: "#/users-access", authenticated: true, permissions: [], canAccessPlatformAdmin: false })).toMatchObject({ tab: "denied", denied: true });
  });

  test("navigation is permission-gated and tenant-only", () => {
    const item = navigationGroups.flatMap((group) => group.items).find((candidate) => candidate.id === "users-access");
    expect(item).toMatchObject({ label: "Users & Access", requiredPermission: "user:read", tenantOnly: true });
  });

  test("page uses live endpoints, tenant roles, responsive containment, and accessible controls", () => {
    expect(pageSource).toContain('request("/users/roles")');
    expect(pageSource).toContain("/users/invitations");
    expect(pageSource).toContain('role="dialog"');
    expect(pageSource).toContain('aria-live="polite"');
    expect(pageSource).toContain("minHeight: 44");
    expect(pageSource).toContain("overflow-x:auto");
    expect(pageSource).toContain("Environmental Consultant / Subcontractor");
    expect(pageSource).not.toMatch(/activationUrl|invitationToken|tokenHash/);
  });

  test("production Quick Access credentials and shortcuts are removed", () => {
    for (const source of [landingSource, mainSource]) {
      expect(source).not.toContain("Quick Access Stubs");
      expect(source).not.toContain("password123");
      expect(source).not.toContain("owner@carwash.com");
      expect(source).not.toContain("quickLogin");
    }
  });

  test("current-user and protected administrator actions are disabled", () => {
    expect(pageSource).toContain("user.id===currentUserId");
    expect(pageSource).toContain('user.roleName==="super_admin"');
    expect(pageSource).toContain("sessions will be revoked");
  });
});
