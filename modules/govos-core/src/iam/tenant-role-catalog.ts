import { resolveRolePermissions } from "../rbac.js";

export const TENANT_IAM_PERMISSIONS = Object.freeze([
  "user:read",
  "user:invite",
  "user:role:assign",
  "user:membership:update",
  "invitation:read",
  "invitation:create",
  "invitation:resend",
  "invitation:revoke",
  "role:read",
] as const);

export const TENANT_SECURITY_PERMISSIONS = Object.freeze([
  "user:status:write",
  "user:session:revoke",
  "user:mfa:reset",
] as const);

export const TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS = Object.freeze(
  [...resolveRolePermissions("super_admin")].filter(
    (permission) => permission !== "user:read" && permission !== "user:write",
  ).sort(),
);

export const TENANT_SUPER_ADMIN_PERMISSION_MANIFEST = Object.freeze([
  ...TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS,
  ...TENANT_IAM_PERMISSIONS,
  ...TENANT_SECURITY_PERMISSIONS,
  "user:write",
].sort());

export const ASSIGNABLE_TENANT_ROLES = Object.freeze([
  "director",
  "inspector",
  "environmental_consultant",
  "finance_officer",
  "citizen",
] as const);

export const PROTECTED_TENANT_ROLES = Object.freeze([
  "super_admin",
  "organization_admin",
] as const);

export const TENANT_ROLE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  super_admin: "Super Administrator",
  director: "Director",
  inspector: "Inspector",
  environmental_consultant: "Environmental Consultant / Subcontractor",
  finance_officer: "Finance Officer",
  organization_admin: "Organization Administrator",
  citizen: "Citizen",
});

export const TENANT_ROLE_PERMISSION_MANIFESTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    super_admin: TENANT_SUPER_ADMIN_PERMISSION_MANIFEST,
    director: Object.freeze([
      ...new Set([
        ...resolveRolePermissions("director"),
        "user:read",
        "invitation:read",
        "role:read",
      ]),
    ].sort()),
    inspector: Object.freeze([...resolveRolePermissions("inspector")].sort()),
    environmental_consultant: Object.freeze(
      [...resolveRolePermissions("environmental_consultant")].sort(),
    ),
    finance_officer: Object.freeze([...resolveRolePermissions("finance_officer")].sort()),
    citizen: Object.freeze([...resolveRolePermissions("citizen")].sort()),
  });

export function assertTenantRoleCatalog(): void {
  const manifest = TENANT_SUPER_ADMIN_PERMISSION_MANIFEST;
  if (TENANT_SUPER_ADMIN_OPERATIONAL_PERMISSIONS.length !== 12)
    throw new Error("Tenant super_admin operational manifest must contain 12 names");
  if (new Set(manifest).size !== 25)
    throw new Error("Tenant super_admin manifest must contain 25 unique names");
  if (manifest.some((name) => name.startsWith("platform.") || name.startsWith("PLATFORM_")))
    throw new Error("Tenant permission catalog contains platform authority");
  if (Object.keys(TENANT_ROLE_PERMISSION_MANIFESTS).includes("subcontractor"))
    throw new Error("Subcontractor must remain a business alias");
}
