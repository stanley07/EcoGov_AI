# PAY-1 Implementation Evidence

## Outcome

PAY-1 extends the existing marketplace finance and licence-issuance architecture with provider-neutral online registration payments and a Paystack adapter. Migration 000035 is applied to the reconciled development database. No real provider secret, card data, generated build output, refund automation, subscription logic, or secondary gateway was added.

## Architecture and database

- Discovery and decisions: `docs/ecogov/PAY1_PAYMENT_ARCHITECTURE.md`.
- Migration: `000035_paystack_registration_payments.sql`.
- Verified connection: `govos_db` at `127.0.0.1:5433`.
- Official runner: migration 35 applied once; immediate rerun applied 0 and validated stored checksums.
- Additive records: invoice description/due/paid fields; provider environment, initialization, idempotency, safe checkout URL, channel, verification, paid/failure metadata; idempotency/history/ledger-credit indexes.
- Transactional rollback rehearsal: passed; schema was restored by rollback.

## Payment and security controls

- Paystack initialization uses the server invoice amount and NGN minor-unit conversion.
- Secret-key authentication is server-side only; test/live key prefixes are fail-closed.
- Provider HTTP calls use HTTPS, a ten-second abort timeout, normalized results, and redacted errors.
- Webhook validation uses HMAC-SHA512 over exact request bytes and timing-safe comparison.
- Every successful webhook is independently verified with Paystack before settlement.
- Settlement locks tenant-qualified payment, invoice, and application rows and verifies reference, paid status, amount, currency, and eligible application state.
- Webhook identity and payload hash deduplicate delivery; unique ledger credit and outbox keys prevent repeat financial or licence effects.
- Sanitized event metadata is retained; secrets, access codes, and full sensitive provider payloads are not persisted.
- Applicant access uses the existing timing-safe hashed application token. Officer finance reads use the existing `marketplace.payment.verify` tenant-scoped permission.

## Compatibility and activation

- The legacy checkout route delegates to PAY-1 when Paystack is configured and retains its established local/demo behavior otherwise.
- Existing bank-transfer reconciliation and historical payment states remain valid.
- Verified Paystack settlement atomically marks payment/invoice/application state, appends finance/application history, credits the ledger, and emits the existing deduplicated licence-issuance outbox event.
- `LicenceIssuanceService` accepts verified Paystack `paid` records and retains Stripe/bank-transfer compatibility. Active profile/licence creation remains idempotent on the existing worker.

## Frontend and reporting

- Applicant status provides Paystack initialization/redirect, authoritative status polling on return, payment history, bank-transfer fallback, and printable paid receipt.
- Officer payment reconciliation now includes a tenant-scoped recent-payment finance table.
- The API provides canonical initialization, Paystack webhook, safe receipt, payment history in application status, and officer finance endpoints.

## Verification results

- PAY-1 provider/security tests: 18 passed, 0 failed.
- Legacy marketplace payment and end-to-end compatibility tests: 9 passed, 0 failed.
- PAY-1 focused total: 27 passed, 0 failed.
- Full sequential repository suite: 427 passed, 3 failed, 0 PAY-1 failures (430 total). The remaining failures are pre-existing/out-of-scope: two WF-2 notification fixture/provider-route failures and one IAM source-string contract failure in the unrelated existing web login implementation.
- Repository TypeScript build: passed.
- Production builds: `@govos/core`, `@govos/api`, and `@govos/web` passed; web output comprised 89 transformed modules.
- Database invariants: migration 35; zero duplicate credit groups; zero paid amount/currency mismatches.
- `git diff --check`: passed.
- Secret scan: passed after using only explicit placeholder/example values.
- Generated-file scan: build artifacts excluded; tracked `tsconfig.tsbuildinfo` changes restored.

## Rollout and recovery

1. Supply test-vault values for the PAY-1 environment variables and register the exact Paystack webhook URL.
2. Apply migration 000035 with the official runner and verify the no-op rerun.
3. Enable Paystack for test transactions, monitor payment events, ledger credits, outbox processing, and licence activation.
4. To roll back application behavior, remove/disable Paystack configuration; bank transfer remains available and financial history remains readable.
5. Database column rollback is permitted only after proving no online-payment records depend on PAY-1 metadata. Paid ledger and audit history must never be removed.

## Known limitations

Refunds, subscriptions, split payments, stored cards, multi-currency conversion, payouts, disputes, fraud scoring, additional gateways, and external accounting integration are deliberately deferred. A real Paystack test transaction requires operator-supplied test credentials and public callback/webhook reachability; neither secrets nor an external transaction were available during repository verification.

## Readiness

Ready for a real Paystack test transaction: **YES**, once operator-owned test keys and an externally reachable callback/webhook URL are supplied.
