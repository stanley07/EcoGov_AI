import { INVITATION_ACCEPTANCE_HASH_ROUTE } from "@govos/core/invitation-routes";

export const AUTH_RETURN_TO_KEY = "govos.auth.returnTo";

export type AppTab =
  | "dashboard" | "registry" | "wizard" | "queue" | "settings" | "platform"
  | "subcontractor-apply" | "subcontractor-status" | "audits" | "inspections"
  | "incidents" | "permits" | "compliance" | "enforcement" | "waste"
  | "monitoring" | "gis" | "reports" | "verify-licence" | "accept-invitation" | "users-access" | "account-security" | "user-security" | "organizations" | "organization-detail" | "denied";

export type EcoGovRouteDefinition = {
  id: AppTab;
  path: string;
  label: string;
  group: "dashboard" | "environmental_operations" | "waste_management" | "environmental_monitoring" | "gis_mapping" | "reports" | "marketplace" | "administration";
  accessBoundary: "public" | "authenticated" | "platform_admin";
  requiredPermission?: string;
  implementationStatus: "available" | "planned";
  breadcrumb: string[];
  order: number;
  visibleInNavigation: boolean;
};

type RouteInput = Omit<EcoGovRouteDefinition, "label" | "group" | "breadcrumb" | "order" | "visibleInNavigation">;
const routeMetadata: Record<AppTab, Pick<EcoGovRouteDefinition, "label" | "group" | "breadcrumb" | "order" | "visibleInNavigation">> = {
  dashboard: { label: "System Dashboard", group: "dashboard", breadcrumb: ["Dashboard"], order: 1, visibleInNavigation: true },
  registry: { label: "Facility Registry", group: "environmental_operations", breadcrumb: ["Operations", "Facility Registry"], order: 2, visibleInNavigation: true },
  wizard: { label: "Register Facility", group: "environmental_operations", breadcrumb: ["Operations", "Facility Registry", "Register"], order: 3, visibleInNavigation: false },
  queue: { label: "Officer Workbench", group: "environmental_operations", breadcrumb: ["Operations", "Officer Workbench"], order: 4, visibleInNavigation: true },
  audits: { label: "Environmental Audits", group: "environmental_operations", breadcrumb: ["Operations", "Environmental Audits"], order: 5, visibleInNavigation: true },
  inspections: { label: "Inspections", group: "environmental_operations", breadcrumb: ["Operations", "Inspections"], order: 6, visibleInNavigation: true },
  incidents: { label: "Incidents", group: "environmental_operations", breadcrumb: ["Operations", "Incidents"], order: 7, visibleInNavigation: true },
  permits: { label: "Permits", group: "environmental_operations", breadcrumb: ["Operations", "Permits"], order: 8, visibleInNavigation: true },
  compliance: { label: "Compliance", group: "environmental_operations", breadcrumb: ["Operations", "Compliance"], order: 9, visibleInNavigation: true },
  enforcement: { label: "Enforcement Notices", group: "environmental_operations", breadcrumb: ["Operations", "Enforcement"], order: 10, visibleInNavigation: true },
  waste: { label: "Waste Sites", group: "waste_management", breadcrumb: ["Waste Management", "Waste Sites"], order: 11, visibleInNavigation: true },
  monitoring: { label: "Monitoring Stations", group: "environmental_monitoring", breadcrumb: ["Environmental Monitoring", "Monitoring Stations"], order: 12, visibleInNavigation: true },
  gis: { label: "GIS Map Layers", group: "gis_mapping", breadcrumb: ["GIS & Mapping", "Map Layers"], order: 13, visibleInNavigation: true },
  reports: { label: "Roadmap Reports", group: "reports", breadcrumb: ["Reports", "Roadmap Reports"], order: 14, visibleInNavigation: true },
  "subcontractor-apply": { label: "Apply for Licence", group: "marketplace", breadcrumb: ["Marketplace", "Apply for Licence"], order: 15, visibleInNavigation: true },
  "subcontractor-status": { label: "Licence Status", group: "marketplace", breadcrumb: ["Marketplace", "Licence Status"], order: 16, visibleInNavigation: true },
  "verify-licence": { label: "Verify Licence", group: "marketplace", breadcrumb: ["Marketplace", "Verify Licence"], order: 17, visibleInNavigation: false },
  "accept-invitation": { label: "Accept Invitation", group: "administration", breadcrumb: ["Accept Invitation"], order: 18, visibleInNavigation: false },
  platform: { label: "Platform Console", group: "administration", breadcrumb: ["Administration", "Platform Console"], order: 19, visibleInNavigation: true },
  settings: { label: "Org Settings", group: "administration", breadcrumb: ["Administration", "Org Settings"], order: 20, visibleInNavigation: true },
  "users-access": { label: "Users & Access", group: "administration", breadcrumb: ["Administration", "Users & Access"], order: 21, visibleInNavigation: true },
  "account-security": { label: "Account Security", group: "administration", breadcrumb: ["Account", "Security"], order: 22, visibleInNavigation: false },
  "user-security": { label: "User Security", group: "administration", breadcrumb: ["Administration", "Users & Access", "Security"], order: 23, visibleInNavigation: false },
  organizations: { label: "Organizations", group: "administration", breadcrumb: ["Administration", "Organizations"], order: 24, visibleInNavigation: true },
  "organization-detail": { label: "Organization", group: "administration", breadcrumb: ["Administration", "Organizations", "Organization"], order: 25, visibleInNavigation: false },
  denied: { label: "Access Restricted", group: "administration", breadcrumb: ["Restricted"], order: 26, visibleInNavigation: false },
};
const defineRoute = (route: RouteInput): EcoGovRouteDefinition => ({ ...routeMetadata[route.id], ...route });

