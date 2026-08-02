# IAM-1 Deployed-Schema Preflight Remediation Report

Status: **BLOCKED — security ownership remediation approval required**

Date: 2026-08-02

Branch: `codex/implementation`

## Purpose

This report records the mandatory read-only deployed-schema preflight for IAM-1. The approved implementation directive requires work to stop if invalid or ambiguous legacy security data is found. No migration was drafted or applied, and no IAM implementation work began after the blocking finding.

## Database inspected

- PostgreSQL: 18.4, x86-64 Windows
- Host: `127.0.0.1`
- Port: `5433`
- Database: `govos_db`
- Migration history table: `schema_migrations`
- Highest applied migration: `27` (`marketplace_bank_transfer_claims`)

Credentials and connection secrets are intentionally omitted.

## Preflight results

| Check                                   | Result                                  | Gate decision                                                                          |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `membership.status`                     | Absent                                  | Schema gap confirmed, but no migration may be drafted until invalid data is remediated |
| `membership.version`                    | Absent                                  | Schema gap confirmed, but no migration may be drafted until invalid data is remediated |
| Cross-tenant memberships                | **14 invalid rows**                     | **Stop and escalate**                                                                  |
| Duplicate NULL-organization assignments | 0 duplicate `(user_id, role_id)` groups | No blocking duplicates detected by this check                                          |
| Composite user key readiness            | `(tenant_id, id)` unique key exists     | Ready after data remediation                                                           |
| Composite role key readiness            | `(tenant_id, id)` unique key exists     | Ready after data remediation                                                           |
| Composite organization key readiness    | `(tenant_id, id)` unique key exists     | Ready after data remediation                                                           |
| Composite department key readiness      | Missing `(tenant_id, id)` unique key    | Conditional schema gap                                                                 |
| Membership composite foreign keys       | Absent                                  | Conditional schema gap                                                                 |
| Session `(tenant_id, user_id)` index    | Absent                                  | Candidate performance/index gap                                                        |
| Next migration number                   | Repository/deployed maximum is 27       | Candidate next number is 28 only after remediation and a fresh conflict audit          |

## Blocking data finding

Fourteen membership rows have:

- a membership tenant matching the referenced user's tenant;
- no missing user or role references;
- no organization or department mismatch;
- a role tenant of `00000000-0000-0000-0000-000000000001` instead of the membership/user tenant.

Category counts:

| Category                     |  Count |
| ---------------------------- | -----: |
| Missing user                 |      0 |
| Missing role                 |      0 |
| User tenant mismatch         |      0 |
| **Role tenant mismatch**     | **14** |
| Organization tenant mismatch |      0 |
| Department tenant mismatch   |      0 |

The affected membership IDs are retained below to support owner-approved remediation without exposing email addresses or credentials:

```text
00b3fb29-3f81-499d-8acc-3dd62dfbad85
2e473171-86f0-4375-922c-636d54ced58f
5481e56a-77ad-4383-944c-4ebada33ed1f
5930928c-829d-4ef5-93ce-27405b4f0b5e
6bec81e7-1e5a-4187-9a32-fd774f1aa7a7
746fce6d-5ebe-4532-ae40-91c9a8f8561a
74e5bcaf-4bb6-4ce1-98ac-7b59f652555b
753e5a23-1710-44c7-892a-714b50cf6f9f
7e873fae-2240-4640-9582-a01ff3105cba
80450a42-65a4-4027-8daa-5b98dea19ae4
c51fcc2e-5ad5-436f-a3d4-72fb9c885726
c8e51616-2805-42c8-b909-644c9ae1b015
cdca6a24-b33c-4a80-bffa-44ef85315b43
e62aa017-7a97-45bb-b91e-3ebf2e369fe2
```

## Why automatic repair is prohibited

Changing each membership to a same-tenant role with the same name may appear straightforward, but the database does not prove that role-name equivalence represents the intended authorization grant. Deleting the memberships would remove access; retaining the foreign roles preserves a tenant-isolation violation. Either choice changes security ownership and effective privileges.

The IAM-1 directive explicitly requires stopping rather than silently modifying ambiguous ownership/security records.

## Required owner/Antigravity remediation decision

For each affected membership, approve one of these evidence-backed actions:

1. **Map to a same-tenant canonical role:** only after confirming the intended role name and effective permission set for that tenant.
2. **Revoke/remove the membership:** only after confirming the assignment is obsolete or erroneous.
3. **Preserve through an explicit exception:** not recommended; requires a documented architecture exception because composite tenant foreign keys could not then be validated.

Recommended remediation process:

1. Export an owner-review table containing membership ID, tenant, non-secret user identifier, foreign role name, candidate same-tenant role ID/name, and before/after effective permissions.
2. Obtain explicit approval for every mapping or revocation.
3. Apply remediation in a separately reviewed, transactional script or migration with before/after audit evidence.
4. Re-run the complete IAM-1 preflight and confirm zero cross-tenant rows.
5. Re-audit repository migration numbers.
6. Only then draft the minimum IAM-1 schema migration.

## Read-only commands used

The inspection used PostgreSQL catalog queries against:

- `information_schema.columns`
- `information_schema.table_constraints`
- `information_schema.key_column_usage`
- `pg_constraint`
- `pg_indexes`
- `schema_migrations`
- tenant-safe diagnostic joins across `membership`, `user_account`, `role`, `organization`, and `department`

The commands performed `SELECT` operations only. No `INSERT`, `UPDATE`, `DELETE`, DDL, migration command, or transaction changing database state was executed.

## Implementation status

- Gate 0 architecture decisions: approved by directive, subject to documented constraints.
- Gate 1 deployed-schema preflight: executed and **blocked**.
- Gates 1 migration/authorization implementation through Gate 7: **not started**.
- IAM source files changed: none.
- Migration files created: none.
- Database rows/schema changed by Codex: none.

## Unblocking criteria

IAM-1 may resume only after:

- the project owner and Antigravity approve a remediation disposition for all 14 memberships;
- remediation is applied by an authorized workflow with audit evidence;
- a repeated read-only preflight reports zero cross-tenant memberships and no other ambiguous legacy data;
- composite constraint readiness is reconfirmed; and
- the next migration number is revalidated.
