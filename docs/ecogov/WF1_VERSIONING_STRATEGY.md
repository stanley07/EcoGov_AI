# WF-1 Versioning Strategy

## Definition versions

Use immutable monotonically increasing revision plus semantic label (`major.minor.patch`). Major: outcome/step/data compatibility break; minor: backward-compatible path/policy addition; patch: metadata/config correction with unchanged external contract. The database revision is authoritative; semantic labels aid review.

Drafts are mutable with optimistic concurrency. Publication canonicalizes the complete model (steps, transitions, schemas, handlers, permissions, assignment/SLA/escalation/retry policies), computes SHA-256, stores the validation report/hash, and freezes all referenced policy versions. Any change produces a new draft.

## Runtime pinning

New instances resolve the published default inside the start transaction and persist `version_id` and hash. In-flight instances never auto-upgrade. Deprecation blocks new starts but does not stop pinned instances. Withdrawal is exceptional and may only block starts; active instances require an explicit owner-approved suspend/cancel/migration plan.

## Handler and schema versions

Task handlers register `name:version`; published steps pin both. Input/output/event schemas have independent versions and compatibility tests. Workers must support every version referenced by nonterminal instances. Removing a handler is blocked until reference count is zero or an approved migration/adapter exists.

## Instance migration

Not part of initial WF-1 activation. Future migration requires a declarative mapping, preflight of every current step/context, dry run, signed owner approval, per-instance idempotency, append-only migration event, old/new hashes, and rollback before any new-version side effect. Financial/licensing instances require domain-specific approval and cannot be bulk migrated generically.

## API/event compatibility

API major version remains `/v1`; additive fields only within v1. Event envelope includes `eventType`, `schemaVersion`, tenant/aggregate IDs, event ID, occurredAt, correlation/causation IDs. Consumers ignore unknown additive fields but reject unsupported schema versions to dead letter. Contract tests cover N and N-1 where supported.

## Deployment order

Expand schema -> deploy readers/handlers compatible with old and new -> publish definitions -> enable starts -> drain old versions -> remove compatibility only in a later reviewed contraction migration.
