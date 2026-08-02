# EcoGov AI v2 EMIS Permission Matrix

This document defines the RBAC mapping of all primary EMIS modules, navigation tabs, and operations to concrete permission constants.

---

## 1. Role Reconciliation Mapping

* **Director** (`director`): Real GovOS role with full operational oversight.
* **Inspector** (`inspector`): Real GovOS role focused on field checks, audits, and reports.
* **General Environmental Officer**: *Not currently defined* in the platform. Equivalent operational functions for registrations are currently handled by `director` and `inspector` roles.
* **Finance Officer** (`finance_officer`): Real GovOS role focused strictly on payment and billing audits. Restricted from technical environmental modules.
* **Subcontractor** (`environmental_consultant`): Real GovOS role representing external environmental professionals.
* **Public** (`citizen`): Standard user role for citizens filing reports or viewing public maps.

---

## 2. Permission Matrix

All module authorization and UI rendering must be gated using **permissions** (via `hasPermission(user, permissionString)`) rather than direct role name checks.

| Module | Read permission | Create permission | Review/Manage permission | Director | Inspector | Finance Officer | Consultant | Citizen |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Dashboard** | `ecogov.dashboard.read` | — | — | Yes | Yes | Revenue only | Limited | No |
| **Facilities** | `ecogov.facilities.read` | `ecogov.facilities.create` | `ecogov.facilities.manage` | Yes | Yes | No | Assigned scope | No |
| **Audits** | `ecogov.audits.read` | `ecogov.audits.create` | `ecogov.audits.review` | Yes | Yes | No | Limited | No |
| **Inspections**| `ecogov.inspections.read`| `ecogov.inspections.create`| `ecogov.inspections.review`| Yes | Yes | No | No | No |
| **Incidents** | `complaint:review` | `complaint:create` | `complaint:review` | Yes | Yes | No | No | Yes (create only) |
| **Permits** | `ecogov.permits.read` | `ecogov.permits.create` | `ecogov.permits.manage` | Yes | Limited | Limited | Payment only | Public verify only |
| **Compliance** | `ecogov.compliance.read`| N/A | `ecogov.compliance.manage`| Yes | Yes | No | No | No |
| **Enforcement**| `ecogov.enforcement.read`| N/A | `ecogov.enforcement.manage`| Yes | Yes | No | No | No |
| **Waste** | `ecogov.waste.read` | N/A | N/A | Yes | Yes | Yes | No | No |
| **Monitoring** | `ecogov.monitoring.read`| N/A | N/A | Yes | Yes | Yes | No | Yes (public only) |
| **GIS / Map** | `facility:read` | N/A | N/A | Yes | Yes | Yes | Yes | Yes (public layer only) |
| **Reports** | `ecogov.reports.read` | `ecogov.reports.generate`| N/A | Yes | Yes | No | No | No |

---

## 3. Permission Implementation Status

### Existing and Active
* `facility:read`: Used to query facilities. Reused in Dashboard, Facilities, and GIS.
* `facility:register`: Used by applicants/consultants to submit registration forms.
* `facility:review`: Used by inspectors and directors to approve submissions.
* `complaint:review`: Used to triage submitted incidents.

### Proposed for EMIS-1B (Navigation Shell Gates)
* `ecogov.dashboard.read`: Gating access to the executive EMIS dashboard view.
* `ecogov.facilities.read`: Core environmental facility catalog reading.

### Future Permissions (Not Implemented in EMIS-1)
* `ecogov.audits.read`, `ecogov.audits.create`, `ecogov.audits.review`
* `ecogov.inspections.read`, `ecogov.inspections.create`, `ecogov.inspections.review`
* `ecogov.permits.read`, `ecogov.permits.create`, `ecogov.permits.manage`
* `ecogov.compliance.read`, `ecogov.compliance.manage`
* `ecogov.enforcement.read`, `ecogov.enforcement.manage`
* `ecogov.waste.read`, `ecogov.monitoring.read`
* `ecogov.reports.read`, `ecogov.reports.generate`

### Public Projection Permissions
* `ecogov.public.facilities.read`: Allows unauthenticated public users to read non-sensitive facility coordinates on the GIS map.
* `complaint:create`: Public incident filing permission.

---

## 4. Enforcement & Session Recalculation Mechanics

### Session Recalculation from Code
GovOS session permission claims are resolved dynamically in memory at user login/token generation using the mappings defined in code under `modules/govos-core/src/rbac.ts` (`ROLE_PERMISSIONS` and `ROLE_INHERITANCE`). 
* **Repository Evidence**:
  - [rbac.ts](file:///c:/Users/USER/Desktop/EcoGov_AI/modules/govos-core/src/rbac.ts#L65-L135) contains the hardcoded mapping of role constants to their permission sets.
  - Adding or modifying permission mappings only requires modifying `rbac.ts` code; no SQL schema database migrations are required to register new permissions.
