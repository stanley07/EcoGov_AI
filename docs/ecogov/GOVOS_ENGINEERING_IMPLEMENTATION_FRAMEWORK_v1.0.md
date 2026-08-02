# GOVOS Engineering Implementation Framework v1.0

## Purpose

# Mandatory Notice

This document is authoritative.

All AI agents working on GovOS—including Codex, Antigravity, ChatGPT, and
future contributors—must read and comply with this framework before making
changes to the repository.

No milestone may be declared complete unless all mandatory requirements in
this framework have been satisfied.

This document defines the mandatory implementation, verification,
review, and release workflow for all future GovOS and EcoGov AI
milestones.

**Applies to:** - Codex (Implementation Agent) - Antigravity
(Architecture Review Agent) - Project Owner - Future contributors

No milestone is considered complete unless every phase in this document
has been satisfied.

------------------------------------------------------------------------

# Engineering Principles

## 1. Architecture First

Architecture is authoritative. No implementation may violate the
approved GovOS architecture.

## 2. Backward Compatibility

Existing functionality must continue to work unless an approved
milestone explicitly replaces it.

## 3. Security by Default

Every implementation must preserve: - Tenant isolation - Authorization -
Audit trails - Idempotency - Asynchronous processing - Immutable
financial records

## 4. Production Readiness

Every feature should be production-grade. Temporary hacks are
prohibited.

------------------------------------------------------------------------

# Milestone Lifecycle

``` text
Planning
    ↓
Implementation
    ↓
Focused Testing
    ↓
Architecture Review
    ↓
Corrections
    ↓
Regression Testing
    ↓
Approval
    ↓
Merge
    ↓
Tag
    ↓
Release
```

------------------------------------------------------------------------

# Phase 1 --- Planning

Deliverable:

`ImplementationPlan.md`

Every plan must include: - Objectives - Scope - Out-of-scope items -
Architectural impact - Database changes - API changes - UI changes -
Workflow changes - Testing strategy - Acceptance criteria

No implementation begins until the plan is approved.

------------------------------------------------------------------------

# Phase 2 --- Codex Implementation

Responsibilities: - Implement only the approved scope - Preserve
backward compatibility - Add milestone-specific tests - Update
documentation - Produce implementation evidence - Commit and push only
to `codex/implementation`

Codex must **not**: - Redesign architecture without approval - Merge
into `main` - Ignore review findings

------------------------------------------------------------------------

# Phase 3 --- Milestone Testing

Each milestone requires dedicated tests, for example: -
routing.test.ts - payment-flow.test.ts - invoice.test.ts -
licence.test.ts

Every new feature must have focused automated tests.

------------------------------------------------------------------------

# Phase 4 --- Verification Gates

Run:

``` bash
node run_with_env.js npx.cmd vitest run --fileParallelism=false
npx.cmd tsc --noEmit --project apps/web/tsconfig.json
npm.cmd run build --workspace=@govos/web
```

Where applicable, also verify: - Database migrations - Rollback -
Restart recovery

------------------------------------------------------------------------

# Phase 5 --- Evidence

Produce:

`docs/ecogov/<MILESTONE>_EVIDENCE.md`

Include: - Summary - Files changed - Test results - TypeScript result -
Build result - Known limitations - Commit hash

------------------------------------------------------------------------

# Phase 6 --- Antigravity Review

Review: - Architecture - Security - Performance - Accessibility -
Backward compatibility - Testing - Documentation - Workflow
correctness - Authorization - Database safety - Financial integrity -
Tenant isolation

Return: - P0 (Release blocker) - P1 (Must fix before merge) - P2
(Backlog improvement)

Antigravity must **not** implement features or expand milestone scope.

------------------------------------------------------------------------

# Phase 7 --- Corrections

Codex fixes: - P0 - P1

P2 items are recorded in `BACKLOG.md`.

------------------------------------------------------------------------

# Phase 8 --- Final Verification

Re-run: - Vitest - TypeScript - Production build

Working tree must be clean.

------------------------------------------------------------------------

# Phase 9 --- Final Approval

Antigravity issues either:

-   **APPROVED**
-   **REJECTED**

No merge without approval.

------------------------------------------------------------------------

# Phase 10 --- Merge

Merge into:

`main`

Push:

`origin/main`

------------------------------------------------------------------------

# Phase 11 --- Tag

Examples: - emis-1b1-complete - emis-1b2-complete -
commercial-launch-complete

------------------------------------------------------------------------

# Branch Strategy

    main
      ├── codex/implementation
      └── antigravity/architecture-review

------------------------------------------------------------------------

# Definition of Done

A milestone is complete only when all of the following are true:

-   Approved implementation
-   Focused tests completed
-   Regression suite passed
-   TypeScript passed
-   Production build passed
-   Evidence produced
-   Antigravity approval received
-   Merged into `main`
-   Tagged

------------------------------------------------------------------------

# Commercial Priority Rule

When a milestone directly affects: - Revenue generation - Customer
onboarding - Licensing - Payments - Regulatory operations

it takes priority over cosmetic improvements or roadmap items that do
not block commercial launch, provided architecture and security
principles remain intact.

------------------------------------------------------------------------

# Milestone Template

``` text
Milestone:
Objective:
Owner:
Reviewer:
Status:
Scope:
Out of Scope:
Acceptance Criteria:
Required Tests:
Evidence:
Merge Criteria:
Release Tag:
```

------------------------------------------------------------------------

# Immediate Roadmap

  Priority   Milestone                                        Status
  ---------- ------------------------------------------------ ----------
  ✅         EMIS-1A                                          Complete
  ✅         EMIS-1B.1                                        Complete
  1          CL-1 -- Commercial Launch Readiness              Next
  2          EMIS-1B.2 -- Hash Routing & Redirection Guards   Planned
  3          EMIS-1B.3 -- Executive Dashboard                 Planned
  4          EMIS-1C -- Workflow Enhancements                 Planned
  5          EMIS-2 -- Operational Modules                    Planned
