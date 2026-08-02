import {
  PLATFORM_ROLE_PERMISSIONS,
  PlatformPermission,
} from "../../../../modules/govos-core/src/platform-authz/platform-permissions.js";

export const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
export const PLATFORM_ADMIN_NAV_PERMISSION = PlatformPermission.TENANT_READ;

export function resolvePlatformPermissionClaims(
  roles: readonly string[],
): readonly PlatformPermission[] {
  const permissions = new Set<PlatformPermission>();

  for (const role of roles) {
    for (const permission of PLATFORM_ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }

  return Array.from(permissions);
}

export function canViewPlatformAdmin(
  tenantId: string,
  roles: readonly string[],
): boolean {
  return (
    tenantId === SYSTEM_TENANT_ID &&
    resolvePlatformPermissionClaims(roles).includes(
      PLATFORM_ADMIN_NAV_PERMISSION,
    )
  );
}
