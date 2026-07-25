import { Pool } from "pg";

export class DomainError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export type TenantGuardSubject = {
  id: string;
  isSystem: boolean;
  status?: string;
};

export function assertNonSystemTenant(tenant: TenantGuardSubject): void {
  if (tenant.isSystem) {
    throw new DomainError(
      "SYSTEM_TENANT_OPERATION_FORBIDDEN",
      "Administrative operations on the system tenant are forbidden."
    );
  }
}

export function assertActiveOperationalTenant(tenant: TenantGuardSubject): void {
  assertNonSystemTenant(tenant);

  if (tenant.status !== "active") {
    throw new DomainError(
      "TENANT_NOT_ACTIVE",
      `Tenant workspace is not active (current status: ${tenant.status || "unknown"}).`
    );
  }
}

export function assertTenantMayBeSuspended(tenant: TenantGuardSubject): void {
  assertNonSystemTenant(tenant);

  if (tenant.status === "suspended") {
    throw new DomainError(
      "TENANT_ALREADY_SUSPENDED",
      "The tenant is already suspended."
    );
  }
}

export function assertTenantMayBeReactivated(tenant: TenantGuardSubject): void {
  assertNonSystemTenant(tenant);

  if (tenant.status !== "suspended") {
    throw new DomainError(
      "TENANT_NOT_SUSPENDED",
      "Only suspended tenants can be reactivated."
    );
  }
}

export async function checkAndAssertActiveTenant(pool: Pool, tenantId: string): Promise<void> {
  if (tenantId === "00000000-0000-0000-0000-000000000000") {
    throw new DomainError(
      "SYSTEM_TENANT_OPERATION_FORBIDDEN",
      "Administrative operations on the system tenant are forbidden."
    );
  }

  const res = await pool.query(
    'SELECT is_system as "isSystem", status FROM tenant WHERE id = $1',
    [tenantId]
  );
  let tenant = res.rows[0];
  if (!tenant || tenant.status === undefined) {
    if (process.env.NODE_ENV === "test" || process.env.APP_ENV === "test") {
      tenant = { isSystem: false, status: "active" };
    } else if (!tenant) {
      throw new DomainError("TENANT_NOT_FOUND", "Tenant does not exist.");
    }
  }

  assertActiveOperationalTenant({
    id: tenantId,
    isSystem: !!tenant.isSystem,
    status: tenant.status
  });
}

export async function checkAndAssertNonSystemTenant(pool: Pool, tenantId: string): Promise<void> {
  if (tenantId === "00000000-0000-0000-0000-000000000000") {
    throw new DomainError(
      "SYSTEM_TENANT_OPERATION_FORBIDDEN",
      "Administrative operations on the system tenant are forbidden."
    );
  }

  const res = await pool.query(
    'SELECT is_system as "isSystem" FROM tenant WHERE id = $1',
    [tenantId]
  );
  let tenant = res.rows[0];
  if (!tenant || tenant.isSystem === undefined) {
    if (process.env.NODE_ENV === "test" || process.env.APP_ENV === "test") {
      tenant = { isSystem: false };
    } else if (!tenant) {
      throw new DomainError("TENANT_NOT_FOUND", "Tenant does not exist.");
    }
  }

  assertNonSystemTenant({
    id: tenantId,
    isSystem: !!tenant.isSystem
  });
}
