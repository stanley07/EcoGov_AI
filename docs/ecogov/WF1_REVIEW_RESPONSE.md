# WF-1 Independent Review Response

| Review finding | Final disposition | Implementation and evidence |
| --- | --- | --- |
| Published-version trigger prevents rotation/deprecation | fixed | `000033_wf1_remediation.sql` installs restricted lifecycle/immutability enforcement; publish and deprecate commands lock and rotate defaults atomically |
| Transition conditions are ignored/unbounded | fixed | `validateTransitionCondition` and `evaluateTransitionCondition`; publication and runtime use the same bounded data-only evaluator |
| Step execution retains legacy status model | fixed | migration maps legacy values, installs the ten-state constraint and transition trigger; engine and compatibility path use canonical states |
| Work items are tenant-only scoped | fixed | list, detail, claim, accept, assign, reassign, complete, cancel, queue, and history require active same-organization membership |
| Timers and SLA clocks are not executed | fixed | `WorkflowRuntimeWorker` schedules bounded due work onto `task_execution`, uses 60-second leases and monotonic fences, and processes reminders/breaches |
| Escalations are incomplete/unbounded | fixed | published SLA snapshot supplies at most ten actions; idempotent action keys and active-recipient filtering fail closed |
| Legacy workflow callers bypass canonical invariants | fixed | `transitionWorkflowInstance` enters through `EnterpriseWorkflowEngine.runLegacyAdapter` and uses canonical state transitions |
| AI recommendations have no decision lifecycle | fixed | accept/reject endpoints enforce tenant, organization, active membership, expected instance version, terminal states, and normal transition execution |
| Integration tests pollute shared trigger state | fixed | WF-1 verification is sequential and migration/invariant checks assert the intended database; no WF-1 test disables global triggers |
| Assignment policy table allegedly missing | implemented under another name | validated `workflow_step_definition.assignment` snapshot |
| Calendar tables allegedly missing | deferred by ADR-004 | WF-1 uses UTC elapsed time; business calendars remain deferred |
| SLA/escalation policy tables allegedly missing | implemented under another name | validated step SLA configuration and immutable clock policy snapshot |
| Definition permission mapping allegedly missing | fixed | migration creates tenant-composite `workflow_definition_permission` for definition-level commands |

## Verification evidence

- Preflight: `127.0.0.1:5433/govos_db`; migrations 1–32 valid before remediation; only deployed execution status was `completed`.
- Baseline: 73 files and 383 tests passed sequentially before mutation.
- Migration application: official runner applied migration 33 once; immediate rerun reported `appliedCount: 0`.
- Focused verification: `wf1-contract.test.ts` and `wf1-remediation.test.ts`, 27 tests passed.
- Final full-suite, build, rollback rehearsal, SQL invariants, and scans are recorded in `WF1_REMEDIATION_EVIDENCE.md` after completion.
