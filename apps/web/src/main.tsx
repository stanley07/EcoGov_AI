/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { OfficerWorkbench } from "./workbench/components/OfficerWorkbench.js";
import { FacilityRegistrationModal } from "./facilities/components/FacilityRegistrationModal.js";
import { LandingPage } from "./LandingPage.js";
import { PlatformAdminConsole } from "./platform-admin/PlatformAdminConsole.js";
import { FacilityRegistrationForm } from "./facilities/components/FacilityRegistrationForm.js";
import { FacilityDetailDrawer } from "./facilities/components/FacilityDetailDrawer.js";
import { ApplicationWizard } from "./marketplace/public/ApplicationWizard.js";
import { ApplicationStatusPage } from "./marketplace/public/ApplicationStatusPage.js";
import { GuidedDemoPanel } from "./GuidedDemoPanel.js";
import { InvitationAcceptancePage } from "./auth/InvitationAcceptancePage.js";
import { UsersAccessPage } from "./iam/UsersAccessPage.js";
import { AccountSecurityPage } from "./iam/AccountSecurityPage.js";
import { UserSecurityPage } from "./iam/UserSecurityPage.js";
import { OrganizationsPage } from "./iam/OrganizationsPage.js";
import { OrganizationDetailPage } from "./iam/OrganizationDetailPage.js";
import { WorkflowWorkspace } from "./workflows/WorkflowWorkspace.js";
import { EnvironmentalDashboardPage } from "./environmental/dashboard/EnvironmentalDashboardPage.js";
import { EnvironmentalAuditsPage } from "./environmental/audits/EnvironmentalAuditsPage.js";
import { InspectionsPage } from "./environmental/inspections/InspectionsPage.js";
import { IncidentsPage } from "./environmental/incidents/IncidentsPage.js";
import { PermitsPage } from "./environmental/permits/PermitsPage.js";
import { CompliancePage } from "./environmental/compliance/CompliancePage.js";
import { EnforcementNoticesPage } from "./environmental/enforcement/EnforcementNoticesPage.js";
import { WasteManagementPage } from "./environmental/waste/WasteManagementPage.js";
import { EnvironmentalMonitoringPage } from "./environmental/monitoring/EnvironmentalMonitoringPage.js";
import { EnvironmentalMapsPage } from "./environmental/maps/EnvironmentalMapsPage.js";
import { ReportsPage } from "./environmental/reports/ReportsPage.js";
import "./environmental/environmental.css";

// Layout shell component imports
import { AppShell } from "./layout/AppShell.js";
import { Sidebar, ShellNavigationGroup } from "./layout/Sidebar.js";
import { TopBar } from "./layout/TopBar.js";
import { PageContainer } from "./layout/PageContainer.js";
import { ModuleAvailabilityPanel } from "./layout/ModuleAvailabilityPanel.js";
import { navigationGroups } from "./layout/navigationConfig.js";
import { AccessDeniedPage } from "./layout/AccessDeniedPage.js";
import {
  AUTH_RETURN_TO_KEY,
  AppTab,
  consumeStoredRedirect,
  defaultHash,
  matchRoute,
  navigateHash,
  navigateLegacyTab,
  resolveRoute,
} from "./layout/routes.js";
import {
  PLATFORM_ADMIN_NAV_PERMISSION,
  SYSTEM_TENANT_ID,
  canViewPlatformAdmin,
  resolvePlatformPermissionClaims,
} from "./layout/shellAuthorization.js";

// API target endpoint base URL
const API_BASE_URL = "http://localhost:8080";

