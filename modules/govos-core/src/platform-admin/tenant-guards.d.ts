import { Pool } from "pg";
export declare class DomainError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export type TenantGuardSubject = {
    id: string;
    isSystem: boolean;
    status?: string;
};
export declare function assertNonSystemTenant(tenant: TenantGuardSubject): void;
export declare function assertActiveOperationalTenant(tenant: TenantGuardSubject): void;
export declare function assertTenantMayBeSuspended(tenant: TenantGuardSubject): void;
export declare function assertTenantMayBeReactivated(tenant: TenantGuardSubject): void;
export declare function checkAndAssertActiveTenant(pool: Pool, tenantId: string): Promise<void>;
export declare function checkAndAssertNonSystemTenant(pool: Pool, tenantId: string): Promise<void>;
//# sourceMappingURL=tenant-guards.d.ts.map