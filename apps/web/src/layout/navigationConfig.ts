export interface NavigationItemConfig {
  id: string;
  label: string;
  icon?: string;
  targetTab: string;
  requiredRoles?: string[];
  excludeRoles?: string[];
  requiredPermission?: string;
  tenantOnly?: boolean;
  platformAdminOnly?: boolean;
  isPlanned?: boolean;
  unavailableReason?: "module_not_implemented" | "module_not_enabled";
}

export interface NavigationGroupConfig {
  id: string;
  label: string;
  items: NavigationItemConfig[];
}

export const navigationGroups: NavigationGroupConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      {
        id: "dashboard",
        label: "System Dashboard",
        icon: "📊",
        targetTab: "dashboard",
        requiredPermission: "ecogov.dashboard.read",
        excludeRoles: [],
        tenantOnly: true,
      },
    ],
  },
  {
    id: "environmental_operations",
    label: "Environmental Operations",
    items: [
      {
        id: "registry",
        label: "Facility Registry",
        icon: "📋",
        targetTab: "registry",
        requiredPermission: "ecogov.facilities.read",
        tenantOnly: true,
      },
      {
        id: "audits",
        label: "Environmental Audits",
        icon: "📝",
        targetTab: "audits",
        requiredPermission: "ecogov.audits.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
      {
        id: "inspections",
        label: "Inspections",
        icon: "🔍",
        targetTab: "inspections",
        requiredPermission: "ecogov.inspections.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
      {
        id: "incidents",
        label: "Incidents",
        icon: "🚨",
        targetTab: "incidents",
        requiredPermission: "complaint:review",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
      {
        id: "permits",
        label: "Permits",
        icon: "📄",
        targetTab: "permits",
        requiredPermission: "ecogov.permits.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
      {
        id: "compliance",
        label: "Compliance",
        icon: "✅",
        targetTab: "compliance",
        requiredPermission: "ecogov.compliance.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
      {
        id: "enforcement",
        label: "Enforcement Notices",
        icon: "⚖️",
        targetTab: "enforcement",
        requiredPermission: "ecogov.enforcement.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
    ],
  },
  {
    id: "waste_management",
    label: "Waste Management",
    items: [
      {
        id: "waste",
        label: "Waste Sites",
        icon: "🗑️",
        targetTab: "waste",
        requiredPermission: "ecogov.waste.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
    ],
  },
  {
    id: "environmental_monitoring",
    label: "Environmental Monitoring",
    items: [
      {
        id: "monitoring",
        label: "Monitoring Stations",
        icon: "📡",
        targetTab: "monitoring",
        requiredPermission: "ecogov.monitoring.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
    ],
  },
  {
    id: "gis_mapping",
    label: "GIS & Mapping",
    items: [
      {
        id: "gis",
        label: "GIS Map Layers",
        icon: "🗺️",
        targetTab: "gis",
        requiredPermission: "facility:read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_enabled",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      {
        id: "reports",
        label: "Roadmap Reports",
        icon: "📈",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
        isPlanned: true,
        unavailableReason: "module_not_implemented",
      },
    ],
  },
  {
    id: "marketplace",
    label: "Subcontractor Marketplace",
    items: [
      {
        id: "subcontractor-apply",
        label: "Apply for Licence",
        icon: "📄",
        targetTab: "subcontractor-apply",
        requiredPermission: "facility:register",
        tenantOnly: true,
      },
      {
        id: "subcontractor-status",
        label: "Licence Status",
        icon: "🔍",
        targetTab: "subcontractor-status",
        requiredPermission: "facility:read",
        tenantOnly: true,
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        id: "platform",
        label: "Platform Console",
        icon: "🛡️",
        targetTab: "platform",
        platformAdminOnly: true,
      },
      {
        id: "settings",
        label: "Org Settings",
        icon: "⚙️",
        targetTab: "settings",
      },
    ],
  },
];
