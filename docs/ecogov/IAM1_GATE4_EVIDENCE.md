# IAM-1 Gate 4 Evidence

Status: Verified for independent review

## Summary

ADR-002 tenant-context login and the complete tenant account-security vertical slice are implemented. Tenant administration remains separate from platform authority; APIs use exact granular permissions and tenant predicates.

## Database evidence

- Preflight database: `govos_db`, PostgreSQL port 5433.
- Preflight highest migration: 28; checksum mismatches: 0.
- Preflight cross-tenant memberships: 0; duplicate current memberships: 0.
- Preflight tenant super-admin manifest: 25/25; platform/foreign mappings: 0.
- Legacy plaintext MFA columns: absent; structured fields present.
- Backup: completed outside repository before apply; contents and credentials are not recorded here.
- Official migration runner: migration 000029 applied once; immediate rerun applied 0 migrations.

## Verification

- Focused Gate 4: 2 files, 13 tests passed.
- Final full sequential suite: 71 files, 361 tests passed in 160.75 seconds.
- TypeScript: configuration, database, domain, infrastructure, observability, core, API, worker, and web all passed.
- Production builds: database, API, and web passed; Vite transformed 71 modules.
- `git diff --check`: passed. Secret and generated-file scans: passed after build-info restoration.

## Final invariants

- Highest migration: 29; official runner checksum validation passed and rerun was a no-op.
- Cross-tenant memberships: 0; duplicate current memberships: 0.
- Tenant super-admin manifest: 25/25; platform/foreign permission mappings: 0.
- Owner account: active; MFA state: unenrolled; active sessions: 1.
- Commit hash and final clean working-tree status are recorded in the delivery commit.

## Known limitations

- Session device labels use stored user-agent text; no external device intelligence is introduced.
- IP data is stored only as PostgreSQL `inet` and is not returned by current APIs.
- Recovery codes are displayed once by application state; users must explicitly acknowledge them.
