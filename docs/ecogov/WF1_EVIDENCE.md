# WF-1 Enterprise Workflow Engine Evidence

Date: 2026-08-04

Branch: `codex/implementation`
Architecture: ADR-004 Accepted

## Baseline and preflight

- Connected server: PostgreSQL 18.4 at `127.0.0.1:5433`, database `govos_db`.
- Highest pre-WF migration: `000030`; 30 ledger entries; zero checksum mismatches; `000031` unused.
- Working tree contained only the reviewer-authored untracked WF-1 specifications before implementation.
- Existing workflow rows: definitions 0, versions 0, instances 0, step executions 0, audit 0; unsafe/orphan workflow rows 0.
- Tenant/membership mismatch count 0; orphan organizations 0.
- Baseline suite: 370 tests, 369 passed and one genuine pre-existing timestamp-boundary failure. `ExecutionAttemptService` now clamps application completion time to database `started_at`; focused rerun passed 6/6.

## Reuse decision table

| Capability | Decision | Evidence |
| --- | --- | --- |
| Definition/version/state/transition | EXTEND | Existing relational tables evolved additively by `000031`. |
| Runtime instance/step execution | EXTEND | Existing pinned version FK retained; aggregate version/current-state added. |
| Legacy workflow services | ADAPT | Existing exports and callers remain; new engine is exported alongside compatibility functions. |
| `task_execution` lease/fencing | REUSE | Machine steps enqueue deterministic existing tasks; no parallel task table. |
| `outbox_event` | REUSE | Existing outbox remains the side-effect boundary. |
| Existing workflow audit | DEPRECATE_LATER | Retained for compatibility; WF-1 writes ordered immutable `workflow_event`. |
| Existing idempotency | ADAPT | WF-1 command-specific ledger provides tenant-scoped payload collision detection. |
| Work items, timers, SLA, escalation, recommendations | NEW | First-class tenant-composite tables introduced by `000031`. |

## Migration evidence

- Migrations: `000031_enterprise_workflow_engine.sql` plus additive `000032_wf1_legacy_compatibility.sql`, introduced when the full regression suite proved legacy writers require generated stable-key defaults and instance-definition derivation.
- Main database apply: 1 migration applied successfully.
- Official rerun: 0 migrations applied; checksum verification passed.
- Disposable rollback/forward rehearsal: initial apply/forward reapply through the final WF-1 schema; database dropped between passes.
- Rehearsal lifecycle: 2 ordered events, 3 completed idempotent commands, 1 cancelled durable timer.
- Core schema objects: evolved six existing workflow tables; new `workflow_command`, `workflow_event`, `workflow_work_item`, `workflow_work_item_history`, `workflow_timer`, `workflow_sla_clock`, `workflow_escalation_action`, and `workflow_ai_recommendation`.

## Definition, version, and runtime proof

- Draft validation enforces one start, terminal reachability, safe registered step types, unique normalized identities, graph bounds, and no unreachable state.
- Publication persists relational steps/transitions, hashes the canonical model, freezes the published version, and chooses one deterministic default.
- Instance creation resolves that default and permanently stores `version_id`; subsequent versions do not rewrite it.
- Transitions use a serializable transaction, row lock, expected aggregate version, tenant-bound pinned transition, one step completion, one successor, monotonically ordered event, timer/task updates, and command completion.
- Duplicate command keys with the same hash replay their response; a different hash returns conflict. The disposable lifecycle proved idempotent instance start.

## Human work, SLA, escalation, and AI boundary

- Work items support direct-user, role-queue, and organization-queue assignment records, versioned atomic claim, assignment history, and stale-assignee rejection on completion.
- SLA due/reminder timestamps are snapshotted in UTC; durable timers carry unique action identities, leases, and fencing tokens. Terminal transitions cancel pending timers.
- Escalation actions are bounded to levels 1-10, uniquely idempotent, and restricted to notify/reassign—never automatic approval.
- AI recommendations are tenant/instance/pinned-version bound and record instance version, provider/model/version, confidence, and non-secret explanation. State transitions mark prior active recommendations stale; no AI acceptance method bypasses the normal command engine.

## Permissions and isolation

- Exact 20-permission vocabulary from the approval decision is represented in schema, core manifest, server endpoints, and frontend navigation.
- New endpoints use exact equality joins to active tenant memberships; no wildcard, prefix, `user:write`, `platform.*`, or client-claim authorization.
- All resource queries carry tenant predicates. Organization IDs use tenant-composite FKs.
- Workflow permissions are granted only through the approved tenant role catalog; delegated organization administrators do not receive definition publication authority.

## API and frontend

- Canonical APIs cover definition list/create/detail, draft clone/model/validate/publish/deprecate; instance list/start/detail/history/transition/suspend/resume/cancel; work list/claim; and operational SLA/timer counts.
- Stable tenant-safe 400/403/404/409/422 errors, bounded limits, idempotency headers, and expected-version inputs are enforced.
- Responsive keyboard-focusable pages cover Workflow Definitions (structured safe starter editor), Workflow Instances, My Tasks/Queue, and SLA & Escalations, including loading/empty/error/success states. Published models have no arbitrary code editor.

## Compatibility and rollout

- Existing workflow functions remain exported and unchanged; legacy instances are not migrated or dual-written.
- New creation is permission/route gated. Disabling WF-1 navigation or permissions does not alter pinned running records.
- Compatibility adapter retirement remains a later owner-approved milestone after workflow-specific equivalence and drain.

## Automated verification

- Focused AI timestamp regression: 6/6 passed.
- WF-1 and permission catalog focused tests: 16/16 passed.
- Disposable database integration lifecycle and forward reapplication: passed.
- Final sequential suite: 73 files, 383 tests, all passed.
- Project TypeScript: core, API, and web passed. Root composite `tsc --build` remains affected by pre-existing testing-project rootDir/generated-declaration collisions; no WF-1 TypeScript errors remain.
- Production builds: web and API passed; web output 74 modules / 433.54 kB primary JS (106.94 kB gzip).

## Approved limitations and deferrals

- No graphical canvas or BPMN import/export.
- No parallel gateways, subworkflows, unbounded loops, business calendars, round-robin/least-workload assignment, direct AI mutation, or in-flight version migration.
- Manual browser exercise requires a seeded authenticated tenant with the new permission catalog; server-side lifecycle was exercised against the disposable database.

## Final invariants

- Highest migration: `000032` (WF-1 compatibility correction after `000031`).
- Checksums: `000031` `2c8674c3f4b5cf20be809a58aa812263b91473753aef4840149ed16aabd6578a`; `000032` `24c35ac4ce3014a1ec5ee4dbd895cbdcbb579a921642f49f78d2fd06627db525`; ledger mismatches 0.
- Cross-tenant workflow references 0; cross-organization work-item references 0.
- Orphan versions 0; instances without pinned versions 0.
- Duplicate active work items 0; duplicate timer actions 0.
- Event sequence violations 0; stale timer leases 0; platform permission mappings 0.
- Official migration rerun applied 0 migrations.
- Secret scan found no private keys, access keys, API keys, or non-empty Gemini credentials in scoped source/docs.
- Generated-file scan removed attempted composite-build artifacts; tracked build-info changes were excluded.
- Full sequential suite: 73 files / 383 tests passed.
- TypeScript: core/API/web project checks passed. Root composite build retains documented pre-existing testing/generated declaration collisions.
- Production build: API passed; web passed (74 modules, 433.54 kB primary JS, 106.94 kB gzip).