interface User {
  id: string;
  tenantId: string;
  tenantName?: string;
  organizationName?: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

interface Facility {
  id: string;
  tenantId: string;
  organizationId: string;
  ownerUserId?: string;
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  registrationStatus:
    | "draft"
    | "submitted"
    | "in_review"
    | "action_required"
    | "approved"
    | "rejected";
  riskRating: "unknown" | "low" | "medium" | "high";
  createdAt: string;
  primaryImageUrl?: string | null;
}

interface Organization {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  createdAt: string;
}

export const resolveSessionPermissions = (roles: string[]): string[] => {
  const permissions = new Set<string>();
  for (const permission of resolvePlatformPermissionClaims(roles)) {
    permissions.add(permission);
  }
  if (roles.includes("super_admin")) {
    for (const permission of [
      "workflow:definition:read",
      "workflow:definition:create",
      "workflow:definition:update",
      "workflow:definition:validate",
      "workflow:definition:publish",
      "workflow:instance:read",
      "workflow:instance:start",
      "workflow:instance:suspend",
      "workflow:instance:resume",
      "workflow:instance:cancel",
      "workflow:instance:repair",
      "workflow:work-item:read",
      "workflow:work-item:claim",
      "workflow:work-item:assign",
      "workflow:work-item:complete",
      "workflow:policy:read",
      "workflow:policy:write",
      "workflow:policy:publish",
      "workflow:audit:read",
      "workflow:operations:read",
    ])
      permissions.add(permission);
    permissions.add("org:read");
    permissions.add("org:write");
    permissions.add("user:read");
    permissions.add("user:write");
    permissions.add("user:invite");
    permissions.add("user:role:assign");
    permissions.add("user:membership:update");
    permissions.add("user:status:write");
    permissions.add("user:session:revoke");
    permissions.add("user:mfa:reset");
    permissions.add("invitation:read");
    permissions.add("invitation:create");
    permissions.add("invitation:resend");
    permissions.add("invitation:revoke");
    permissions.add("role:read");
    permissions.add("facility:read");
    permissions.add("facility:register");
    permissions.add("facility:review");
    permissions.add("complaint:review");
    permissions.add("ecogov.dashboard.read");
    permissions.add("ecogov.facilities.read");
    permissions.add("ecogov.audits.read");
    permissions.add("ecogov.inspections.read");
    permissions.add("ecogov.permits.read");
    permissions.add("ecogov.compliance.read");
    permissions.add("ecogov.enforcement.read");
    permissions.add("ecogov.waste.read");
    permissions.add("ecogov.monitoring.read");
    permissions.add("ecogov.reports.read");
  }
  if (roles.includes("director")) {
    permissions.add("org:read");
    permissions.add("facility:read");
    permissions.add("facility:write");
    permissions.add("facility:register");
    permissions.add("facility:review");
    permissions.add("audit:read");
    permissions.add("complaint:review");
    permissions.add("complaint:contact:read");
    permissions.add("workbench:queue:read");
    permissions.add("ecogov.dashboard.read");
    permissions.add("ecogov.facilities.read");
    permissions.add("ecogov.audits.read");
    permissions.add("ecogov.inspections.read");
    permissions.add("ecogov.permits.read");
    permissions.add("ecogov.compliance.read");
    permissions.add("ecogov.enforcement.read");
    permissions.add("ecogov.waste.read");
    permissions.add("ecogov.monitoring.read");
    permissions.add("ecogov.reports.read");
  }
  if (roles.includes("inspector")) {
    permissions.add("org:read");
    permissions.add("facility:read");
    permissions.add("facility:write");
    permissions.add("facility:register");
    permissions.add("facility:review");
    permissions.add("complaint:review");
    permissions.add("complaint:contact:read");
    permissions.add("workbench:queue:read");
    permissions.add("ecogov.dashboard.read");
    permissions.add("ecogov.facilities.read");
    permissions.add("ecogov.audits.read");
    permissions.add("ecogov.inspections.read");
    permissions.add("ecogov.permits.read");
    permissions.add("ecogov.compliance.read");
    permissions.add("ecogov.enforcement.read");
    permissions.add("ecogov.waste.read");
    permissions.add("ecogov.monitoring.read");
    permissions.add("ecogov.reports.read");
  }
  if (roles.includes("environmental_consultant")) {
    permissions.add("facility:read");
    permissions.add("facility:register");
    permissions.add("ecogov.dashboard.read");
    permissions.add("ecogov.facilities.read");
  }
  if (roles.includes("citizen")) {
    permissions.add("complaint:create");
    permissions.add("facility:read");
  }
  if (roles.includes("finance_officer")) {
    permissions.add("ecogov.dashboard.read");
    permissions.add("facility:read");
  }
  if (roles.includes("organization_admin")) {
    for (const permission of [
      "org:read",
      "org:write",
      "user:read",
      "user:invite",
      "user:membership:update",
      "invitation:read",
      "invitation:create",
      "role:read",
      "user:status:write",
      "user:session:revoke",
      "user:mfa:reset",
    ])
      permissions.add(permission);
  }
  return Array.from(permissions);
};

const getBreadcrumbs = (tab: string): string[] => {
  switch (tab) {
    case "dashboard":
      return ["EcoGov", "Dashboard"];
    case "registry":
      return ["EcoGov", "Facilities"];
    case "wizard":
      return ["EcoGov", "Facilities", "Register"];
    case "queue":
      return ["EcoGov", "Operations", "Review Queue"];
    case "subcontractor-apply":
      return ["EcoGov", "Marketplace", "Apply"];
    case "subcontractor-status":
      return ["EcoGov", "Marketplace", "Status"];
    case "verify-licence":
      return ["EcoGov", "Marketplace", "Verify Licence"];
    case "settings":
      return ["EcoGov", "Administration", "Settings"];
    case "users-access":
      return ["EcoGov", "Administration", "Users & Access"];
    case "organizations":
      return ["EcoGov", "Administration", "Organizations"];
    case "organization-detail":
      return ["EcoGov", "Administration", "Organizations", "Organization"];
    case "platform":
      return ["GovOS", "Platform Admin"];
    case "denied":
      return ["EcoGov", "Restricted"];
    case "audits":
      return ["EcoGov", "Operations", "Audits"];
    case "inspections":
      return ["EcoGov", "Operations", "Inspections"];
    case "incidents":
      return ["EcoGov", "Operations", "Incidents"];
    case "permits":
      return ["EcoGov", "Operations", "Permits"];
    case "compliance":
      return ["EcoGov", "Operations", "Compliance"];
    case "enforcement":
      return ["EcoGov", "Operations", "Enforcement"];
    case "waste":
      return ["EcoGov", "Waste Management"];
    case "monitoring":
      return ["EcoGov", "Environmental Monitoring"];
    case "gis":
      return ["EcoGov", "GIS & Mapping"];
    case "reports":
      return ["EcoGov", "Reports"];
    default:
      return ["EcoGov"];
  }
};

const getPageTitle = (tab: string): string => {
  switch (tab) {
    case "dashboard":
      return "System Dashboard";
    case "registry":
      return "Facility Registry";
    case "wizard":
      return "Register New Facility";
    case "queue":
      return "Officer Review Queue";
    case "subcontractor-apply":
      return "Apply for Licence";
    case "subcontractor-status":
      return "Licence Application Status";
    case "verify-licence":
      return "Verify Licence";
    case "settings":
      return "Organization Settings";
    case "users-access":
      return "Users & Access";
    case "organizations":
      return "Organizations";
    case "organization-detail":
      return "Organization Administration";
    case "platform":
      return "Platform Admin Console";
    case "denied":
      return "Access Restricted";
    case "audits":
      return "Environmental Audits";
    case "inspections":
      return "Inspections";
    case "incidents":
      return "Incidents";
    case "permits":
      return "Permits";
    case "compliance":
      return "Compliance";
    case "enforcement":
      return "Enforcement Notices";
    case "waste":
      return "Waste Management";
    case "monitoring":
      return "Environmental Monitoring";
    case "gis":
      return "GIS & Mapping";
    case "reports":
      return "Reports";
    default:
      return "EcoGov Workspace";
  }
};

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("govos_token"),
  );
  const [user, setUser] = useState<User | null>(
    localStorage.getItem("govos_user")
      ? JSON.parse(localStorage.getItem("govos_user")!)
      : null,
  );

  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const initialRoute = matchRoute(window.location.hash);
    if (initialRoute) return initialRoute.route.id;
    const savedUser = localStorage.getItem("govos_user")
      ? JSON.parse(localStorage.getItem("govos_user")!)
      : null;
    return savedUser &&
      canViewPlatformAdmin(savedUser.tenantId, savedUser.roles)
      ? "platform"
      : "dashboard";
  });
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(false);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [dbKpis, setDbKpis] = useState<{
    subcontractors: number;
    licences: number;
    revenueUsd: number;
    territories: number;
    facilities: number;
    approvedFacilities: number;
    activeReviews: number;
  } | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const registerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [pagination, setPagination] = useState<{
    total: number;
    limit: number;
    offset: number;
    hasNext: boolean;
    hasPrevious: boolean;
  }>({ total: 0, limit: 10, offset: 0, hasNext: false, hasPrevious: false });

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const limit = 10;

  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
    null,
  );

  // Auth Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState(
    () =>
      new URLSearchParams(window.location.search).get("tenant") ||
      import.meta.env.VITE_PUBLIC_TENANT_SLUG ||
      "anambra-state-ministry-of-environment",
  );
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [passwordResetToken, setPasswordResetToken] = useState<string | null>(
    null,
  );
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Registration Form State
  const [wizardSuccess, setWizardSuccess] = useState("");

  // Fetch metrics
  const [apiReadyState, setApiReadyState] = useState<any>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const authPath = passwordResetToken
        ? "/auth/password/reset-required"
        : mfaChallenge
          ? "/auth/mfa/challenge"
          : "/auth/login";
      const res = await fetch(`${API_BASE_URL}${authPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          passwordResetToken
            ? {
                resetToken: passwordResetToken,
                currentPassword: password,
                newPassword,
              }
            : mfaChallenge
              ? { challengeToken: mfaChallenge, code: mfaCode }
              : { tenantSlug, email, password },
        ),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Login credentials rejected");
      }

      const data = await res.json();
      if (data.passwordResetRequired) {
        setPasswordResetToken(data.resetToken);
        return;
      }
      if (passwordResetToken) {
        setPasswordResetToken(null);
        setPassword("");
        setNewPassword("");
        setAuthError("Password changed. Sign in with your new password.");
        return;
      }
      if (data.mfaRequired) {
        setMfaChallenge(data.challengeToken);
        setPassword("");
        return;
      }
      localStorage.setItem("govos_token", data.token);
      localStorage.setItem("govos_user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setMfaChallenge(null);
      setMfaCode("");
      const returnTo = consumeStoredRedirect();
      navigateHash(
        returnTo ||
          defaultHash(
            canViewPlatformAdmin(data.user.tenantId, data.user.roles),
          ),
      );
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("govos_token");
    localStorage.removeItem("govos_user");
    setToken(null);
    setUser(null);
    navigateHash("#/dashboard");
  };

  const userPermissions = user ? resolveSessionPermissions(user.roles) : [];
  const canAccessPlatformAdmin = Boolean(
    user &&
    user.tenantId === SYSTEM_TENANT_ID &&
    userPermissions.includes(PLATFORM_ADMIN_NAV_PERMISSION),
  );

  useEffect(() => {
    const synchronizeRoute = () => {
      if (token && user) sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
      const resolution = resolveRoute({
        hash: window.location.hash,
        authenticated: Boolean(token && user),
        permissions: userPermissions,
        canAccessPlatformAdmin,
      });
      const currentMatch = matchRoute(window.location.hash);
      if (!currentMatch || currentMatch.hash !== resolution.hash) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${resolution.hash}`,
        );
      }
      setActiveTab((current) =>
        current === resolution.tab ? current : resolution.tab,
      );
      setSelectedFacilityId((current) =>
        current === (resolution.facilityId || null)
          ? current
          : resolution.facilityId || null,
      );
    };
    synchronizeRoute();
    window.addEventListener("hashchange", synchronizeRoute);
    return () => window.removeEventListener("hashchange", synchronizeRoute);
  }, [token, user, canAccessPlatformAdmin]);

  // Fetch facilities and organizations
  const fetchData = async () => {
    if (!token) return;
    setFacilitiesLoading(true);
    setFacilitiesError(null);
    try {
      const queryParams = new URLSearchParams();
      queryParams.append("limit", limit.toString());
      queryParams.append("offset", offset.toString());
      queryParams.append("sortBy", sortBy);
      queryParams.append("sortOrder", sortOrder);
      if (filterStatus) queryParams.append("status", filterStatus);
      if (filterRisk) queryParams.append("riskRating", filterRisk);
      if (searchTerm) queryParams.append("search", searchTerm);

      const facRes = await fetch(
        `${API_BASE_URL}/facilities?${queryParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (facRes.ok) {
        const data = await facRes.json();
        setFacilities(data.items);
        setPagination(data.pagination);
      } else {
        throw new Error("The tenant facility registry could not be loaded.");
      }

      const orgRes = await fetch(`${API_BASE_URL}/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (orgRes.ok) {
        const data = await orgRes.json();
        setOrganizations(data);
      }

      const kpiRes = await fetch(`${API_BASE_URL}/facilities/kpis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (kpiRes.ok) {
        const kpiData = await kpiRes.json();
        setDbKpis(kpiData);
      }

      const readyRes = await fetch(`${API_BASE_URL}/readyz`);
      if (readyRes.ok) {
        const readyData = await readyRes.json();
        setApiReadyState(readyData);
      }
    } catch (err) {
      console.error("Failed to load backend metrics", err);
      setFacilitiesError(
        err instanceof Error
          ? err.message
          : "Environmental data could not be loaded.",
      );
    } finally {
      setFacilitiesLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token, offset, sortBy, sortOrder, filterStatus, filterRisk, searchTerm]);

  // Invitation acceptance is public and always renders outside an existing session shell.
  if (activeTab === "accept-invitation") return <InvitationAcceptancePage />;

  // Public marketplace routes intentionally render outside the authenticated shell.
  if (!token || !user) {
    if (activeTab === "subcontractor-apply") return <ApplicationWizard />;
    if (activeTab === "subcontractor-status") return <ApplicationStatusPage />;
    if (activeTab === "verify-licence")
      return (
        <ModuleAvailabilityPanel
          title="Public Licence Verification"
          reason="module_not_enabled"
          description="The public licence checker route is reserved and will be activated when the verification interface is deployed."
        />
      );
    return (
      <LandingPage
        onLogin={handleLogin}
        tenantSlug={tenantSlug}
        setTenantSlug={setTenantSlug}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authError={authError}
        mfaRequired={Boolean(mfaChallenge)}
        mfaCode={mfaCode}
        setMfaCode={setMfaCode}
        passwordResetRequired={Boolean(passwordResetToken)}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
      />
    );
  }

  const isOfficer =
    user.roles.includes("director") ||
    user.roles.includes("inspector") ||
    user.roles.includes("super_admin");

  const pageTitle = getPageTitle(activeTab);
  const breadcrumbItems = getBreadcrumbs(activeTab);

  // Grouped Navigation Tree data mapped dynamically from configuration with permission filters
  const navGroups: ShellNavigationGroup[] = navigationGroups
    .map((group) => {
      const visibleItems = group.items
        .map((item) => {
          let isVisible = true;
          if (item.platformAdminOnly) {
            isVisible = canAccessPlatformAdmin;
          } else {
            if (item.tenantOnly && user.tenantId === SYSTEM_TENANT_ID) {
              isVisible = false;
            }
            if (item.requiredPermission) {
              isVisible =
                isVisible && userPermissions.includes(item.requiredPermission);
            }
            if (item.requiredRoles) {
              isVisible =
                isVisible &&
                item.requiredRoles.some((r) => user.roles.includes(r));
            }
            if (item.excludeRoles) {
              isVisible =
                isVisible &&
                !item.excludeRoles.some((r) => user.roles.includes(r));
            }
          }

          const isActive =
            activeTab === item.id ||
            (item.targetTab === "registry" && activeTab === "wizard");

          return {
            id: item.id,
            label: item.label,
            icon: item.icon,
            isActive,
            isVisible,
            onSelect: () => navigateLegacyTab(item.targetTab),
          };
        })
        .filter((item) => item.isVisible);

      return {
        id: group.id,
        label: group.label,
        items: visibleItems,
      };
    })
    .filter((group) => group.items.length > 0);

  const sidebar = (
    <Sidebar
      groups={navGroups}
      tenantName={user.tenantName || "Anambra State Ministry of Environment"}
      userName={`${user.firstName} ${user.lastName}`}
      userRoleContext={user.roles[0]?.toUpperCase() || "USER"}
      onLogout={handleLogout}
    />
  );

  const topBar = (
    <TopBar
      pageTitle={pageTitle}
      tenantName={user.tenantName || "Anambra State Ministry of Environment"}
      userName={`${user.firstName} ${user.lastName}`}
      userRoles={user.roles}
      breadcrumbItems={breadcrumbItems}
      isMobileSidebarOpen={false} // Managed by AppShell internal state
      onOpenMobileSidebar={() => {}} // Injected by AppShell React.cloneElement
    />
  );

  return (
    <AppShell sidebar={sidebar} topBar={topBar} pageTitle={pageTitle}>
      <PageContainer>
        {/* Tab Subcontractor: Apply */}
        {activeTab === "subcontractor-apply" && <ApplicationWizard />}

        {/* Tab Subcontractor: Status */}
        {activeTab === "subcontractor-status" && <ApplicationStatusPage />}

        {activeTab === "verify-licence" && (
          <ModuleAvailabilityPanel
            title="Public Licence Verification"
            reason="module_not_enabled"
            description="The public licence checker route is reserved and will be activated when the verification interface is deployed."
          />
        )}

        {activeTab === "users-access" && (
          <UsersAccessPage token={token} currentUserId={user.id} />
        )}

        {activeTab === "organizations" && (
          <OrganizationsPage
            apiBaseUrl={API_BASE_URL}
            token={token}
            canCreate={user.roles.includes("super_admin")}
          />
        )}

        {activeTab === "organization-detail" && (
          <OrganizationDetailPage
            apiBaseUrl={API_BASE_URL}
            token={token}
            organizationId={
              matchRoute(window.location.hash)?.params.organizationId || ""
            }
            isTenantAdmin={user.roles.includes("super_admin")}
          />
        )}

        {/* Tab 0: Platform Admin Console */}
        {activeTab === "platform" && canAccessPlatformAdmin && (
          <PlatformAdminConsole token={token!} />
        )}

        {activeTab === "platform" && !canAccessPlatformAdmin && (
          <AccessDeniedPage
            onBackToDashboard={() => navigateLegacyTab("dashboard")}
          />
        )}

        {activeTab === "dashboard" && (
          <EnvironmentalDashboardPage
            facilities={facilities}
            loading={facilitiesLoading}
            error={facilitiesError}
            onRetry={fetchData}
          />
        )}

        {/* Legacy dashboard retained temporarily for composition safety; not rendered. */}
        {activeTab === "dashboard" && dbKpis && false && (
          <div>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                📊 System Dashboard
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Operational summaries and diagnostics endpoints
              </p>
            </header>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "20px",
                marginBottom: "40px",
              }}
            >
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Registered Facilities
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#38bdf8",
                  }}
                >
                  {facilities.length}
                </span>
              </div>
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Active Review Cases
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#fbbf24",
                  }}
                >
                  {
                    facilities.filter(
                      (f) =>
                        f.registrationStatus === "in_review" ||
                        f.registrationStatus === "submitted",
                    ).length
                  }
                </span>
              </div>
              <div
                style={{
                  background: "#1e293b",
                  padding: "20px",
                  borderRadius: "10px",
                  border: "1px solid #334155",
                }}
              >
                <h3 style={{ margin: 0, color: "#94a3b8" }}>
                  Approved Permits
                </h3>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: "#34d399",
                  }}
                >
                  {
                    facilities.filter(
                      (f) => f.registrationStatus === "approved",
                    ).length
                  }
                </span>
              </div>
            </section>

            {/* GovOS Commercial & Operational KPIs Section */}
            <div
              style={{
                background: "#0f172a",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #1e293b",
                marginBottom: "30px",
              }}
            >
              <h2
                style={{
                  margin: "0 0 10px",
                  color: "#38bdf8",
                  fontSize: "1.4rem",
                }}
              >
                💼 Operational & Commercial Intelligence
              </h2>
              <p
                style={{
                  color: "#94a3b8",
                  margin: "0 0 20px 0",
                  fontSize: "0.9rem",
                }}
              >
                Real-time government KPIs and revenue collections captured in
                the secure ledger.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "20px",
                }}
              >
                {/* KPI 1: Subcontractors */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Subcontractors
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#f8fafc",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis
                      ? `${dbKpis!.subcontractors} Active`
                      : sessionStorage.getItem("demo_subcontractor_id")
                        ? "1 Active"
                        : "0"}
                  </div>
                </div>

                {/* KPI 2: Licences Issued */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Licences Issued
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#10b981",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis
                      ? `${dbKpis!.licences} Issued`
                      : sessionStorage.getItem("demo_licence_code")
                        ? "1 Issued"
                        : "0"}
                  </div>
                </div>

                {/* KPI 3: Revenue Collected */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Ledger Revenue
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#fbbf24",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis
                      ? `$${dbKpis!.revenueUsd.toFixed(2)}`
                      : sessionStorage.getItem("demo_licence_code")
                        ? "$500.00"
                        : "$0.00"}
                  </div>
                </div>

                {/* KPI 4: Territory Coverage */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Territories LGA
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#818cf8",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis && dbKpis!.territories > 0
                      ? `${dbKpis!.territories} LGA(s)`
                      : sessionStorage.getItem("demo_licence_code")
                        ? "Awka South"
                        : "None"}
                  </div>
                </div>

                {/* KPI 5: Facilities Enrolled */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Facilities Acquired
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#38bdf8",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis
                      ? `${dbKpis!.facilities} Enrolled`
                      : sessionStorage.getItem("demo_facility_id")
                        ? "1 Enrolled"
                        : "0"}
                  </div>
                </div>

                {/* KPI 6: AI Audits & Decided */}
                <div
                  style={{
                    background: "#1e293b",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #334155",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    Review Actions
                  </div>
                  <div
                    style={{
                      fontSize: "1.8rem",
                      fontWeight: "bold",
                      color: "#34d399",
                      marginTop: "5px",
                    }}
                  >
                    {dbKpis
                      ? `${dbKpis!.approvedFacilities} Approved / ${dbKpis!.activeReviews} In-Review`
                      : sessionStorage.getItem("demo_officer_approved") ===
                          "true"
                        ? "1 Approved"
                        : sessionStorage.getItem("demo_facility_id")
                          ? "AI Triaged"
                          : "0"}
                  </div>
                </div>
              </div>
            </div>

            {/* Diagnostics status check */}
            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
              }}
            >
              <h2 style={{ margin: "0 0 20px", color: "#f8fafc" }}>
                Developer Platform Integrity
              </h2>
              {apiReadyState ? (
                <div style={{ display: "grid", gap: "10px" }}>
                  <p style={{ margin: 0 }}>
                    <strong>PostgreSQL Connection:</strong>{" "}
                    <span style={{ color: "#34d399", fontWeight: "bold" }}>
                      CONNECTED
                    </span>
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Schema Migrations:</strong>{" "}
                    <span style={{ color: "#34d399", fontWeight: "bold" }}>
                      CURRENT (v000002)
                    </span>
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Active Tenant Isolation:</strong>{" "}
                    <span style={{ color: "#38bdf8", fontWeight: "bold" }}>
                      ENFORCED (RLS checks active)
                    </span>
                  </p>
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>
                  Loading platform diagnostics...
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "registry" && (
          <div>
            <header
              style={{
                marginBottom: "30px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: "2rem" }}>
                  📋 Facility Registry
                </h1>
                <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                  {`${user?.tenantName || "Anambra State Ministry of Environment"} Regulated Facilities`}
                </p>
              </div>
              {user && (
                <button
                  ref={registerButtonRef}
                  onClick={() => setIsRegisterModalOpen(true)}
                  style={{
                    padding: "10px 20px",
                    background: "#0ea5e9",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.95rem",
                    transition: "background 0.2s",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "#0284c7")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "#0ea5e9")
                  }
                >
                  + Register Facility
                </button>
              )}
            </header>

            {/* Search and Filters Bar */}
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "20px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ flexGrow: 1, minWidth: "200px" }}>
                <input
                  type="text"
                  placeholder="Search by name, address, town, LGA..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setOffset(0);
                  }}
                  style={{
                    padding: "8px 12px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setOffset(0);
                  }}
                  style={{
                    padding: "8px 12px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">-- All Statuses --</option>
                  <option value="draft">DRAFT</option>
                  <option value="submitted">SUBMITTED</option>
                  <option value="in_review">IN REVIEW</option>
                  <option value="approved">APPROVED</option>
                  <option value="rejected">REJECTED</option>
                </select>
              </div>

              <div>
                <select
                  value={filterRisk}
                  onChange={(e) => {
                    setFilterRisk(e.target.value);
                    setOffset(0);
                  }}
                  style={{
                    padding: "8px 12px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">-- All Risks --</option>
                  <option value="low">LOW</option>
                  <option value="medium">MEDIUM</option>
                  <option value="high">HIGH</option>
                  <option value="unknown">UNKNOWN</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setSearchTerm("");
                  setFilterStatus("");
                  setFilterRisk("");
                  setOffset(0);
                }}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: "1px solid #475569",
                  borderRadius: "6px",
                  color: "#cbd5e1",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Clear Filters
              </button>
            </div>

            <div
              style={{
                background: "#1e293b",
                borderRadius: "12px",
                border: "1px solid #334155",
                overflow: "hidden",
              }}
            >
              <style>{`
                @media (max-width: 768px) {
                  .facility-table thead {
                    display: none !important;
                  }
                  .facility-table tbody {
                    display: block !important;
                    width: 100% !important;
                  }
                  .facility-table tr {
                    display: flex !important;
                    flex-direction: column !important;
                    background: #1e293b !important;
                    border: 1px solid #334155 !important;
                    border-radius: 12px !important;
                    padding: 16px !important;
                    margin-bottom: 16px !important;
                    gap: 12px !important;
                  }
                  .facility-table td {
                    display: block !important;
                    padding: 0 !important;
                    border: none !important;
                    width: 100% !important;
                  }
                  .facility-table td.category-cell {
                    display: none !important;
                  }
                  .facility-table td.risk-cell, 
                  .facility-table td.status-cell {
                    display: inline-block !important;
                    width: auto !important;
                    margin-right: 8px !important;
                  }
                  .facility-table td.address-cell {
                    margin-top: 4px !important;
                    font-size: 0.85rem !important;
                  }
                }
              `}</style>
              <table
                className="facility-table"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#0f172a",
                      borderBottom: "1px solid #334155",
                    }}
                  >
                    <th
                      onClick={() => {
                        const nextOrder =
                          sortBy === "businessName" && sortOrder === "desc"
                            ? "asc"
                            : "desc";
                        setSortBy("businessName");
                        setSortOrder(nextOrder);
                        setOffset(0);
                      }}
                      style={{
                        padding: "15px 20px",
                        cursor: "pointer",
                        userSelect: "none",
                        color:
                          sortBy === "businessName" ? "#38bdf8" : "#f1f5f9",
                      }}
                    >
                      Business Name{" "}
                      {sortBy === "businessName"
                        ? sortOrder === "asc"
                          ? "▲"
                          : "▼"
                        : ""}
                    </th>
                    <th
                      onClick={() => {
                        const nextOrder =
                          sortBy === "category" && sortOrder === "desc"
                            ? "asc"
                            : "desc";
                        setSortBy("category");
                        setSortOrder(nextOrder);
                        setOffset(0);
                      }}
                      style={{
                        padding: "15px 20px",
                        cursor: "pointer",
                        userSelect: "none",
                        color: sortBy === "category" ? "#38bdf8" : "#f1f5f9",
                      }}
                    >
                      Category{" "}
                      {sortBy === "category"
                        ? sortOrder === "asc"
                          ? "▲"
                          : "▼"
                        : ""}
                    </th>
                    <th
                      onClick={() => {
                        const nextOrder =
                          sortBy === "riskRating" && sortOrder === "desc"
                            ? "asc"
                            : "desc";
                        setSortBy("riskRating");
                        setSortOrder(nextOrder);
                        setOffset(0);
                      }}
                      style={{
                        padding: "15px 20px",
                        cursor: "pointer",
                        userSelect: "none",
                        color: sortBy === "riskRating" ? "#38bdf8" : "#f1f5f9",
                      }}
                    >
                      Risk Rating{" "}
                      {sortBy === "riskRating"
                        ? sortOrder === "asc"
                          ? "▲"
                          : "▼"
                        : ""}
                    </th>
                    <th
                      onClick={() => {
                        const nextOrder =
                          sortBy === "status" && sortOrder === "desc"
                            ? "asc"
                            : "desc";
                        setSortBy("status");
                        setSortOrder(nextOrder);
                        setOffset(0);
                      }}
                      style={{
                        padding: "15px 20px",
                        cursor: "pointer",
                        userSelect: "none",
                        color: sortBy === "status" ? "#38bdf8" : "#f1f5f9",
                      }}
                    >
                      Status{" "}
                      {sortBy === "status"
                        ? sortOrder === "asc"
                          ? "▲"
                          : "▼"
                        : ""}
                    </th>
                    <th style={{ padding: "15px 20px", color: "#f1f5f9" }}>
                      Address
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((fac) => (
                    <tr
                      key={fac.id}
                      onClick={() => navigateHash(`#/facilities/${fac.id}`)}
                      style={{
                        borderBottom: "1px solid #334155",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                      onMouseOver={(e) =>
                        (e.currentTarget.style.background = "#24334d")
                      }
                      onMouseOut={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td
                        className="facility-cell"
                        style={{ padding: "15px 20px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          {/* Thumbnail Image Container */}
                          <div
                            style={{
                              width: "56px",
                              height: "56px",
                              borderRadius: "8px",
                              overflow: "hidden",
                              border: "1px solid #334155",
                              background: "#0f172a",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <img
                              src={
                                fac.primaryImageUrl ||
                                "/facility_placeholder.jpg"
                              }
                              alt={`${fac.businessName} facility`}
                              loading="lazy"
                              width={56}
                              height={56}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                              onError={(e) => {
                                const target =
                                  e.currentTarget as HTMLImageElement;
                                if (
                                  target.src !== "/facility_placeholder.jpg"
                                ) {
                                  target.src = "/facility_placeholder.jpg";
                                }
                              }}
                            />
                          </div>
                          <div>
                            <div
                              style={{ fontWeight: "bold", color: "#f8fafc" }}
                            >
                              {fac.businessName}
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#94a3b8",
                                marginTop: "2px",
                              }}
                            >
                              {fac.category.replace("_", " ").toUpperCase()}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        className="category-cell"
                        style={{ padding: "15px 20px" }}
                      >
                        {fac.category.replace("_", " ").toUpperCase()}
                      </td>
                      <td
                        className="risk-cell"
                        style={{ padding: "15px 20px" }}
                      >
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: "bold",
                            background:
                              fac.riskRating === "high"
                                ? "rgba(239, 68, 68, 0.2)"
                                : fac.riskRating === "medium"
                                  ? "rgba(251, 191, 36, 0.2)"
                                  : "rgba(52, 211, 153, 0.2)",
                            color:
                              fac.riskRating === "high"
                                ? "#fca5a5"
                                : fac.riskRating === "medium"
                                  ? "#fde047"
                                  : "#a7f3d0",
                          }}
                        >
                          {fac.riskRating.toUpperCase()}
                        </span>
                      </td>
                      <td
                        className="status-cell"
                        style={{ padding: "15px 20px" }}
                      >
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: "bold",
                            background:
                              fac.registrationStatus === "approved"
                                ? "rgba(52, 211, 153, 0.2)"
                                : fac.registrationStatus === "rejected"
                                  ? "rgba(239, 68, 68, 0.2)"
                                  : "rgba(56, 189, 248, 0.2)",
                            color:
                              fac.registrationStatus === "approved"
                                ? "#a7f3d0"
                                : fac.registrationStatus === "rejected"
                                  ? "#fca5a5"
                                  : "#bae6fd",
                          }}
                        >
                          {fac.registrationStatus.toUpperCase()}
                        </span>
                      </td>
                      <td
                        className="address-cell"
                        style={{ padding: "15px 20px", color: "#94a3b8" }}
                      >
                        {fac.address}
                      </td>
                    </tr>
                  ))}
                  {facilities.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: "60px 40px",
                          textAlign: "center",
                          color: "#64748b",
                        }}
                      >
                        <div style={{ fontSize: "2rem", marginBottom: "12px" }}>
                          📂
                        </div>
                        <h4 style={{ margin: "0 0 8px", color: "#cbd5e1" }}>
                          No Regulated Facilities Found
                        </h4>
                        <p style={{ margin: "0 0 20px", fontSize: "0.85rem" }}>
                          No facilities matched your current filters or tenant
                          workspace view.
                        </p>
                        {user?.roles.includes("super_admin") ||
                        user?.roles.includes("facility:register") ||
                        user?.roles.includes("facility:write") ? (
                          <button
                            onClick={() => setIsRegisterModalOpen(true)}
                            style={{
                              padding: "8px 16px",
                              background: "#0ea5e9",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                          >
                            + Register Your First Facility
                          </button>
                        ) : (
                          <div style={{ fontSize: "0.8rem", color: "#ef4444" }}>
                            🔒 You do not have permissions to register
                            facilities. Please contact your system
                            administrator.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination Controls Footer */}
              {facilities.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 20px",
                    background: "#0f172a",
                    borderTop: "1px solid #334155",
                    fontSize: "0.85rem",
                    color: "#94a3b8",
                  }}
                >
                  <div>
                    Showing {offset + 1} to{" "}
                    {Math.min(offset + facilities.length, pagination.total)} of{" "}
                    {pagination.total} facilities
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      disabled={!pagination.hasPrevious}
                      onClick={() =>
                        setOffset((prev) => Math.max(0, prev - limit))
                      }
                      style={{
                        padding: "6px 12px",
                        background: pagination.hasPrevious
                          ? "#334155"
                          : "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "4px",
                        color: pagination.hasPrevious ? "#f8fafc" : "#64748b",
                        fontSize: "0.8rem",
                        fontWeight: "bold",
                        cursor: pagination.hasPrevious
                          ? "pointer"
                          : "not-allowed",
                      }}
                    >
                      Previous
                    </button>
                    <button
                      disabled={!pagination.hasNext}
                      onClick={() => setOffset((prev) => prev + limit)}
                      style={{
                        padding: "6px 12px",
                        background: pagination.hasNext ? "#334155" : "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "4px",
                        color: pagination.hasNext ? "#f8fafc" : "#64748b",
                        fontSize: "0.8rem",
                        fontWeight: "bold",
                        cursor: pagination.hasNext ? "pointer" : "not-allowed",
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Wizard */}
        {activeTab === "wizard" && (
          <div style={{ maxWidth: "600px" }}>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                ➕ Register New Facility
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Submit coordinates and files to launch AI Auditor Review
              </p>
            </header>

            {wizardSuccess && (
              <div
                style={{
                  padding: "15px",
                  background: "rgba(52, 211, 153, 0.15)",
                  border: "1px solid #34d399",
                  borderRadius: "6px",
                  color: "#a7f3d0",
                  marginBottom: "25px",
                }}
              >
                {wizardSuccess}
              </div>
            )}

            <FacilityRegistrationForm
              organizations={organizations}
              token={token || ""}
              isOfficer={isOfficer}
              onSuccess={(ref) => {
                setWizardSuccess(
                  `Facility successfully registered! Reference: ${ref}`,
                );
                fetchData();
                navigateLegacyTab("registry");
              }}
              onCancel={() => {
                navigateLegacyTab("dashboard");
              }}
              onViewFacility={(facilityId) => {
                navigateHash(`#/facilities/${facilityId}`);
              }}
            />
          </div>
        )}

        {/* Tab 4: Queue (Officer Review Console) */}
        {activeTab === "queue" && <OfficerWorkbench token={token} />}

        {/* Tab 5: Settings */}
        {activeTab === "settings" && (
          <div style={{ maxWidth: "700px" }}>
            <header style={{ marginBottom: "30px" }}>
              <h1 style={{ margin: 0, fontSize: "2rem" }}>
                ⚙️ Organization Settings
              </h1>
              <p style={{ color: "#94a3b8", margin: "5px 0 0" }}>
                Manage active team workspace memberships and variables
              </p>
            </header>

            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
                marginBottom: "30px",
              }}
            >
              <h3 style={{ margin: "0 0 15px", color: "#f8fafc" }}>
                Active User Information
              </h3>
              <p style={{ margin: "5px 0" }}>
                <strong>Full Name:</strong> {user.firstName} {user.lastName}
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Email Address:</strong> {user.email}
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Tenant ID:</strong> <code>{user.tenantId}</code>
              </p>
              <p style={{ margin: "5px 0" }}>
                <strong>Assigned System Roles:</strong>{" "}
                {user.roles.map((r) => (
                  <span
                    key={r}
                    style={{
                      padding: "2px 6px",
                      background: "#334155",
                      color: "#bae6fd",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      marginRight: "5px",
                      fontWeight: "bold",
                    }}
                  >
                    {r.toUpperCase()}
                  </span>
                ))}
              </p>
            </div>

            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                border: "1px solid #334155",
              }}
            >
              <h3 style={{ margin: "0 0 20px", color: "#f8fafc" }}>
                Workspace Teams
              </h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <p style={{ margin: 0 }}>
                  <strong>Government Unit:</strong>{" "}
                  {user?.organizationName ||
                    "Anambra State Ministry of Environment Headquarters"}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Department:</strong> Environmental Enforcement &
                  Department Registry
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "account-security" && (
          <AccountSecurityPage apiBaseUrl={API_BASE_URL} token={token} />
        )}
        {activeTab === "user-security" && (
          <UserSecurityPage
            apiBaseUrl={API_BASE_URL}
            token={token}
            userId={matchRoute(window.location.hash)?.params.userId || ""}
          />
        )}
        {activeTab === "workflow-definitions" && (
          <WorkflowWorkspace
            apiBaseUrl={API_BASE_URL}
            token={token || ""}
            mode="definitions"
          />
        )}
        {activeTab === "workflow-instances" && (
          <WorkflowWorkspace
            apiBaseUrl={API_BASE_URL}
            token={token || ""}
            mode="instances"
          />
        )}
        {activeTab === "workflow-tasks" && (
          <WorkflowWorkspace
            apiBaseUrl={API_BASE_URL}
            token={token || ""}
            mode="tasks"
          />
        )}
        {activeTab === "workflow-operations" && (
          <WorkflowWorkspace
            apiBaseUrl={API_BASE_URL}
            token={token || ""}
            mode="operations"
          />
        )}

        {activeTab === "audits" && <EnvironmentalAuditsPage />}
        {activeTab === "inspections" && <InspectionsPage />}
        {activeTab === "incidents" && <IncidentsPage />}
        {activeTab === "permits" && <PermitsPage />}
        {activeTab === "compliance" && (
          <CompliancePage facilities={facilities} />
        )}
        {activeTab === "enforcement" && <EnforcementNoticesPage />}
        {activeTab === "waste" && <WasteManagementPage />}
        {activeTab === "monitoring" && <EnvironmentalMonitoringPage />}
        {activeTab === "gis" && (
          <EnvironmentalMapsPage facilities={facilities} />
        )}
        {activeTab === "reports" && <ReportsPage facilities={facilities} />}

        {activeTab === ("denied" as any) && (
          <AccessDeniedPage
            onBackToDashboard={() => navigateLegacyTab("dashboard")}
          />
        )}
      </PageContainer>

      {isRegisterModalOpen && (
        <FacilityRegistrationModal
          onClose={() => setIsRegisterModalOpen(false)}
          onSuccess={() => {
            fetchData();
          }}
          organizations={organizations}
          token={token || ""}
          triggerButtonRef={registerButtonRef}
          isOfficer={isOfficer}
          onViewFacility={(facilityId) =>
            navigateHash(`#/facilities/${facilityId}`)
          }
        />
      )}
      {selectedFacilityId && (
        <FacilityDetailDrawer
          facilityId={selectedFacilityId}
          token={token || ""}
          isOfficer={isOfficer}
          onClose={() => navigateLegacyTab("registry")}
        />
      )}

      <GuidedDemoPanel
        token={token}
        onNavigateTab={navigateLegacyTab}
        onSetSelectedFacilityId={(facilityId) =>
          facilityId
            ? navigateHash(`#/facilities/${facilityId}`)
            : navigateLegacyTab("registry")
        }
        onRefreshData={fetchData}
      />
    </AppShell>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
