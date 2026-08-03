# IAM-1 Gate 3 Tenant `super_admin` Permission Manifest

Status: **Approved**

Date: 2026-08-03

The exact permission names in this manifest are authoritative. The currently expected count of 22 is derived from the unique names and is not an independent authorization rule.

## Operational permissions (12)

Source: direct `super_admin` entries in `modules/govos-core/src/rbac.ts`, excluding `user:read` and `user:write`, which are classified below.

| Permission | Classification | New Gate 3 endpoint use |
| --- | --- | --- |
| `org:read` | Operational | No |
| `org:write` | Operational | No |
| `facility:read` | Operational | No |
| `facility:write` | Operational | No |
| `facility:register` | Operational | No |
| `facility:review` | Operational | No |
| `workflow:read` | Operational | No |
| `workflow:write` | Operational | No |
| `audit:read` | Operational | No |
| `complaint:review` | Operational | No |
| `complaint:contact:read` | Operational | No |
| `workbench:queue:read` | Operational | No |

## Granular IAM permissions (9)

Source: ADR-003 and `docs/ecogov/IAM1_GATE3_ROLE_CATALOG_DECISION.md`.

| Permission | Classification | New Gate 3 endpoint use |
| --- | --- | --- |
| `user:read` | Granular IAM | Yes, for tenant-user reads |
| `user:invite` | Granular IAM | Yes, as an additional invite capability where the contract requires it |
| `user:role:assign` | Granular IAM | Yes, for tenant role changes |
| `user:membership:update` | Granular IAM | Yes, for membership status changes |
| `invitation:read` | Granular IAM | Yes, for invitation reads |
| `invitation:create` | Granular IAM | Yes, for invitation creation |
| `invitation:resend` | Granular IAM | Yes, for invitation resend |
| `invitation:revoke` | Granular IAM | Yes, for invitation revocation |
| `role:read` | Granular IAM | Yes, for the assignable tenant-role catalog |

New Gate 3 endpoints must enforce the exact permission associated with the operation. They may not substitute a role-name check or authorize solely through `user:write`.

## Compatibility permission (1)

| Permission | Source | Classification | New Gate 3 endpoint use |
| --- | --- | --- | --- |
| `user:write` | Existing runtime RBAC and deployed tenant catalog | Compatibility | No; legacy callers only through explicit compatibility handling |

`user:write` remains mapped temporarily to tenant `super_admin`. Its mapping does not imply wildcard, prefix, or automatic expansion to granular permissions. Removing it after legacy callers migrate is a P2 backlog item.

## Derived-count and safety rules

- The 12 operational names, 9 granular names, and `user:write` are distinct; their expected union is 22.
- No name may begin with `platform.*` or `PLATFORM_*`.
- Reconciliation must preserve all approved operational authority.
- An unexpected deployed mapping must be reported before mutation and must not be silently removed.
- `subcontractor` is not a permission or persisted tenant RBAC role; the business label maps to `environmental_consultant` when an RBAC role is required.
