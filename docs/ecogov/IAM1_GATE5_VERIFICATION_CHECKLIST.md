# IAM-1 Gate 5 Verification Checklist

- [x] Read governing framework, IAM plan, ADR-002, ADR-003, and Gate 4 identity decision.
- [x] Preflight migration 29 and checksum parity.
- [x] Preflight cross-tenant, cross-organization, duplicate membership/invitation, and platform mapping counts.
- [x] Apply migration 000030 through official runner; verify rerun no-op.
- [x] Reconcile delegated role manifest twice; verify second run no-op.
- [x] Focused organization, membership, delegation, invitation, security, audit, and frontend tests pass.
- [x] Full sequential regression passes: 72/72 files, 370/370 tests.
- [x] TypeScript and affected production builds pass.
- [x] Secret/generated-file scans and `git diff --check` pass.
- [x] Final deployed invariants remain clean.
