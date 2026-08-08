# PAY-2 Critical Remediation Evidence

## Scope

This remediation addresses only C-01 and C-02 from `PAY2_PRODUCTION_VERIFICATION.md`. No Paystack credentials were configured, no provider transaction was attempted, no historical migration was changed, and no migration 000036 was required.

## C-01 — Public demo and legacy webhook paths could create settlement without Paystack evidence

Root cause:

- the marketplace prefix is public by design for applicant-token flows;
- the demo completion endpoint had no environment gate or authentication;
- missing Paystack configuration silently selected synthetic Stripe checkout;
- the legacy webhook used a predictable fallback secret and accepted an arbitrary provider path;
- legacy reconciliation looked up payment by reference without binding the stored provider.

Remediation:

- synthetic checkout is available only when `APP_ENV` is `local` or `test` **and** `PAYMENTS_DEMO_ENABLED=true`; otherwise missing Paystack configuration fails with 503;
- demo completion additionally requires a configured `PAYMENTS_DEMO_TOKEN` and a timing-safe `x-demo-payment-token` match, and returns 404 when disabled;
- the default legacy webhook secret was removed; an explicit `WEBHOOK_SECRET` is required;
- legacy webhook providers are allowlisted to `stripe` and `bank_transfer`; Paystack cannot be routed through the legacy reconciler;
- legacy reconciliation now binds checkout and transaction lookups to the stored provider.

Violated invariant restored: no payment, invoice, ledger, outbox, or licence mutation may occur through a demo/legacy path that lacks explicit environment authorization, secret authentication, and provider binding.

## C-02 — Duplicate handling permanently suppressed retry after transient webhook failure

Root cause:

The first signed Paystack event was inserted before server verification. If verification or settlement failed transiently, a provider retry conflicted on the event key and was acknowledged as a successful duplicate without retrying the failed work.

Remediation:

- new signed Paystack events enter `processing`;
- an existing `received` or `failed` event with the identical event ID and payload hash is atomically reclaimed and its bounded attempt counter incremented;
- only `processed` and intentionally `ignored` events receive terminal deduplication success;
- concurrent `processing`, payload mismatch, or exhausted attempts return a non-success error so the provider retries;
- verification and settlement failures are durably marked `failed` with a bounded redacted code;
- the existing payment row lock, settlement transaction, ledger uniqueness, and outbox deduplication remain unchanged.

Violated invariant restored: a transient failure cannot be converted into a false successful acknowledgement, while a completed event remains harmless under replay.

## Files changed for PAY-2R

- `modules/govos-core/src/marketplace/PaystackRegistrationPaymentService.ts`
- `modules/govos-core/src/marketplace/PaymentReconciliationService.ts`
- `apps/api/src/routes/marketplace.ts`
- `.env.example`
- `packages/testing/src/pay2-critical-remediation.test.ts`
- compatibility test environment setup in `subcontractor-payment.test.ts` and `subcontractor-marketplace-e2e.test.ts`
- `scripts/pay1-invariants.mjs`
- this evidence document

## Migration

No migration 000036 was created. Migration 000035 already supplies webhook processing status and attempt fields plus the required financial uniqueness constraints. The official runner connected to `127.0.0.1:5433/govos_db`, validated stored checksums, reported migration 35 as the head, and applied zero migrations on the no-op run.

## Regression tests

PAY-2R regression coverage proves:

- invalid Paystack signatures fail before persistence or provider verification;
- production rejects demo completion even if a demo flag/token is mistakenly supplied;
- Paystack cannot enter the generic legacy webhook route;
- legacy reconciliation is bound to the stored provider;
- a failed Paystack event is reclaimed and server verification runs again;
- only processed terminal events are acknowledged as duplicates;
- an in-progress duplicate is not falsely acknowledged as settlement success.

Results:

- PAY-2R Critical regression tests: 6 passed, 0 failed.
- PAY-1 adapter/security tests: 18 passed, 0 failed.
- Legacy payment compatibility tests: 8 passed, 0 failed.
- Marketplace end-to-end compatibility test: 1 passed, 0 failed.
- Total affected payment verification: 33 passed, 0 failed.

## Financial invariants

Read-only verification after test cleanup reported:

- duplicate ledger-credit groups: 0;
- paid amount mismatches: 0;
- paid currency mismatches: 0;
- Paystack paid records without `verified_at`: 0;
- duplicate provider-reference settlements: 0;
- cross-tenant payment/invoice relationship violations: 0;
- activated registrations with a Paystack attempt but without a verified paid Paystack record: 0.

## TypeScript and builds

- Repository TypeScript project build: passed.
- `@govos/core` production build: passed.
- `@govos/api` production build: passed.
- Web and worker were not changed by PAY-2R and were not rebuilt for this bounded remediation.
- `git diff --check`: passed.

## Remaining findings

PAY-2 High, Medium, and Low findings were intentionally not remediated. They include terminal-invoice/application transition enforcement, paid-only and safely rendered receipts, lost-webhook reconciliation beyond bounded provider retry, broader Paystack database/API integration coverage, layering, canonical invoice binding, centralized configuration validation, rate limiting, callback continuity, dashboard totals, and evidence wording.

PAY-2R does not grant approval. The remaining findings must be assessed by the independent test-payment reviewer. In particular, terminal invoice eligibility, receipt restrictions, and recovery reconciliation remain material risks that may still block externally exposed test payments.

## Re-review readiness

Both PAY-2 Critical findings have bounded code fixes and focused executable regression evidence. The branch is ready for independent test-payment re-review; it is not approved for test or live transactions by this document.
