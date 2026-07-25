export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000010";
export const DEFAULT_ADMIN_USER_ID = "00000000-0000-0000-0000-000000001001";

export const DEFAULT_TENANT_NAME = "Anambra State Ministry of Environment";
export const DEFAULT_ORG_NAME = "Anambra State Ministry of Environment Headquarters";

export interface SeedRole {
  id: string;
  name: string;
  desc: string;
}

export const ROLES: SeedRole[] = [
  {
    id: "00000000-0000-0000-0000-000000000501",
    name: "super_admin",
    desc: "Full management access",
  },
  {
    id: "00000000-0000-0000-0000-000000000502",
    name: "organization_admin",
    desc: "Manage org settings",
  },
  {
    id: "00000000-0000-0000-0000-000000000503",
    name: "director",
    desc: "Review director decisions",
  },
  {
    id: "00000000-0000-0000-0000-000000000504",
    name: "inspector",
    desc: "Conduct audits",
  },
  {
    id: "00000000-0000-0000-0000-000000000505",
    name: "facility_owner",
    desc: "Register facilities",
  },
  {
    id: "00000000-0000-0000-0000-000000000506",
    name: "citizen",
    desc: "Public reporting",
  },
];

export const PERMISSIONS = [
  "org:read",
  "org:write",
  "facility:read",
  "facility:write",
  "facility:register",
  "facility:review",
  "audit:read",
  "complaint:review",
  "complaint:contact:read",
  "workbench:queue:read",
];

export const OFFICER_PERMS = [
  "complaint:review",
  "complaint:contact:read",
  "workbench:queue:read",
];

export const OFFICER_ROLES = [
  "00000000-0000-0000-0000-000000000503", // director
  "00000000-0000-0000-0000-000000000504", // inspector
];
