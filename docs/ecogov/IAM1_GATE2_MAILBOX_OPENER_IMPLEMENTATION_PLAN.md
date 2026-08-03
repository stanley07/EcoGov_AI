# IAM-1 Gate 2 Owner-Local Mailbox Opener Implementation Plan

Status: **IMPLEMENTED FOR ANTIGRAVITY REVIEW**

Date: 2026-08-03

## Objective

Provide a one-purpose, development-only local CLI that validates and opens one protected tenant-administrator invitation in the owner's default browser without exposing invitation secrets or changing persistent state.

## Scope

- Add `scripts/iam/open-development-mailbox.ts`.
- Add one explicit root command, `iam:open-development-mailbox`.
- Reuse `DevelopmentMailbox.view` and `DevelopmentMailbox.open`.
- Verify the completed notification task, pending tenant-admin invitation, invited tenant-local membership, tenant ownership, email binding, role binding, and task payload-hash binding through one read-only query.
- Launch the validated loopback activation URL using the operating-system browser command with `shell: false`.
- Add focused fail-closed, state, mapping, redaction, and non-persistence tests.

## Out of scope

- HTTP routes or changes to existing mailbox API guards.
- Platform-admin bootstrap, platform role assignments, MFA, or sessions.
- Invitation acceptance or session creation.
- Mailbox enumeration, delivery-state changes, deletion, or persistence.
- Production support or a permanent bootstrap bypass.
- Broader IAM Users & Access UI.

## Execution contract

Required environment:

- `NODE_ENV=development`
- `DEV_MAILBOX_ENABLED=true`
- `GOVOS_NOTIFICATION_PROVIDER=development`
- Existing valid `DATABASE_URL` and `ENCRYPTION_KEY`

Required argument:

- `--mailbox-id <exact-item-id>`

Invocation:

```text
npm.cmd run iam:open-development-mailbox -- --mailbox-id <exact-item-id>
```

The command rejects extra arguments, missing values, path syntax, wildcard syntax, CI execution, invalid encryption-key metadata, non-received mailbox items, non-loopback activation URLs, missing or ambiguous database mappings, and any task/invitation/membership state other than `completed`/`pending`/`invited`.

## Data flow

1. Validate environment and exact identifier syntax.
2. Read safe mailbox metadata and require `received`.
3. Decrypt the single item in memory through `DevelopmentMailbox.open`.
4. Validate invitation metadata and a loopback HTTP(S) activation URL containing a token in its query or hash-route query.
5. Run one `SELECT` joining task, invitation, user, membership, and tenant-local role ownership.
6. Require exactly one mapping and the approved states.
7. Spawn the default-browser handler directly without a shell.
8. Clear local payload fields and exit after the browser process accepts the launch.

## Acceptance criteria

- No URL, invitation token, decrypted payload, hash, password, or encryption key is printed or logged.
- No database or mailbox mutation is issued.
- No existing HTTP route or guard changes.
- Exactly one explicit mailbox item can be opened per invocation.
- Focused tests and framework verification gates pass.
