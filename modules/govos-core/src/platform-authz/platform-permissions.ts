export enum PlatformPermission {
  TENANT_READ = "platform.tenant.read",
  TENANT_CREATE = "platform.tenant.create",
  TENANT_UPDATE = "platform.tenant.update",
  TENANT_SUSPEND = "platform.tenant.suspend",
  TENANT_INVITE = "platform.tenant.invite_admin",
  AUDIT_READ = "platform.audit.read",
}

export const PLATFORM_ROLE_PERMISSIONS: Record<string, PlatformPermission[]> = {
  PLATFORM_SUPER_ADMIN: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.TENANT_CREATE,
    PlatformPermission.TENANT_UPDATE,
    PlatformPermission.TENANT_SUSPEND,
    PlatformPermission.TENANT_INVITE,
    PlatformPermission.AUDIT_READ,
  ],
  PLATFORM_SUPPORT_ADMIN: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.TENANT_UPDATE,
  ],
  PLATFORM_AUDITOR: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.AUDIT_READ,
  ],
};
