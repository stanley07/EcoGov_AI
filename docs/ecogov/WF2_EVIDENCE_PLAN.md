# WF-2 Evidence Plan

Status: Approved implementation deliverable with required changes incorporated

## Evidence artifact

Implementation must produce `docs/ecogov/WF2_EVIDENCE.md` containing reproducible, redacted evidence tied to the approved architecture, implementation commit, migration checksum, database identity, and review disposition.

## Required contents

1. Scope summary, explicit deferrals, baseline/tag, branch, commit, reviewer status.
2. Exact changed files classified as schema/core/API/worker/provider/UI/test/docs; prove no generated/build/secret files.
3. Current-system inventory reconciliation and final REUSE/EXTEND/ADAPT/NEW disposition.
4. Migration preflight identity, highest version, checksum set, migration 34 hash, apply output, no-op rerun, rollback rehearsal, forward reapply.
5. Exact database object/constraint/index/trigger/permission inventory and final zero-violation invariant output.
6. Focused test files/totals, full sequential totals, concurrency/restart/fencing evidence, TypeScript per workspace, production builds, UI accessibility/manual acceptance.
7. Template ownership/lifecycle/publication validation and deterministic rendering evidence.
8. Recipient selector, tenant/org isolation, preference precedence, suppression, quiet-hours/DST, emergency and fan-out evidence.
9. Delivery/request/attempt state transition matrix and forbidden-transition results.
10. Provider routing/classification/failover/rate-limit/unknown-outcome/dead-letter/replay evidence.
11. Webhook ownership/SSRF/signing/replay/rotation/callback evidence.
12. Privacy evidence: encryption/key references, redaction, masked APIs, retention/legal hold/purge, log/metric/task/audit secret and PII scans.
13. Legacy invitation and WF-1 assignment/SLA/escalation/completion equivalence mapping.
14. Rollout flags/canary results, provider activation record, rollback drill and queue disposition.
15. Known limitations and every independent-review finding mapped to final disposition.
16. Post-review proof for stuck-`sending` recovery, composite tenant FKs, replay lineage/correlation/audit, full failover policy re-evaluation, rate partition cleanup, keyset pagination, IAM cache invalidation/database fallback, binding semantic integrity, and 72/24-hour confirmation expiry.
17. Legacy invitation fallback telemetry `notification.compatibility.invitation.legacy_fallback_count` and token-bucket/sliding-window boundary-burst evidence.

## Evidence rules

- Use commands and machine-readable result summaries, not unsupported assertions.
- Never embed credentials, raw destinations, bodies, tokens, webhook URLs, signing material, provider response bodies, or unrestricted tenant identifiers.
- Counts/hashes/IDs must be redacted or use disposable fixtures.
- Failed gates remain visible with cause and approved disposition; they are not omitted from totals.
- Manual checks name actor/permission/surface and expected result without identifying real recipients.

## Traceability matrix

The evidence maps each ADR-005 decision and every section of the database, API, security, state, provider, template, recipient, retry, verification, and rollback documents to implementation files, tests, and results. Any `DEFERRED` row names its future milestone; any deviation requires an approved ADR amendment before implementation.

## Release evidence gates

No merge/tag/provider activation until focused/full tests, TypeScript, builds, invariants, scans, manual acceptance, rollback drill, and independent architecture/security/privacy review are approved. A development-mailbox-only deployment is not proof of production email/SMS/webhook readiness.