export const routesRegistry: readonly EcoGovRouteDefinition[] = ([
  { id: "dashboard", path: "#/dashboard", accessBoundary: "authenticated", requiredPermission: "ecogov.dashboard.read", implementationStatus: "available" },
  { id: "registry", path: "#/facilities", accessBoundary: "authenticated", requiredPermission: "ecogov.facilities.read", implementationStatus: "available" },
  { id: "wizard", path: "#/facilities/register", accessBoundary: "authenticated", requiredPermission: "facility:register", implementationStatus: "available" },
  { id: "registry", path: "#/facilities/:facilityId", accessBoundary: "authenticated", requiredPermission: "ecogov.facilities.read", implementationStatus: "available" },
  { id: "queue", path: "#/queue", accessBoundary: "authenticated", requiredPermission: "facility:review", implementationStatus: "available" },
  { id: "audits", path: "#/operations/audits", accessBoundary: "authenticated", requiredPermission: "ecogov.audits.read", implementationStatus: "planned" },
  { id: "inspections", path: "#/operations/inspections", accessBoundary: "authenticated", requiredPermission: "ecogov.inspections.read", implementationStatus: "planned" },
  { id: "incidents", path: "#/operations/incidents", accessBoundary: "authenticated", requiredPermission: "complaint:review", implementationStatus: "planned" },
  { id: "permits", path: "#/operations/permits", accessBoundary: "authenticated", requiredPermission: "ecogov.permits.read", implementationStatus: "planned" },
  { id: "compliance", path: "#/operations/compliance", accessBoundary: "authenticated", requiredPermission: "ecogov.compliance.read", implementationStatus: "planned" },
  { id: "enforcement", path: "#/operations/enforcement", accessBoundary: "authenticated", requiredPermission: "ecogov.enforcement.read", implementationStatus: "planned" },
  { id: "waste", path: "#/waste", accessBoundary: "authenticated", requiredPermission: "ecogov.waste.read", implementationStatus: "planned" },
  { id: "monitoring", path: "#/monitoring", accessBoundary: "authenticated", requiredPermission: "ecogov.monitoring.read", implementationStatus: "planned" },
  { id: "gis", path: "#/gis", accessBoundary: "authenticated", requiredPermission: "facility:read", implementationStatus: "planned" },
  { id: "reports", path: "#/reports", accessBoundary: "authenticated", requiredPermission: "ecogov.reports.read", implementationStatus: "planned" },
  { id: "subcontractor-apply", path: "#/subcontractor-apply", accessBoundary: "public", implementationStatus: "available" },
  { id: "subcontractor-apply", path: "#/marketplace/apply", accessBoundary: "public", implementationStatus: "available" },
  { id: "subcontractor-status", path: "#/marketplace/status", accessBoundary: "public", implementationStatus: "available" },
  { id: "subcontractor-status", path: "#/marketplace/status/:applicationId", accessBoundary: "public", implementationStatus: "available" },
  { id: "verify-licence", path: "#/verify-licence", accessBoundary: "public", implementationStatus: "planned" },
  { id: "accept-invitation", path: INVITATION_ACCEPTANCE_HASH_ROUTE, accessBoundary: "public", implementationStatus: "available" },
  { id: "platform", path: "#/platform", accessBoundary: "platform_admin", implementationStatus: "available" },
  { id: "platform", path: "#/platform/:section", accessBoundary: "platform_admin", implementationStatus: "available" },
  { id: "settings", path: "#/settings", accessBoundary: "authenticated", implementationStatus: "available" },
  { id: "users-access", path: "#/users-access", accessBoundary: "authenticated", requiredPermission: "user:read", implementationStatus: "available" },
  { id: "users-access", path: "#/administration/users", accessBoundary: "authenticated", requiredPermission: "user:read", implementationStatus: "available" },
  { id: "user-security", path: "#/administration/users/:userId/security", accessBoundary: "authenticated", requiredPermission: "user:read", implementationStatus: "available" },
  { id: "organizations", path: "#/administration/organizations", accessBoundary: "authenticated", requiredPermission: "org:read", implementationStatus: "available" },
  { id: "organization-detail", path: "#/administration/organizations/:organizationId", accessBoundary: "authenticated", requiredPermission: "org:read", implementationStatus: "available" },
  { id: "account-security", path: "#/account/security", accessBoundary: "authenticated", implementationStatus: "available" },
  { id: "denied", path: "#/_denied", accessBoundary: "authenticated", implementationStatus: "available" },
] satisfies readonly RouteInput[]).map(defineRoute);

