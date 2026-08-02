import { describe, expect, test } from "vitest";
import {
  SYSTEM_TENANT_ID,
  canViewPlatformAdmin,
} from "./shellAuthorization.js";

describe("Platform Admin shell visibility", () => {
  test("hides Platform Admin from a system-tenant user without platform permission", () => {
    expect(canViewPlatformAdmin(SYSTEM_TENANT_ID, ["super_admin"])).toBe(false);
  });

  test("shows Platform Admin to an authorized platform administrator", () => {
    expect(
      canViewPlatformAdmin(SYSTEM_TENANT_ID, ["PLATFORM_SUPER_ADMIN"]),
    ).toBe(true);
  });

  test("hides Platform Admin from ordinary tenant users", () => {
    expect(
      canViewPlatformAdmin("00000000-0000-0000-0000-000000000001", [
        "PLATFORM_SUPER_ADMIN",
      ]),
    ).toBe(false);
  });
});
