# WF-1 Evidence Plan

Status: Template for future implementation evidence

## Required evidence sections

1. Approved architecture: ADR status/revision, reviewers, resolved findings, scope and exclusions.
2. Current-state/preflight: target DB metadata without credentials, migration/checksum state, table/count/integrity/graph/task inventory.
3. Files and schema: exact committed files, migration checksum, objects/constraints/indexes/backfills, before/after counts.
4. Definition/version proof: canonical model/hash, validation cases, immutability, active/default behavior, pinned in-flight instance.
5. Runtime proof: command idempotency/collision, CAS race, event sequence, state matrix, cancellation/suspension/recovery.
6. Task proof: enqueue atomicity, lease fencing/heartbeat, duplicate delivery, retry/backoff, dead letter, repair, restart recovery.
7. Security proof: permission matrix, tenant/org/platform isolation, denied actions, session checks, condition/config abuse, secret/redaction scan.
8. SLA/escalation proof: calendar/DST vectors, pause/resume, downtime catch-up, one action per level, recipient failure, metrics.
9. Compatibility: legacy equivalence, unchanged payment/licence/outbox behavior, pilot/shadow comparison and feature flags.
10. Verification: exact commands, exit codes, test totals/durations, TypeScript/build results, query plans/load/accessibility/responsive evidence.
11. Rollout/rollback: backup readability, apply/no-op, activation flags, rollback rehearsal, residual risks and operator runbook.
12. Delivery: commit hash, branch/push, staged files, clean working tree, no merge/tag/deploy until approval.

## Evidence handling

Use IDs, aggregate counts, hashes, redacted examples, and screenshots without personal data. Never include credentials, connection strings, raw tokens, encrypted/decrypted payloads, document bodies, passwords, MFA material, or unrestricted event context. Store bulky machine output as approved artifacts with hashes; summarize it in `docs/ecogov/WF1_EVIDENCE.md`.

## Minimum focused suites

`wf1-definition-versioning`, `wf1-runtime-state-machine`, `wf1-command-idempotency`, `wf1-human-work`, `wf1-task-leasing`, `wf1-sla-calendar`, `wf1-escalation`, `wf1-tenant-isolation`, `wf1-security-audit`, `wf1-legacy-compatibility`, and `wf1-frontend-operations`.
