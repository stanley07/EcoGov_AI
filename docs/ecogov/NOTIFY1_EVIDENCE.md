# NOTIFY-1 Evidence

Status: implementation and verification complete; pending independent review

Date: 2026-08-02

## Summary

The worker now supports an explicit development provider that stores a protected mailbox document after worker-side decryption. The default/production execution path is unchanged. The mailbox API is development-only and protected by existing platform MFA and `platform.audit.read` authorization.

## Files in the NOTIFY-1 change set

- `.gitignore`
- `apps/api/src/app.ts` (development-disabled 404 gate only)
- `apps/api/src/routes/platform-admin.ts`
- `apps/worker/src/executors/sendInvitationExecutor.ts`
- `apps/worker/src/executors/sendInvitationExecutor.test.ts`
- `packages/infrastructure/src/development-mailbox.ts`
- `packages/infrastructure/src/index.ts`
- `packages/testing/src/notify1-dev-mailbox-api.test.ts`
- `docs/ecogov/NOTIFY1_IMPLEMENTATION_PLAN.md`
- `docs/ecogov/NOTIFY1_EVIDENCE.md`

## Security evidence

- Provider activation requires exact value `GOVOS_NOTIFICATION_PROVIDER=development`.
- API activation requires both `NODE_ENV=development` and `DEV_MAILBOX_ENABLED=true`; production and disabled checks return 404.
- API access additionally requires an authenticated platform user, verified MFA, and `platform.audit.read`.
- Original outbox encryption is unchanged. Decryption occurs in `SendInvitationExecutor`; protected invitation content is immediately re-encrypted with AES-256-GCM for mailbox persistence.
- Plaintext token and activation URL were absent from mailbox JSON, stdout, stderr, and test logs.
- List and view operations omit the encrypted envelope. Open decrypts in memory only.
- Default mailbox path is ignored by Git.

Redacted mailbox example:

```json
{
  "notificationId": "task-<redacted>",
  "tenantId": "<redacted>",
  "notificationType": "tenant-invitation",
  "recipientEmail": "o***@example.test",
  "subject": "Your GovOS invitation is ready",
  "deliveryStatus": "received",
  "protectedPayload": "<AES-256-GCM envelope omitted>"
}
```

## Verification results

- Focused NOTIFY-1 tests: 2 files, 10 tests passed.
- Combined notification/bootstrap tests: 3 files, 13 tests passed before the final production-only provider safeguard was added; the final NOTIFY-1 focused result above is authoritative for this milestone.
- A legacy platform-admin invitation fixture initially failed because of an uncommitted IAM query-shape change; compatibility was restored and its focused rerun passed 1/1. This was not a NOTIFY-1 defect and is excluded from the NOTIFY-1 commit.
- Full sequential regression: `node run_with_env.js npx.cmd vitest run --fileParallelism=false` passed 146/146 suites and 305/305 tests in 229.4 seconds.
- TypeScript: infrastructure, database, API, AI, worker, and web verification/build compilation passed. `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` exited 0.
- Builds: database, infrastructure, API, AI, worker, and `npm.cmd run build --workspace=@govos/web` exited 0.
- Database invariants after the full suite: migration 28; cross-tenant memberships 0; duplicate current assignments 0; canonical permission parity 19/19; platform mappings 0; foreign mappings 0.
- Canonical bootstrap state remains users 0, memberships 0, invitations 0, sessions 0. NOTIFY-1 did not invent owner identity data or run the separate Gate 2 bootstrap mutation.

## Post-merge constructor regression

After merge commit `b6c61fba14069ba3a372788214a245dd9a139e55`, focused tests reported `TypeError: DevelopmentMailbox is not a constructor`.

Investigation established:

- `main` and `codex/implementation` contained identical NOTIFY-1 source files; the merge introduced no source conflict.
- `DevelopmentMailbox` remained a named class export, its consumers remained named imports, and `packages/infrastructure/src/index.ts` retained `export * from "./development-mailbox.js"`.
- No default/named export mismatch, circular dependency, or unresolved merge marker was present.
- Tests and application packages resolve `@govos/infrastructure` through `packages/infrastructure/dist/index.js`.
- The ignored `dist` tree could remain stale while the merge retained a tracked incremental `packages/infrastructure/tsconfig.tsbuildinfo` from the first parent that predated `development-mailbox.ts`. In that state the source barrel was correct but the runtime barrel did not expose a constructible class.

Resolution:

- `vitest.config.ts` now aliases the exact `@govos/infrastructure` workspace package to `packages/infrastructure/src/index.ts`, so tests execute the reviewed source barrel rather than ambient ignored build output.
- `packages/infrastructure/package.json` now runs `tsc --build --force`, ensuring explicit infrastructure builds refresh the runtime barrel even when stale incremental metadata survives a branch merge.
- No IAM, invitation, encryption, mailbox authorization, or production notification behavior changed.

Regression verification:

- Focused NOTIFY-1 suite: 2 files, 10/10 tests passed.
- Full sequential suite: 146/146 suites and 305/305 tests passed in 238.1 seconds.
- Infrastructure, API, AI, worker, and web production builds passed. The existing ignored AI output first required its known clean regeneration after a `TS5055` stale-declaration collision; no AI source was changed.

Regression-fix files:

- `vitest.config.ts`
- `packages/infrastructure/package.json`
- `docs/ecogov/NOTIFY1_EVIDENCE.md`

## Known limitations

- Filesystem mode bits are best-effort on Windows; host ACLs remain authoritative.
- This milestone intentionally provides no SMTP or external delivery provider.
- Actual owner bootstrap depends on the configured terminal variables being visible to the bootstrap process; no identity metadata or token is recorded here.
- Process-local variables configured in the owner's separate interactive terminal are not inherited by Codex command subprocesses. End-to-end owner delivery remains a Gate 2 operational verification after this adapter is reviewed and available in that process.

Commit: the commit containing this evidence; exact hash is recorded in the final handoff.

Working tree: the NOTIFY-1 index contains only the ten files listed above. Separate unfinished IAM Gate 2 source and generated TypeScript metadata remain unstaged and are excluded from the NOTIFY-1 commit.
