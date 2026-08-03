# IAM-1 Gate 3 Implementation Plan

Status: Implemented for independent review

## Objective

Deliver tenant-scoped Users & Access management as one vertical slice: approved role-catalog reconciliation, granular tenant authorization, user and invitation lifecycle APIs, and an authenticated responsive frontend.

## Scope

- Guarded serializable reconciliation of the ADR-003 role and permission catalog.
- Tenant user/role/invitation list and detail APIs.
- Idempotent encrypted-outbox invitation creation, safe resend, and revoke.
- Optimistically concurrent role and account-status changes with target-session revocation.
- `#/users-access` navigation and Users/Invitations interface.
- Removal of production Quick Access credentials.

## Out of scope

- Migration 000029 or other schema changes.
- Persisted `subcontractor` role; it remains an alias for `environmental_consultant`.
- Platform role administration or `platform_role_assignment` mutation.
- General MFA-reset endpoint/UI, custom roles, bulk operations, SSO, or Gate 4.

## Architecture

The database-resolved tenant permission mapping is authoritative for every API endpoint. Frontend claims control visibility only. New APIs require exact granular permissions and never fall back to `user:write`. All reads and writes use actor-tenant predicates. Invitation tokens are hashed at rest and delivered only inside the existing encrypted notification task payload.

No schema migration was required because membership lifecycle/version, invitation lifecycle, idempotency, encrypted task execution, and audit structures already exist. Organization-admin assignment remains deferred; all Gate 3 assignable roles are tenant-wide.

## Acceptance and testing

Acceptance requires 25/25 super-admin parity, two approved roles only, no membership/catalog boundary violations, no Quick Access bundle source, focused catalog/API/frontend tests, full sequential regression, all affected TypeScript/build gates, and clean final invariants.
