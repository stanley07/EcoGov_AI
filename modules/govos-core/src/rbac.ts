import { logger } from "@govos/observability";

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: [
    "org:read",
    "org:write",
    "user:read",
    "user:write",
    "facility:read",
    "facility:write",
    "facility:register",
    "facility:review",
    "workflow:read",
    "workflow:write",
    "audit:read",
    "complaint:review",
    "complaint:contact:read",
    "workbench:queue:read",
  ],
  organization_admin: [
    "org:read",
    "org:write",
    "user:read",
    "user:write",
    "facility:read",
    "facility:write",
    "workflow:read",
  ],
  commissioner: [
    "org:read",
    "facility:read",
    "facility:review",
    "workflow:read",
    "audit:read",
  ],
  director: [
    "org:read",
    "facility:read",
    "facility:write",
    "facility:register",
    "facility:review",
    "workflow:read",
    "workflow:write",
    "audit:read",
    "complaint:review",
    "complaint:contact:read",
    "workbench:queue:read",
  ],
  inspector: [
    "org:read",
    "facility:read",
    "facility:write",
    "facility:register",
    "facility:review",
    "workflow:read",
    "complaint:review",
    "complaint:contact:read",
    "workbench:queue:read",
  ],
  environmental_consultant: [
    "facility:read",
    "facility:write",
    "facility:register",
  ],
  finance_officer: ["facility:read", "workflow:read"],
  facility_owner: ["facility:read", "facility:write", "facility:register"],
  citizen: ["facility:read"],
};

// Define role inheritance hierarchy
export const ROLE_INHERITANCE: Record<string, string[]> = {
  director: ["inspector"],
  inspector: ["citizen"],
  commissioner: ["director"],
  super_admin: ["organization_admin", "director"],
};

// Permission check cache with short TTL (10 seconds)
interface CacheEntry {
  permissions: Set<string>;
  expiresAt: number;
}

const permissionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10000;

export function clearPermissionCache(): void {
  permissionCache.clear();
}

/**
 * Recursively resolves all permissions for a role, including inherited permissions.
 * Implements strict cycle detection and a maximum depth boundary.
 */
export function resolveRolePermissions(
  role: string,
  visited: Set<string> = new Set(),
  depth = 0,
): Set<string> {
  const MAX_DEPTH = 5;
  if (depth > MAX_DEPTH) {
    logger.warn(
      { role, depth },
      "Maximum role inheritance depth exceeded during resolution",
    );
    return new Set();
  }

  if (visited.has(role)) {
    logger.error(
      { role, visited: Array.from(visited) },
      "Recursive role inheritance cycle detected",
    );
    throw new Error(`Cyclic role inheritance detected at role: ${role}`);
  }

  // Check cache
  const cached = permissionCache.get(role);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const permissions = new Set<string>(ROLE_PERMISSIONS[role] || []);
  visited.add(role);

  const inherited = ROLE_INHERITANCE[role] || [];
  for (const parentRole of inherited) {
    const parentPerms = resolveRolePermissions(
      parentRole,
      new Set(visited),
      depth + 1,
    );
    for (const perm of parentPerms) {
      permissions.add(perm);
    }
  }

  permissionCache.set(role, {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return permissions;
}

/**
 * Checks if any of the user's roles grant the requested permission.
 */
export function hasPermission(roles: string[], permission: string): boolean {
  for (const role of roles) {
    try {
      const resolved = resolveRolePermissions(role);
      if (resolved.has(permission)) {
        return true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, role },
        "RBAC permission check encountered error",
      );
    }
  }

  // Audits access denials for privileged actions
  if (
    permission.includes("write") ||
    permission.includes("review") ||
    permission.includes("register")
  ) {
    logger.warn(
      { roles, permission },
      "Privileged authorization permission denied",
    );
  }

  return false;
}
