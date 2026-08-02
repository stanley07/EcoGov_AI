export enum PlatformPermission {
  TENANT_READ = "platform.tenant.read",
  TENANT_CREATE = "platform.tenant.create",
  TENANT_UPDATE = "platform.tenant.update",
  TENANT_SUSPEND = "platform.tenant.suspend",
  TENANT_INVITE = "platform.tenant.invite_admin",
  AUDIT_READ = "platform.audit.read",

  // New precise platform admin permissions
  REGISTRY_READ = "platform.registry.read",
  REGISTRY_ACTIVATE = "platform.registry.activate",
  REGISTRY_RETIRE = "platform.registry.retire",
  EXECUTIONS_READ = "platform.executions.read",
  EXECUTIONS_READ_SENSITIVE = "platform.executions.read_sensitive_metadata",
  USAGE_READ = "platform.usage.read",
  HEALTH_READ = "platform.health.read",
  TENANTS_CONFIGURE = "platform.tenants.configure",
  TENANTS_REACTIVATE = "platform.tenants.reactivate",
}

export const PLATFORM_ROLE_PERMISSIONS: Record<string, PlatformPermission[]> = {
  PLATFORM_SUPER_ADMIN: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.TENANT_CREATE,
    PlatformPermission.TENANT_UPDATE,
    PlatformPermission.TENANT_SUSPEND,
    PlatformPermission.TENANT_INVITE,
    PlatformPermission.AUDIT_READ,
    PlatformPermission.REGISTRY_READ,
    PlatformPermission.REGISTRY_ACTIVATE,
    PlatformPermission.REGISTRY_RETIRE,
    PlatformPermission.EXECUTIONS_READ,
    PlatformPermission.EXECUTIONS_READ_SENSITIVE,
    PlatformPermission.USAGE_READ,
    PlatformPermission.HEALTH_READ,
    PlatformPermission.TENANTS_CONFIGURE,
    PlatformPermission.TENANTS_REACTIVATE,
  ],
  PLATFORM_SUPPORT_ADMIN: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.TENANT_UPDATE,
    PlatformPermission.REGISTRY_READ,
    PlatformPermission.EXECUTIONS_READ,
    PlatformPermission.USAGE_READ,
    PlatformPermission.HEALTH_READ,
  ],
  PLATFORM_AUDITOR: [
    PlatformPermission.TENANT_READ,
    PlatformPermission.AUDIT_READ,
    PlatformPermission.REGISTRY_READ,
    PlatformPermission.EXECUTIONS_READ,
    PlatformPermission.USAGE_READ,
  ],
};
