export type EcoGovRouteDefinition = {
  id: string;
  path: string; // e.g. '#/dashboard'
  label: string;
  group:
    | "dashboard"
    | "environmental_operations"
    | "waste_management"
    | "environmental_monitoring"
    | "gis_mapping"
    | "reports"
    | "marketplace"
    | "administration";
  accessBoundary: "public" | "authenticated" | "platform_admin";
  requiredPermission?: string;
  implementationStatus: "available" | "foundation" | "planned";
  breadcrumb?: string[];
  legacyAliases?: string[];
  order: number;
  visibleInNavigation: boolean;
};

export const routesRegistry: EcoGovRouteDefinition[] = [
  {
    id: "dashboard",
    path: "#/dashboard",
    label: "System Dashboard",
    group: "dashboard",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 1,
    visibleInNavigation: true,
    breadcrumb: ["Dashboard"],
  },
  {
    id: "registry",
    path: "#/facilities",
    label: "Facility Registry",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 2,
    visibleInNavigation: true,
    legacyAliases: ["facilities"],
    breadcrumb: ["Operations", "Facility Registry"],
  },
  {
    id: "wizard",
    path: "#/facilities/register",
    label: "Register Facility",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 3,
    visibleInNavigation: false,
    breadcrumb: ["Operations", "Facility Registry", "Register"],
  },
  {
    id: "queue",
    path: "#/queue",
    label: "Officer Workbench",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    requiredPermission: "facility:review",
    implementationStatus: "available",
    order: 4,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Officer Workbench"],
  },
  {
    id: "audits",
    path: "#/operations/audits",
    label: "Environmental Audits",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    requiredPermission: "audit:read",
    implementationStatus: "planned",
    order: 5,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Environmental Audits"],
  },
  {
    id: "inspections",
    path: "#/operations/inspections",
    label: "Inspections",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    requiredPermission: "facility:review",
    implementationStatus: "planned",
    order: 6,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Inspections"],
  },
  {
    id: "incidents",
    path: "#/operations/incidents",
    label: "Incidents",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    implementationStatus: "planned",
    order: 7,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Incidents"],
  },
  {
    id: "permits",
    path: "#/operations/permits",
    label: "Permits",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    implementationStatus: "planned",
    order: 8,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Permits"],
  },
  {
    id: "compliance",
    path: "#/operations/compliance",
    label: "Compliance",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    requiredPermission: "facility:review",
    implementationStatus: "planned",
    order: 9,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Compliance"],
  },
  {
    id: "enforcement",
    path: "#/operations/enforcement",
    label: "Enforcement Notices",
    group: "environmental_operations",
    accessBoundary: "authenticated",
    requiredPermission: "facility:review",
    implementationStatus: "planned",
    order: 10,
    visibleInNavigation: true,
    breadcrumb: ["Operations", "Enforcement"],
  },
  {
    id: "waste",
    path: "#/waste",
    label: "Waste Sites",
    group: "waste_management",
    accessBoundary: "authenticated",
    implementationStatus: "planned",
    order: 11,
    visibleInNavigation: true,
    breadcrumb: ["Waste Management", "Waste Sites"],
  },
  {
    id: "monitoring",
    path: "#/monitoring",
    label: "Monitoring Stations",
    group: "environmental_monitoring",
    accessBoundary: "authenticated",
    implementationStatus: "planned",
    order: 12,
    visibleInNavigation: true,
    breadcrumb: ["Environmental Monitoring", "Monitoring Stations"],
  },
  {
    id: "gis",
    path: "#/gis",
    label: "GIS Map Layers",
    group: "gis_mapping",
    accessBoundary: "authenticated",
    implementationStatus: "planned",
    order: 13,
    visibleInNavigation: true,
    breadcrumb: ["GIS & Mapping", "Map Layers"],
  },
  {
    id: "reports",
    path: "#/reports",
    label: "Roadmap Reports",
    group: "reports",
    accessBoundary: "authenticated",
    requiredPermission: "facility:review",
    implementationStatus: "planned",
    order: 14,
    visibleInNavigation: true,
    breadcrumb: ["Reports", "Roadmap Reports"],
  },
  {
    id: "subcontractor-apply",
    path: "#/marketplace/apply",
    label: "Apply for Licence",
    group: "marketplace",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 15,
    visibleInNavigation: true,
    breadcrumb: ["Marketplace", "Apply for Licence"],
  },
  {
    id: "subcontractor-status",
    path: "#/marketplace/status",
    label: "Licence Status",
    group: "marketplace",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 16,
    visibleInNavigation: true,
    breadcrumb: ["Marketplace", "Licence Status"],
  },
  {
    id: "platform",
    path: "#/platform",
    label: "Platform Console",
    group: "administration",
    accessBoundary: "platform_admin",
    implementationStatus: "available",
    order: 17,
    visibleInNavigation: true,
    breadcrumb: ["Administration", "Platform Console"],
  },
  {
    id: "settings",
    path: "#/settings",
    label: "Org Settings",
    group: "administration",
    accessBoundary: "authenticated",
    implementationStatus: "available",
    order: 18,
    visibleInNavigation: true,
    breadcrumb: ["Administration", "Org Settings"],
  },
];

export const LEGACY_TAB_ROUTES = {
  dashboard: "#/dashboard",
  registry: "#/facilities",
  facilities: "#/facilities",
  wizard: "#/facilities/register",
  queue: "#/queue",
  "subcontractor-apply": "#/marketplace/apply",
  "subcontractor-status": "#/marketplace/status",
  settings: "#/settings",
  platform: "#/platform",
  audits: "#/operations/audits",
  inspections: "#/operations/inspections",
  incidents: "#/operations/incidents",
  permits: "#/operations/permits",
  compliance: "#/operations/compliance",
  enforcement: "#/operations/enforcement",
  waste: "#/waste",
  monitoring: "#/monitoring",
  gis: "#/gis",
  reports: "#/reports",
} as const;

export function navigateLegacyTab(tabName: string) {
  const hash = LEGACY_TAB_ROUTES[tabName as keyof typeof LEGACY_TAB_ROUTES];
  if (hash) {
    window.location.hash = hash;
  }
}

// Redirect protection rules (only internal hash routes mapped in registry)
export function validateAndStoreRedirect(targetHash: string): boolean {
  // Reject absolute URLs, protocol-relative, javascript/data schemes
  if (
    targetHash.includes("://") ||
    targetHash.startsWith("//") ||
    /^\s*javascript:/i.test(targetHash) ||
    /^\s*data:/i.test(targetHash)
  ) {
    return false;
  }

  // Find in registry
  const normalized = targetHash.split("?")[0]; // ignore query parameters
  const exists = routesRegistry.some((r) => r.path === normalized);
  if (exists) {
    sessionStorage.setItem("govos.auth.returnTo", targetHash);
    return true;
  }
  return false;
}

export function consumeStoredRedirect(): string | null {
  const returnTo = sessionStorage.getItem("govos.auth.returnTo");
  if (returnTo) {
    sessionStorage.removeItem("govos.auth.returnTo");
    return returnTo;
  }
  return null;
}
