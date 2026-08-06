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
      },
      {
        id: "inspections",
        label: "Inspections",
        icon: "🔍",
        targetTab: "inspections",
        requiredPermission: "ecogov.inspections.read",
        tenantOnly: true,
      },
      {
        id: "incidents",
        label: "Incidents",
        icon: "🚨",
        targetTab: "incidents",
        requiredPermission: "complaint:review",
        tenantOnly: true,
      },
      {
        id: "permits",
        label: "Permits",
        icon: "📄",
        targetTab: "permits",
        requiredPermission: "ecogov.permits.read",
        tenantOnly: true,
      },
      {
        id: "compliance",
        label: "Compliance",
        icon: "✅",
        targetTab: "compliance",
        requiredPermission: "ecogov.compliance.read",
        tenantOnly: true,
      },
      {
        id: "enforcement",
        label: "Enforcement Notices",
        icon: "⚖️",
        targetTab: "enforcement",
        requiredPermission: "ecogov.enforcement.read",
        tenantOnly: true,
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
      },
      {
        id: "waste-collection",
        label: "Waste Collection",
        icon: "🚛",
        targetTab: "waste",
        requiredPermission: "ecogov.waste.read",
        tenantOnly: true,
      },
      {
        id: "disposal-facilities",
        label: "Disposal Facilities",
        icon: "♻️",
        targetTab: "waste",
        requiredPermission: "ecogov.waste.read",
        tenantOnly: true,
      },
    ],
  },
  {
    id: "environmental_monitoring",
    label: "Environmental Monitoring",
    items: [
      {
        id: "monitoring",
        label: "Air Quality",
        icon: "📡",
        targetTab: "monitoring",
        requiredPermission: "ecogov.monitoring.read",
        tenantOnly: true,
      },
      {
        id: "water-quality",
        label: "Water Quality",
        icon: "💧",
        targetTab: "monitoring",
        requiredPermission: "ecogov.monitoring.read",
        tenantOnly: true,
      },
      {
        id: "noise-monitoring",
        label: "Noise Monitoring",
        icon: "🔊",
        targetTab: "monitoring",
        requiredPermission: "ecogov.monitoring.read",
        tenantOnly: true,
      },
      {
        id: "laboratory-results",
        label: "Laboratory Results",
        icon: "🧪",
        targetTab: "monitoring",
        requiredPermission: "ecogov.monitoring.read",
        tenantOnly: true,
      },
    ],
  },
  {
    id: "gis_mapping",
    label: "GIS & Mapping",
    items: [
      {
        id: "gis",
        label: "Environmental Map",
        icon: "🗺️",
        targetTab: "gis",
        requiredPermission: "facility:read",
        tenantOnly: true,
      },
      {
        id: "facility-map",
        label: "Facility Map",
        icon: "📍",
        targetTab: "gis",
        requiredPermission: "facility:read",
        tenantOnly: true,
      },
      {
        id: "incident-map",
        label: "Incident Map",
        icon: "⚠️",
        targetTab: "gis",
        requiredPermission: "facility:read",
        tenantOnly: true,
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      {
        id: "reports",
        label: "Daily Reports",
        icon: "📈",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "weekly-reports",
        label: "Weekly Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "monthly-reports",
        label: "Monthly Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "quarterly-reports",
        label: "Quarterly Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "annual-reports",
        label: "Annual Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "lga-reports",
        label: "LGA Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "district-reports",
        label: "Senatorial District Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
      },
      {
        id: "ministry-reports",
        label: "Ministry Reports",
        targetTab: "reports",
        requiredPermission: "ecogov.reports.read",
        tenantOnly: true,
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
        id: "users-access",
        label: "Users & Access",
        icon: "👥",
        targetTab: "users-access",
        requiredPermission: "user:read",
        tenantOnly: true,
      },
      {
        id: "organizations",
        label: "Organizations",
        icon: "🏢",
        targetTab: "organizations",
        requiredPermission: "org:read",
        tenantOnly: true,
      },
      {
        id: "settings",
        label: "Org Settings",
        icon: "⚙️",
        targetTab: "settings",
      },
      {
        id: "workflow-definitions",
        label: "Workflow Definitions",
        targetTab: "workflow-definitions",
        requiredPermission: "workflow:definition:read",
        tenantOnly: true,
      },
      {
        id: "workflow-instances",
        label: "Workflow Instances",
        targetTab: "workflow-instances",
        requiredPermission: "workflow:instance:read",
        tenantOnly: true,
      },
      {
        id: "workflow-tasks",
        label: "My Tasks",
        targetTab: "workflow-tasks",
        requiredPermission: "workflow:work-item:read",
        tenantOnly: true,
      },
      {
        id: "workflow-operations",
        label: "SLA & Escalations",
        targetTab: "workflow-operations",
        requiredPermission: "workflow:operations:read",
        tenantOnly: true,
      },
    ],
  },
];
