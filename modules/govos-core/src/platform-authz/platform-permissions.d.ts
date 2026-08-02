export declare enum PlatformPermission {
    TENANT_READ = "platform.tenant.read",
    TENANT_CREATE = "platform.tenant.create",
    TENANT_UPDATE = "platform.tenant.update",
    TENANT_SUSPEND = "platform.tenant.suspend",
    TENANT_INVITE = "platform.tenant.invite_admin",
    AUDIT_READ = "platform.audit.read",
    REGISTRY_READ = "platform.registry.read",
    REGISTRY_ACTIVATE = "platform.registry.activate",
    REGISTRY_RETIRE = "platform.registry.retire",
    EXECUTIONS_READ = "platform.executions.read",
    EXECUTIONS_READ_SENSITIVE = "platform.executions.read_sensitive_metadata",
    USAGE_READ = "platform.usage.read",
    HEALTH_READ = "platform.health.read",
    TENANTS_CONFIGURE = "platform.tenants.configure",
    TENANTS_REACTIVATE = "platform.tenants.reactivate"
}
export declare const PLATFORM_ROLE_PERMISSIONS: Record<string, PlatformPermission[]>;