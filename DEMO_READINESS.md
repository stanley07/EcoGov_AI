# GovOS EcoGov Portal — E2E Guided Presentation Guide

This document defines the exact setup, user logins, data sets, three-act presentation flow, and system verification results for today's live defense.

---

## 1. Demo Credentials & Roles

| Presenter Stage | Role | Email | Password | Primary Interface / URL |
| :--- | :--- | :--- | :--- | :--- |
| **Subcontractor** | Operator | `owner@carwash.com` | `password123` | Landing Page login / `#subcontractor-apply` |
| **Regulatory Officer** | Director / Inspector | `director@govos.ai` | `password123` | System Dashboard / `#queue` |

* **Quick Login Shortcuts**: Use the **Owner** button on the landing page for Subcontractor presentation tabs, and **Director** or **Inspector** buttons for officer review panels.

---

## 2. Three-Act Presentation Sequence

### Act 1 — Create the Regulated Operator
Start as the Subcontractor. Apply, upload credentials, show document integrity checks, switch to Director, approve the application, execute a simulated Stripe payment, retrieve the issued digital license, and assign the Awka South territory.

* **Act 1 Narrative**:
  > *“GovOS doesn't just digitize an existing government process. It creates a digital operating ecosystem around it. Qualified private operators can enter the environmental system, be screened, licensed, assigned responsibility, and held accountable.”*

### Act 2 — Put the Operator to Work
Switch back to the Subcontractor and open the **Register Facility** wizard. Click the `⚡ Autofill Mock Data` button at the top right of the wizard to populate all steps automatically, inspect the business details, location GIS coordinates, and contacts, and then submit. Switch to the **Facility Registry** tab and show that the facility has immediately become part of the government's authoritative operational records.

* **Act 2 Narrative**:
  > *“This is where our system becomes tangible. The licensed subcontractor is now officially submitting facility profiles within their delegated territory, creating a verifiable operational trail in the state's registry.”*

### Act 3 — Show Intelligent Government Oversight
Open the registered facility, show the automated AI risk assessment and recommendation, and then switch to the Director to make the human decision. End on the analytics dashboard showing the resulting commercial and operational KPIs.

* **Act 3 Narrative**:
  > *“In one transaction chain, we onboarded an operator, governed their eligibility, collected platform revenue, licensed them, assigned geographic responsibility, acquired a new regulated facility, subjected that facility to AI-assisted review, retained the government officer as the final authority, and converted every action into auditable government intelligence.”*

---

## 3. Step-by-Step Walkthrough via Guided Panel (11 Steps)

Use the floating **🧭 Guided Demo Journey** panel at the bottom right corner of the screen.

1. **Subcontractor Application:** Click **⚡ Auto-Submit Application**. Submit draft credentials and upload corporate registration files.
2. **Document Scanner Integrity:** Click **🔍 Run File Integrity Scan** to run background checks.
3. **Officer Approval:** Make sure you are logged in as **Director**. Click **👔 Approve as Officer**.
4. **Invoice & Payment:** Click **💳 Pay Application Fee ($500)**. Displays simulated payment webhook reconciliation.
   > *“This is a simulated payment-provider transaction processed through the same webhook reconciliation architecture intended for production payment integration.”*
5. **Licence Generation:** Click **📜 Retrieve Licence Code** to fetch the active verifiable licence token.
6. **Territory LGA Assignment:** Click **🗺️ Assign Anambra LGAs** to delegate Awka South region.
7. **Wizard Facility Registration:** Click **➕ Open actual OE-1B wizard** to inspect the multi-step registration form. Use **⚡ Autofill Mock Data** at the top right, verify details, and click **Submit**. Or use **⚡ Auto-Register Facility (Bypass)**.
8. **Facility Registry & Drawer:** Click **👁️ Open Registry Detail** to switch to the registry tab and slide open the coordinate preview and contact redaction drawer.
9. **AI-assisted Review:** Click **🤖 Inspect AI Recommendations** to inspect geographical risk checks.
10. **Officer Action:** Click **⚖️ Officer Approve Facility** to log the official approval.
11. **Compliance Analytics:** Click **📊 View Analytics Dashboard** to view the commercial ending.

---

## 4. Technical Evidence Panel
The Guided Demo panel exposes a **Live Transaction Evidence** audit trail. Presenters can open it during questions to show:
* Subcontractor Application ID
* Document Scanner Verification Status
* Stripe Webhook Reconciled Ledger Flags
* Verifiable License Numbers
* Assigned LGA IDs
* Registered Facility Case IDs
* AI risk ratings and Officer approval states

---

## 5. Build & Test Verification Results
* **Frontend Web Application**: Built successfully using Vite (`dist/index.html` created) with 0 errors.
* **Database Cleanup & Teardown**: Updated to delete referencing foreign keys recursively.
* **Test Suite**: `12/12` Facility Registry tests and `9/9` Marketplace/Payment tests pass successfully.
