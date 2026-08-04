# WF-1 Security Model

## Trust boundaries

Browser/API client, tenant API, workflow command service, PostgreSQL, worker/scheduler, notification/integration providers, and platform operations are separate boundaries. The browser may request commands but never chooses authorization, task handlers, deadlines, version routing, or direct state.

## Permissions

Granular tenant permissions: definition read/create/update/validate/publish; instance read/start/suspend/resume/cancel; work-item read/claim/assign/complete; policy read/write/publish; audit read; operations read; repair. Each workflow may require additional domain permissions per command/outcome. New endpoints prohibit `user:write`, wildcards, inferred role names, and `platform.*` mappings.

Platform operations use the separate platform assignment architecture, verified MFA/recent authentication, and cannot act as a tenant user without an explicit, audited support-assumption capability approved separately.

## Enforcement sequence

Authenticate session/service identity; validate active tenant; resolve current membership and session version; verify exact permission; resolve tenant-bound resource with composite predicates; enforce organization/domain scope; validate definition-specific permission; verify row version/idempotency/state; execute transaction; append allow/deny audit.

## Tenant and organization isolation

- No global resource lookup followed by tenant comparison.
- All queries start with authenticated `tenant_id`; IDs alone are insufficient.
- Composite FKs prevent cross-tenant definition/version/step/instance/task/policy links.
- Human queues/work items include organization scope; organization administrators can view/act only within their membership organization and cannot publish definitions or repair instances by default.
- Generic 404 prevents enumeration across tenant/organization boundaries.

## Definition safety

Only a closed step-type catalog and versioned handler registry are allowed. No arbitrary SQL, JavaScript, URLs, templates with code execution, or user-controlled task names. Conditions use a constrained, total, side-effect-free AST with depth/node/type limits and allowlisted context fields. Publication validates permissions, schemas, registered handlers, reachable terminals, deterministic transitions, retry/SLA bounds, data classifications, and configuration hash.

## Data protection

Context and events are minimized, schema-validated, classified, redacted, size-limited, and hashable. Secrets and sensitive documents use existing encrypted/reference mechanisms. No tokens, passwords, encryption material, raw document bodies, or unrestricted PII enter audit, task results, logs, metrics, or error responses.

## Abuse and integrity controls

Rate limits per tenant/actor/definition; quotas for active instances, steps, timers, retries, and fan-out; maximum graph size and execution depth; loop iteration budgets; cancellation controls; signed/versioned integration schemas; idempotency collision detection; stale lease fencing; no last-write-wins transitions.

## Audit requirements

Record definition changes/publication, starts, transitions, assignments/claims, retries, timer fires, SLA state, escalation, cancellation, repair, and denied actions. Store IDs, codes, hashes, versions, counts, reasons under a redaction policy, actor type/ID, request/correlation/command IDs, and result. Events are append-only and sequenced; access is permissioned and itself audited.

## Threat tests

Cross-tenant/org reference injection; role/permission escalation; stale/revoked sessions; guessed IDs; idempotency collision; double completion; stale lease owner; condition/config injection; oversized/deep graph; malicious output reference; timer replay; escalation amplification; audit secret leakage; platform/tenant authority confusion; worker identity spoofing.
