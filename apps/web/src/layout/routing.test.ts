import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  AUTH_RETURN_TO_KEY,
  consumeStoredRedirect,
  matchRoute,
  navigateLegacyTab,
  normalizeHash,
  resolveRoute,
  validateAndStoreRedirect,
} from "./routes.js";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

describe("EMIS-1B.2 native hash routing", () => {
  const storage = new MemoryStorage();
  const location = { hash: "", pathname: "/", search: "" };

  beforeEach(() => {
    storage.clear(); location.hash = "";
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { location, history: { replaceState: vi.fn() } });
  });

  test("normalizes casing, legacy missing slash, duplicate separators, and trailing slash", () => {
    expect(normalizeHash("#/Facilities/")).toBe("#/facilities");
    expect(normalizeHash("#marketplace/apply")).toBe("#/marketplace/apply");
    expect(normalizeHash("#/operations//AUDITS/")).toBe("#/operations/audits");
  });

  test("rejects external, executable, traversal, malformed encoding, and unregistered targets", () => {
    for (const target of ["https://evil.com", "//evil.com", "javascript:alert(1)", "data:text/html,x", "file://x", "#/../../x", "#/%ZZ", "#/not-registered"]) {
      expect(matchRoute(target), target).toBeNull();
      expect(validateAndStoreRedirect(target), target).toBe(false);
    }
    expect(storage.getItem(AUTH_RETURN_TO_KEY)).toBeNull();
  });

  test("resolves refresh and deep-link facility identifiers", () => {
    expect(resolveRoute({ hash: "#/FACILITIES/ABC_123/", authenticated: true, permissions: ["ecogov.facilities.read"], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "registry", hash: "#/facilities/abc_123", facilityId: "abc_123", denied: false });
  });

  test("stores a private return target only while unauthenticated and consumes it once", () => {
    const result = resolveRoute({ hash: "#/facilities", authenticated: false, permissions: [], canAccessPlatformAdmin: false });
    expect(result.requiresLogin).toBe(true);
    expect(storage.getItem(AUTH_RETURN_TO_KEY)).toBe("#/facilities");
    expect(consumeStoredRedirect()).toBe("#/facilities");
    expect(storage.getItem(AUTH_RETURN_TO_KEY)).toBeNull();
    expect(consumeStoredRedirect()).toBeNull();
  });

  test("public marketplace routes do not create authentication redirects", () => {
    const result = resolveRoute({ hash: "#/marketplace/apply", authenticated: false, permissions: [], canAccessPlatformAdmin: false });
    expect(result).toMatchObject({ tab: "subcontractor-apply", requiresLogin: false, denied: false });
    expect(storage.getItem(AUTH_RETURN_TO_KEY)).toBeNull();
  });

  test("permission and platform boundaries resolve to the restricted view without rendering target tabs", () => {
    expect(resolveRoute({ hash: "#/operations/audits", authenticated: true, permissions: [], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "denied", hash: "#/_denied", denied: true });
    expect(resolveRoute({ hash: "#/platform/health", authenticated: true, permissions: [], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "denied", hash: "#/_denied", denied: true });
    expect(resolveRoute({ hash: "#/platform/health", authenticated: true, permissions: [], canAccessPlatformAdmin: true }))
      .toMatchObject({ tab: "platform", hash: "#/platform/health", denied: false });
  });

  test("invalid and empty hashes resolve to the authorized default", () => {
    expect(resolveRoute({ hash: "#/unknown", authenticated: true, permissions: ["ecogov.dashboard.read"], canAccessPlatformAdmin: false }))
      .toMatchObject({ tab: "dashboard", hash: "#/dashboard" });
    expect(resolveRoute({ hash: "", authenticated: true, permissions: [], canAccessPlatformAdmin: true }))
      .toMatchObject({ tab: "platform", hash: "#/platform" });
  });

  test("legacy navigation updates the hash once and ignores unknown tabs", () => {
    expect(navigateLegacyTab("registry")).toBe(true);
    expect(location.hash).toBe("#/facilities");
    expect(navigateLegacyTab("registry")).toBe(true);
    expect(location.hash).toBe("#/facilities");
    expect(navigateLegacyTab("unknown")).toBe(false);
  });
});
