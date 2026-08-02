# GovOS Subcontractor Commercial-Launch Evidence

Date: 2026-08-02  
Branch: `codex/implementation`  
Implementation commit: current commit containing this document (see `git log -1`)  
Final gate: **PASS**

## Delivered flow

- Applicant status now exposes a server-priced NGN invoice with invoice number, amount, annual licence period, bank/account details, payment reference, and payment status.
- Bank Transfer proof submission captures transaction reference, payment date, payer name, expected amount/currency, and receipt metadata through the existing secure document adapter. The invoice amount is never accepted as authoritative input.
- Claims have request-hash idempotency and unique transaction-reference protection.
- Tenant-scoped users with the exact `marketplace.payment.verify` permission can list pending claims and confirm or reject them. Rejection requires a reason.
- Confirmed claims enter `MarketplacePaymentReconciliationService`, which atomically credits the append-only ledger and publishes the deduplicated `subcontractor_application.payment_confirmed` outbox event.
- Licence issuance remains asynchronous; the browser and confirmation route do not issue a licence.
- The simulated provider path remains available and is explicitly labelled **Test Mode**.

## Files changed

- `apps/api/src/routes/marketplace.ts`
- `apps/web/src/marketplace/analytics/MarketplaceDashboard.tsx`
- `apps/web/src/marketplace/payments/PaymentVerificationPanel.tsx`
- `apps/web/src/marketplace/public/ApplicationStatusPage.tsx`
- `modules/govos-core/src/marketplace/marketplace-policies.ts`
- `modules/govos-core/src/marketplace/screening-handler.ts`
- `packages/database/migrations/000027_marketplace_bank_transfer_claims.sql`
- `packages/testing/src/subcontractor-commercial-launch.test.ts`
- `packages/testing/src/subcontractor-marketplace-e2e.test.ts`
- `packages/testing/src/subcontractor-payment.test.ts`
- `docs/ecogov/COMMERCIAL_LAUNCH_EVIDENCE.md`

## Verification

| Gate | Exact command | Exit | Result |
|---|---|---:|---|
| Database migration | `node run_with_env.js npm.cmd run db:migrate` | 0 | Migration 27 applied and verified |
| Focused payment tests | `node run_with_env.js npx.cmd vitest run packages/testing/src/subcontractor-commercial-launch.test.ts packages/testing/src/subcontractor-payment.test.ts --fileParallelism=false` | 0 | 2 files, 16 tests passed, 28.62s |
| Corrected marketplace E2E | `node run_with_env.js npx.cmd vitest run packages/testing/src/subcontractor-marketplace-e2e.test.ts --fileParallelism=false` | 0 | 1 file, 1 test passed, 6.89s |
| Authoritative sequential suite | `node run_with_env.js npx.cmd vitest run --fileParallelism=false` | 0 | 59 files, 262 tests passed, 173.34s |
| Web TypeScript | `npx.cmd tsc --noEmit --project apps/web/tsconfig.json` | 0 | Passed with no diagnostics |
| Production web build | `npm.cmd run build --workspace=@govos/web` | 0 | 65 modules transformed; built in 5.12s |

The first non-escalated Vite attempt was blocked before config load by the desktop filesystem sandbox. The identical required command passed with workspace read access; this was an execution-environment restriction, not a source/build failure.

## Security and accounting assertions

- Applicant cannot alter invoice amount: passed.
- Duplicate transaction reference rejected: passed.
- Idempotent replay returns the original claim: passed.
- Wrong amount rejected: passed.
- Wrong currency rejected: passed.
- User without verification permission receives 403: passed.
- Cross-tenant confirmation is not discoverable and receives 404: passed.
- Confirmation publishes exactly one payment-confirmed event: passed.
- Licence does not exist after synchronous confirmation: passed.
- Rejected claim does not credit the ledger: passed.
- Mandatory rejection reason is stored in the application audit event: passed.
- Existing reconciliation, append-only ledger, asynchronous issuance, QR verification, and simulated provider tests remain green.

## PostgreSQL

- PostgreSQL 18.4
- Host/port: `127.0.0.1:5433`
- Database: `govos_db`
- Migration `000027_marketplace_bank_transfer_claims.sql` applied successfully and migration verification completed.

## Deployment configuration and known limitations

- The migration provides pilot bank fields and the UI reads them from each immutable invoice. Production deployment must replace the seeded pilot bank name, account name, and account number with the approved treasury account before accepting live transfers.
- Receipt handling reuses the repository's current secure document adapter and metadata/scan contract. The adapter is mocked in this repository; production object-storage credentials and retention policy remain deployment responsibilities.
- Simulated provider transactions are retained only for guided demonstrations and are labelled **Test Mode**.

## Working-tree status

The commercial-launch files are committed as a scoped change. A pre-existing unrelated untracked document, `docs/ecogov/GOVOS_ENGINEERING_IMPLEMENTATION_FRAMEWORK_v1.0.md`, was intentionally not modified or committed. Therefore repository status is clean for tracked files but not globally empty until the owner disposition of that unrelated file is known.
