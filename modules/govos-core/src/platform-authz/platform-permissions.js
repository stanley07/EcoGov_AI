export var PlatformPermission;
(function (PlatformPermission) {
    PlatformPermission["TENANT_READ"] = "platform.tenant.read";
    PlatformPermission["TENANT_CREATE"] = "platform.tenant.create";
    PlatformPermission["TENANT_UPDATE"] = "platform.tenant.update";
    PlatformPermission["TENANT_SUSPEND"] = "platform.tenant.suspend";
    PlatformPermission["TENANT_INVITE"] = "platform.tenant.invite_admin";
    PlatformPermission["AUDIT_READ"] = "platform.audit.read";
})(PlatformPermission || (PlatformPermission = {}));
export const PLATFORM_ROLE_PERMISSIONS = {
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
//# sourceMappingURL=platform-permissions.js.map