export const LEGACY_TAB_ROUTES: Readonly<Record<Exclude<AppTab, "denied">, string>> = {
  dashboard: "#/dashboard", registry: "#/facilities", wizard: "#/facilities/register",
  queue: "#/queue", settings: "#/settings", platform: "#/platform",
  "users-access": "#/users-access",
  "account-security": "#/account/security",
  "user-security": "#/administration/users",
  organizations: "#/administration/organizations",
  "organization-detail": "#/administration/organizations",
  "subcontractor-apply": "#/subcontractor-apply", "subcontractor-status": "#/marketplace/status",
  "verify-licence": "#/verify-licence",
  "accept-invitation": INVITATION_ACCEPTANCE_HASH_ROUTE,
  audits: "#/operations/audits", inspections: "#/operations/inspections",
  incidents: "#/operations/incidents", permits: "#/operations/permits",
  compliance: "#/operations/compliance", enforcement: "#/operations/enforcement",
  waste: "#/waste", monitoring: "#/monitoring", gis: "#/gis", reports: "#/reports",
};

export type RouteMatch = { route: EcoGovRouteDefinition; hash: string; params: Readonly<Record<string, string>> };

export function normalizeHash(input: string): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) || value.includes("\\")) return null;
  if (value.startsWith("#") && !value.startsWith("#/")) value = `#/${value.slice(1)}`;
  if (!value.startsWith("#/")) return null;
  const withoutQuery = value.split("?")[0]?.split("&")[0] || "";
  let decoded: string;
  try { decoded = decodeURIComponent(withoutQuery); } catch { return null; }
  if (decoded.includes("..") || Array.from(decoded).some((character) => character.charCodeAt(0) < 32)) return null;
  const normalized = decoded.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized === "#" ? null : normalized;
}

function matchPattern(pattern: string, hash: string): Readonly<Record<string, string>> | null {
  const expected = pattern.split("/"); const actual = hash.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index]; const candidate = actual[index];
    if (!part || !candidate) return null;
    if (part.startsWith(":")) {
      if (!/^[a-z0-9_-]+$/i.test(candidate)) return null;
      params[part.slice(1)] = candidate;
    } else if (part !== candidate) return null;
  }
  return params;
}

export function matchRoute(input: string): RouteMatch | null {
  const hash = normalizeHash(input); if (!hash) return null;
  for (const route of routesRegistry) {
    const params = matchPattern(route.path, hash);
    if (params) return { route, hash, params };
  }
  return null;
}

export function defaultHash(canAccessPlatformAdmin: boolean): string {
  return canAccessPlatformAdmin ? "#/platform" : "#/dashboard";
}

export function navigateHash(hash: string): boolean {
  const match = matchRoute(hash); if (!match) return false;
  if (window.location.hash !== match.hash) window.location.hash = match.hash;
  return true;
}

export function navigateLegacyTab(tabName: string): boolean {
  const hash = LEGACY_TAB_ROUTES[tabName as Exclude<AppTab, "denied">];
  return hash ? navigateHash(hash) : false;
}

export function validateAndStoreRedirect(targetHash: string): boolean {
  const match = matchRoute(targetHash);
  if (!match || match.route.accessBoundary === "public" || match.route.id === "denied") return false;
  sessionStorage.setItem(AUTH_RETURN_TO_KEY, match.hash);
  return true;
}

export function consumeStoredRedirect(): string | null {
  const returnTo = sessionStorage.getItem(AUTH_RETURN_TO_KEY);
  sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
  return returnTo && matchRoute(returnTo) ? normalizeHash(returnTo) : null;
}

export type RouteResolution = { tab: AppTab; hash: string; facilityId?: string; denied: boolean; requiresLogin: boolean };

export function resolveRoute(input: { hash: string; authenticated: boolean; permissions: readonly string[]; canAccessPlatformAdmin: boolean }): RouteResolution {
  const fallback = defaultHash(input.canAccessPlatformAdmin);
  const match = matchRoute(input.hash) || matchRoute(fallback)!;
  if (match.route.accessBoundary !== "public" && !input.authenticated) {
    validateAndStoreRedirect(match.hash);
    return { tab: match.route.id, hash: match.hash, denied: false, requiresLogin: true };
  }
  if (match.route.accessBoundary === "platform_admin" && !input.canAccessPlatformAdmin) {
    return { tab: "denied", hash: "#/_denied", denied: true, requiresLogin: false };
  }
  if (match.route.requiredPermission && !input.permissions.includes(match.route.requiredPermission)) {
    return { tab: "denied", hash: "#/_denied", denied: true, requiresLogin: false };
  }
  return { tab: match.route.id, hash: match.hash, facilityId: match.params.facilityId, denied: false, requiresLogin: false };
}
