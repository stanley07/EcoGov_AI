# IAM-1 Gate 2 Owner-Local Mailbox Opener Security Evidence

Status: **IMPLEMENTED AND VERIFIED FOR ANTIGRAVITY REVIEW**

Date: 2026-08-03

## Security properties

- Local CLI only; no HTTP endpoint was added.
- Exact development gates are fail closed.
- CI is rejected.
- One exact mailbox ID is mandatory; wildcard, path-like, missing, and extra arguments are rejected.
- Safe metadata is checked before decryption.
- Decryption uses the existing protected mailbox implementation and occurs only in memory.
- Activation targets are restricted to HTTP(S) loopback hosts and must carry an invitation token.
- Database integrity is verified with a single read-only join across the exact task, tenant, invitation, identity, membership, and role.
- Required states are task `completed`, mailbox `received`, invitation `pending`, and membership `invited`.
- Browser launch uses argument-array process spawning with `shell: false`; the CLI never prints the URL.
- The database interface exposes only `query`; the mailbox interface exposes only `view` and `open`.
- No delivery marker, mailbox file, invitation, membership, task, user, role, MFA, or session is written.
- The temporary in-memory payload fields are cleared in `finally` after use or failure.
- CLI failures emit one generic secret-free message.

## Existing controls preserved

- `apps/api/src/routes/platform-admin.ts` is unchanged.
- Development mailbox HTTP access still requires development mode, mailbox enablement, authentication, verified MFA, and `platform.audit.read`.
- Tenant administrators receive no platform role or platform permission.
- `DevelopmentMailbox` encryption and protected file format are unchanged.
- No permanent bootstrap bypass or production code path was introduced.

## Focused verification

Command:

```text
node run_with_env.js npx.cmd vitest run packages/testing/src/iam-gate2-mailbox-opener.test.ts --fileParallelism=false
```

Result: **PASS — 1 file, 16 tests**.

Covered controls include exact arguments, wildcard refusal, exact environment gates, CI refusal, received-state enforcement before decryption, unique mapping, task/invitation/membership state enforcement, loopback URL enforcement, no output from the opener core, and read-only interfaces.

Standalone TypeScript command:

```text
npx.cmd tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck scripts/iam/open-development-mailbox.ts
```

Result: **PASS** after selecting the repository-compatible CLI entry-point check.

The package command was exercised without development flags and failed closed with only `Development mailbox opener failed.`; no database query, mailbox open, or browser launch occurred.

## Regression verification

Full sequential suite:

```text
node run_with_env.js npx.cmd vitest run --fileParallelism=false
```

Result: **PASS — 66 files, 321 tests, duration 187.83 seconds**.

Web TypeScript:

```text
npx.cmd tsc --noEmit --project apps/web/tsconfig.json
```

Result: **PASS (exit code 0)**.

Production web build:

```text
npm.cmd run build --workspace=@govos/web
```

Result: **PASS (exit code 0)**; Vite transformed 66 modules and completed in 3.56 seconds.

## Known limitations

- The operating system necessarily receives the activation URL to launch the browser. The CLI avoids shell evaluation, stdout/stderr, logs, clipboard, and files, but cannot control operating-system process inspection or browser history.
- JavaScript does not guarantee physical memory zeroization. The implementation overwrites payload string fields and releases references in `finally` as a best-effort reduction.
- This capability intentionally does not solve the separately identified platform-admin bootstrap/MFA lifecycle defects.
