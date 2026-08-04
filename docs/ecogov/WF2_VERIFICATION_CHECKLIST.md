# WF-2 Verification Checklist

Status: Required implementation/review gate

## Preflight and migration

- [ ] Confirm branch/approved commit and clean baseline.
- [ ] Assert PostgreSQL host `127.0.0.1`, port `5433`, database `govos_db` before mutation.
- [ ] Verify highest migration 33 and all checksums; migration 34 unused.
- [ ] Inventory deployed notification/task/outbox/provider status values, readers, writers, constraints, indexes, and duplicate candidates.
- [ ] Run complete sequential baseline with restored triggers/settings in `finally`/`afterEach`.
- [ ] Apply migration 34 through official runner; verify checksum and exact objects.
- [ ] Rerun official runner and prove zero applied.
- [ ] Rehearse rollback on disposable database; forward reapply; prove earlier migrations unchanged.

## Data model and lifecycle

- [ ] Exact tables, columns, state constraints, composite FKs, unique identities, indexes, and retention metadata match the model.
- [ ] Published templates/renderings and status history reject update/delete.
- [ ] Only approved template/request/delivery/attempt/inbox transitions succeed.
- [ ] Atomic default binding rotation; no draft/deprecated default; no multiple defaults.
- [ ] Ordered request history has no gaps/duplicates under concurrency.
- [ ] Terminal delivery/request states cannot reopen; replay creates linked new request.

## Templates

- [ ] Platform/application/tenant ownership and binding resolution are isolated.
- [ ] Publication validator enforces schema, bounds, locales, renderings, classification, sender, sanitizer, and fixture hash.
- [ ] Reject unknown helpers/paths/fields, prototype traversal, executable constructs, remote includes, unsafe URLs/HTML/header injection, oversized/deep payloads, heterogeneous/invalid variables.
- [ ] Runtime uses the same approved parser/renderer as publication and reproduces the pinned hash.

## Recipients, preferences, and privacy

- [ ] Direct user/destination, role, organization, work item, and escalation selectors pass positive and negative tests.
- [ ] Cross-tenant/org, inactive tenant/org/user/membership, guessed IDs, ambiguous/empty queues fail closed.
- [ ] Fan-out limits and deterministic dedupe hold under concurrent resolution.
- [ ] Exact precedence tests cover mandatory, tenant policy, opt-out, quiet hours/DST, emergency override, and non-bypassable suppression.
- [ ] Destinations/content encrypted; only masks/digests/IDs appear in APIs, logs, metrics, task results, audit, and errors.
- [ ] Retention, legal hold, purge, and cryptographic erasure behaviors pass.

## Workers, retry, and providers

- [ ] Bounded tenant-fair batches, 60-second leases, 20-second heartbeat, fencing, timeout, graceful stop, and no overlapping loop.
- [ ] Stale owner cannot heartbeat/complete/fail; expired lease recovery and restart catch-up pass.
- [ ] Exact classification and transition tests for transient/permanent/suppressed/rate-limited/unknown/dead-lettered.
- [ ] Backoff/jitter/Retry-After/max-attempt/max-age bounds pass with deterministic clock.
- [ ] Pre-acceptance failover succeeds; permanent and ambiguous post-send outcomes never unsafe-failover.
- [ ] Provider idempotency, callback races, delayed bounce/delivery, health routing, empty/misconfigured route fail-closed.
- [ ] Local/provider rate limits atomic; no cross-tenant starvation or high-cardinality metric labels.

## Webhooks

- [ ] HTTPS, URL normalization, ownership challenge, redirect policy, DNS re-resolution, and private/link-local/loopback/metadata/IPv6 SSRF blocks.
- [ ] Canonical body, timestamp, nonce, key ID, constant-time signature verification, skew and replay windows.
- [ ] Rotation overlap and old-key expiry; secret never returned/logged.
- [ ] 2xx success only; bounded body/timeout/retry; callback ID/nonce dedupe.

## IAM, APIs, and UI

- [ ] Exact tenant/platform permission vocabulary seeded; mappings separately approved; no wildcard, role inference, `user:write`, `workflow:write`, or platform/tenant confusion.
- [ ] Session version, active membership, tenant/org resource predicates, expected version, idempotency, and deny audit enforced.
- [ ] Administrative reads are redacted/paginated; replay/cancel/rotation are reasoned, idempotent, and MFA/recent-auth protected where required.
- [ ] Inbox user ownership and read/unread/archive concurrency pass.
- [ ] UI keyboard, label, focus, contrast, status-not-color, responsive, reduced-motion, and screen-reader tests pass.
- [ ] Manual acceptance covers inbox, preferences, template flow, endpoint verification, operations/dead-letter preview, and denied scopes.

## Compatibility and WF-1

- [ ] Legacy invitation create/resend/revoke/expiry, duplicate, concurrency, retry, failure, restart, and development mailbox equivalence.
- [ ] Existing task type/payload secrecy remains valid during compatibility period.
- [ ] WF-1 assignment, SLA reminder, breach/escalation, completion, cancellation, duplicate event, and recipient-empty tests.
- [ ] Notification failure does not roll back workflow command/event ordering or change pinned workflow version.
- [ ] Unknown outbox event types preserve existing behavior.

## Final verification

- [ ] Focused WF-2 suites pass.
- [ ] Full destructive integration tests run sequentially or in isolated schemas/databases; triggers/settings restored.
- [ ] Root and every workspace TypeScript check passes.
- [ ] Every production build passes.
- [ ] Final invariant SQL returns zero violations.
- [ ] Dependency/security, secret, PII-log, generated-file, build-artifact, migration-integrity, and license scans pass.
- [ ] Evidence contains exact commands/totals/checksums/commit; working tree clean.
- [ ] Independent review resolves every P0/P1 before approval; no merge/tag/deploy/provider activation beforehand.

## Required invariant SQL outcomes

Zero: cross-tenant/org notification references; active bindings to non-published versions; multiple defaults; mutable published content; deliveries without pinned template/route; recipient/destination tenant mismatch; duplicate request/task/delivery/callback identities; history sequence violations; stale leases beyond recovery threshold; delivered rows without successful/accepted evidence; dead letters without terminal history; raw secret/destination columns; platform permissions mapped to tenant roles; WF-1 source references with tenant/org mismatch.
