# IAM-1R Post-Remediation Report

Status: **PASS — ready for Antigravity review**

## Outcome

The approved 14 legacy memberships remain mapped to tenant-local canonical `super_admin` roles with full approved permission parity. The Antigravity-authorized leaked test membership was verified by exact identity, tenant, user email, cross-tenant role ownership, and exclusion from the approved 14, then deleted transactionally as the only affected row.

The two authorized facility fixtures now resolve roles by both name and tenant, seed only same-tenant roles, assert tenant equality after membership insertion, and remove membership/role residue. Repeated focused runs and the complete sequential regression suite leave the global cross-tenant count at zero.

## Final controls

- Cross-tenant count before original remediation: 14
- Cross-tenant count immediately after original remediation: 0
- Cross-tenant count before authorized leaked-row cleanup: 1
- Authorized leaked membership deleted: `11bf98c3-4d95-4ae6-b88a-ade7c9aac245` only
- Cross-tenant count after cleanup: 0
- Cross-tenant count after each focused suite/repeated run: 0
- Cross-tenant count after full suite: 0
- Approved local mappings: 14/14
- Approved permission parity: 14/14
- Remediation audit records: 14
- Final dry run: no-op with zero proposed mutations

## Verification summary

- Individual thumbnail suite: 4/4 tests passed
- Individual registry suite: 12/12 tests passed
- Repeated combined fixture suites: 16/16 passed on every run
- Focused IAM plus fixtures: 26/26 passed
- Full sequential Vitest: 62 files and 290/290 tests passed in 148.71s
- Web TypeScript: exit 0
- Production web build: exit 0
- PostgreSQL invariant verifier: exit 0
- IAM-1R dry run: exit 0, `noOp=true`

## Repository scan conclusion

No tenant-unsafe test lookup matching `SELECT id FROM role WHERE name = $1` remains. No equivalent template/default role reuse was found in other membership fixtures. The commercial-launch fixture creates a unique role with the same tenant as its membership and was intentionally left unchanged. No production source was modified.

## Scope confirmation

- Migration 000028: not created or applied
- Production role/membership services: unchanged
- IAM-1 APIs and UI: not started
- Quick Access: unchanged
- Approved 14 mappings: not altered during fixture cleanup
- Merge/tag: not performed
- Commit: commit containing this report; exact hash and clean working-tree status are recorded in the final handoff
