export declare const ROLE_PERMISSIONS: Record<string, string[]>;
export declare const ROLE_INHERITANCE: Record<string, string[]>;
export declare function clearPermissionCache(): void;
/**
 * Recursively resolves all permissions for a role, including inherited permissions.
 * Implements strict cycle detection and a maximum depth boundary.
 */
export declare function resolveRolePermissions(role: string, visited?: Set<string>, depth?: number): Set<string>;
/**
 * Checks if any of the user's roles grant the requested permission.
 */
export declare function hasPermission(roles: string[], permission: string): boolean;
//# sourceMappingURL=rbac.d.ts.map