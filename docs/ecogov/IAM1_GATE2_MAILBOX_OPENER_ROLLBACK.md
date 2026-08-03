# IAM-1 Gate 2 Owner-Local Mailbox Opener Rollback Strategy

Date: 2026-08-03

The capability is additive and stateless. Rollback requires only:

1. Remove `scripts/iam/open-development-mailbox.ts`.
2. Remove `packages/testing/src/iam-gate2-mailbox-opener.test.ts`.
3. Remove the `iam:open-development-mailbox` package script.
4. Remove the associated plan, security evidence, and rollback documents if the milestone is rejected rather than superseded.
5. Re-run the focused NOTIFY-1 tests, full sequential suite, TypeScript verification, and production build.

No database rollback, mailbox rewrite, invitation revocation, key rotation, role change, or session invalidation is required because the CLI creates no schema or persistent application state. If the owner already launched an invitation before rollback, the invitation remains governed by the existing single-use acceptance flow; rollback must not delete or rewrite it.

Rollback must not modify the existing development mailbox API, its MFA/platform-permission guards, or `DevelopmentMailbox` encryption behavior.
