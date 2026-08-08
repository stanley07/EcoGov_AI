# PAY-1 Subcontractor Registration Payment Architecture

## Pre-implementation discovery

The current system already owns the authoritative registration and finance records. Migration 000020 introduced `subcontractor_application`, `marketplace_invoice`, `marketplace_payment`, `marketplace_payment_event`, `marketplace_revenue_ledger`, profiles, licences, and append-only application events. Migration 000027 added the bank-transfer claim workflow. The marketplace API currently creates a synthetic Stripe checkout reference; bank-transfer approval passes a signed internal event to `MarketplacePaymentReconciliationService`. Successful reconciliation updates payment, invoice, and application state, credits the ledger, and emits the deduplicated `subcontractor_application.payment_confirmed` outbox event. `LicenceIssuanceService` consumes that event and idempotently creates the active profile/licence. The applicant status page currently supports status lookup and bank-transfer evidence only; officer reporting already reads the revenue ledger.

PAY-1 therefore extends these records rather than creating a parallel finance domain. The legacy bank-transfer path remains valid. The synthetic checkout path becomes a compatibility route into the same provider-neutral online-payment service.

## Boundaries and invariants

- `marketplace_invoice` is the server-owned amount and currency authority. Clients never set a charge amount.
- `marketplace_payment` is one provider attempt, with an immutable provider reference, environment, idempotency identity, and lifecycle.
- `marketplace_payment_event` is the durable webhook receipt and deduplication boundary. Raw secrets and full provider payloads are never persisted.
- `marketplace_revenue_ledger` receives exactly one credit per settled payment.
- Payment settlement locks tenant-qualified payment, invoice, and application rows in one transaction; validates reference, amount, currency, provider status, and eligibility; then records payment/invoice/application history and the licence outbox event atomically.
- Licence activation remains on the established outbox worker. This preserves crash recovery and exactly-once licence issuance while making verified settlement the only activation trigger.
- Browser redirects and query parameters are advisory. Only Paystack server verification can settle a payment.
- Applicant operations authenticate with the existing hashed application access token and resolve the tenant from the application. Officer finance operations use tenant-scoped RBAC.

## Provider contract

`PaymentProvider` exposes `initialize`, `verify`, and `verifyWebhookSignature`. Its normalized values use provider minor units and contain only reference, status, currency, transaction identity, channel, environment, and safe redirect data. `PaystackPaymentProvider` calls the HTTPS Paystack API with the secret key server-side, uses HMAC-SHA512 over the exact request bytes, applies request timeouts, and redacts provider errors. Provider choice is configuration, not application-domain branching.

## Lifecycle

The PAY-1 online lifecycle is `pending -> processing -> paid` with `pending|processing -> failed|cancelled`. `paid`, `failed`, and `cancelled` are terminal for PAY-1. Historical legacy/refund values remain readable for backward compatibility. Duplicate initialization with the same key and request returns the existing attempt; reuse with a different request is rejected. A later retry uses a new key and provider reference.

## API and user experience

- `POST /marketplace/applications/{id}/checkout-session` remains the compatibility initialization endpoint.
- `POST /marketplace/invoices/{invoiceId}/payments/initialize` is the canonical initialization endpoint.
- `POST /marketplace/payments/webhooks/paystack` is public but signature-authenticated and rate-limit-ready.
- Status responses include safe payment history; receipts are obtained from a tenant/application-scoped read endpoint.
- The applicant page redirects to Paystack, returns to the status page, polls authoritative status, and offers a printable receipt after settlement.
- Officer finance reporting exposes tenant-scoped totals and payment rows without provider secrets or access codes.

## Environment and operations

`PAYMENT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_CALLBACK_URL`, and `PAYSTACK_ENVIRONMENT=test|live` are server configuration. Live mode rejects test keys and test mode rejects live keys. Keys are never returned by the API, logged, stored in payment metadata, or committed. Webhooks are acknowledged only after durable processing; duplicates return success without duplicate settlement. Unknown references, mismatches, and verification failures are retained as failed/ignored sanitized events for operational review.

## Migration and rollback

Migration 000035 adds only PAY-1 metadata, constraints, and indexes to existing finance tables. It is idempotent and leaves bank-transfer data valid. Application rollback disables online initialization while retaining all financial history. Database rollback drops only PAY-1 indexes/columns after confirming there are no records requiring them; paid ledger and audit records are never deleted.

## Explicit deferrals

Refund automation, subscriptions, split settlements, multi-currency conversion, card storage, payout processing, disputes, fraud scoring, additional gateways, and accounting-system integration are outside PAY-1.
