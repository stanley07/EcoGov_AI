# WF-1 Remediation Evidence

This document records the final reproducible verification for migration 33 and the approved WF-1 remediation. Values marked `FINAL_PENDING` are replaced only after the corresponding command succeeds.

| Gate | Result |
| --- | --- |
| Database identity | `127.0.0.1:5433/govos_db` |
| Preflight highest migration | 32, checksums valid, migration 33 unused |
| Baseline sequential suite | 73 files; 383 passed; 0 failed |
| Migration 33 apply | official runner; 1 applied |
| Migration rerun | official runner; 0 applied |
| Focused remediation tests | 2 files; 27 passed; 0 failed |
| Rollback rehearsal | passed against asserted `127.0.0.1:5433/govos_db`; migration-33 objects removed transactionally and migration record removed |
| Forward reapplication | official runner reapplied exactly one migration; checksum valid |
| Final sequential suite | 74 files; 397 passed; 0 failed |
| Workspace TypeScript | configuration, domain, observability, AI, core, database, infrastructure, ecogov, API, worker and web passed; the aggregate testing workspace retains pre-existing strict diagnostics in non-WF1 fixtures, while all 397 test modules transpiled and executed successfully |
| Production build | server workspaces compiled successfully; web production build transformed 74 modules successfully |
| Database invariants | migration 33; zero invalid step statuses, non-published defaults, duplicate defaults, work-item organization mismatches, invalid escalation levels, invalid recommendation states, or disabled protected triggers |
| Secret/generated-file scans | staged-diff scan and generated-file cleanup completed before commit |
| Manual acceptance | API contracts and negative authorization paths exercised by focused and full integration tests; browser UI automation is not present for WF-1 administration surfaces |
