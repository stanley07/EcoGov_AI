import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildInvitationActivationUrl,
  INVITATION_ACCEPTANCE_HASH_ROUTE,
} from "@govos/core/invitation-routes";
import { consumeInvitationToken } from "../auth/InvitationAcceptancePage.js";
import { matchRoute, resolveRoute } from "../layout/routes.js";

describe("IAM Gate 2 public invitation acceptance route", () => {
  const token = "a".repeat(43);
  const history = { replaceState: vi.fn() };

  beforeEach(() => history.replaceState.mockClear());

  test("notification generator uses the exact canonical public hash route", () => {
    const generated = new URL(buildInvitationActivationUrl("http://localhost:3000", token));
    expect(generated.protocol).toBe("http:");
    expect(generated.hostname).toBe("localhost");
    expect(generated.port).toBe("3000");
    expect(generated.pathname).toBe("/");
    expect(generated.hash.split("?", 1)[0]).toBe(INVITATION_ACCEPTANCE_HASH_ROUTE);
    expect(new URLSearchParams(generated.hash.split("?", 2)[1]).has("token")).toBe(true);
  });

  test("direct hash entry is registered as public", () => {
    expect(matchRoute(`${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=${token}`)?.route)
      .toMatchObject({ id: "accept-invitation", accessBoundary: "public" });
  });

  test("logged-out access does not require login or fall back to landing", () => {
    expect(resolveRoute({ hash: `${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=${token}`, authenticated: false, permissions: [], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "accept-invitation", hash: INVITATION_ACCEPTANCE_HASH_ROUTE, requiresLogin: false, denied: false });
  });

  test("another authenticated user is not redirected to dashboard", () => {
    expect(resolveRoute({ hash: `${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=${token}`, authenticated: true, permissions: ["ecogov.dashboard.read"], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "accept-invitation", hash: INVITATION_ACCEPTANCE_HASH_ROUTE, requiresLogin: false, denied: false });
  });

  test("main renders invitation acceptance before public landing or authenticated shell fallbacks", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/web/src/main.tsx"), "utf8");
    const invitationRender = source.indexOf('if (activeTab === "accept-invitation")');
    const landingFallback = source.indexOf("if (!token || !user)");
    const shellRender = source.indexOf("<AppShell");
    expect(invitationRender).toBeGreaterThan(-1);
    expect(invitationRender).toBeLessThan(landingFallback);
    expect(invitationRender).toBeLessThan(shellRender);
  });

  test("valid token is retained in memory and removed from the browser address", () => {
    const consumed = consumeInvitationToken(
      { hash: `${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=${token}`, pathname: "/", search: "" },
      history,
    );
    expect(consumed).toBe(token);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", `/${INVITATION_ACCEPTANCE_HASH_ROUTE}`);
  });

  test.each([
    INVITATION_ACCEPTANCE_HASH_ROUTE,
    `${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=short`,
    `${INVITATION_ACCEPTANCE_HASH_ROUTE}?token=${token}&token=${token}`,
  ])("missing or malformed token is rejected safely", (hash) => {
    expect(consumeInvitationToken({ hash, pathname: "/", search: "" }, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
