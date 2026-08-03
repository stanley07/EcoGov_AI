# IAM-1 Gate 3 Rollback Strategy

## Application rollback

Revert the Gate 3 implementation commit and rebuild core, API, and web. The prior routing, login, invitation acceptance, mailbox guards, and platform administration remain structurally unchanged.

## Catalog rollback

The reconciliation transaction rolls back automatically on any precondition or parity failure. After successful deployment, do not delete permission or role rows while referenced. A reviewed rollback may remove only the six newly introduced granular permission mappings/rows and the two newly seeded roles after proving they have no memberships or audit dependencies. Never delete by role name without exact tenant predicates, never alter `platform_role_assignment`, and never restore a `subcontractor` RBAC role.

Because the approved additions grant tenant administration authority, operational rollback should normally disable the new route/API first while preserving catalog metadata and audit history. Any deployed-data deletion requires separate owner authorization and a fresh backup.

## Verification after rollback

Confirm migration 28, zero cross-tenant and duplicate-current rows, owner administrator access, invitation acceptance, mailbox guards, platform isolation, and complete sequential regression/build gates.
