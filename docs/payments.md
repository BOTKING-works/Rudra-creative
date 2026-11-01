# Payments: Razorpay and Cashfree

## Current implementation

The API includes separate Razorpay and Cashfree adapters in `backend/src/services/payments.ts` and verified return/webhook handlers in `backend/src/modules/payments/routes.ts`. Checkout is server-priced and fails closed until the selected provider is configured. A successful browser redirect is not considered payment proof.

Implemented at the code level:

- Backend-created Razorpay Orders API order, using INR integer paise, with client-side Checkout using only the public key ID.
- Backend-created Cashfree payment order/session, with the Cashfree JS SDK receiving only its short-lived `payment_session_id`.
- Razorpay callback HMAC verification followed by a backend fetch of the payment record. The application requires `captured`, matching provider order ID, amount, and INR currency before it marks the order paid.
- Cashfree return verification by retrieving payments for the server-stored provider order and matching a successful payment, order ID, amount, and INR currency.
- Provider-specific signed webhook validation over the raw request body, webhook inbox persistence, duplicate-event protection, and defensive handling of out-of-order/pending states.
- Transactional payment finalization tied to stock reservations and cart quantity removal.

**Important validation status:** these paths have not been run against real sandbox credentials in this workspace. Provider payloads, webhook delivery, auto-capture configuration, and browser SDK behavior still require sandbox acceptance tests. Refund APIs and a complete payment reconciliation/refund administration workflow remain pending; do not advertise refunds as automated.

## Configure credentials

Set these only in the server environment (never in Vite variables):

```dotenv
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_WEBHOOK_SECRET=
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_API_VERSION=2026-01-01
```

Select one provider to configure first. The application requires that provider's key, secret, and webhook secret before exposing its checkout session. Use sandbox/test credentials for acceptance testing. Do not activate live keys until all readiness gates are satisfied and the owner expressly approves.

## Webhook setup

Configure the following exact public HTTPS endpoints in each provider dashboard:

- Razorpay: `https://<PUBLIC_APP_DOMAIN>/api/v1/payments/webhooks/razorpay`
- Cashfree: `https://<PUBLIC_APP_DOMAIN>/api/v1/payments/webhooks/cashfree`

Use the webhook secret corresponding to each provider environment. Razorpay signature validation uses the exact raw request body and `X-Razorpay-Signature`; Cashfree validation uses the raw body plus its documented timestamp and signature headers. This app leaves signed events unprocessed when provider status is pending or a matching internal payment attempt cannot yet be found; a retry can reconcile it. Monitor `PaymentWebhookEvent.processingError` and provider dashboards for events that require manual inspection.

## Production configuration checks

1. Confirm the deployed base URL uses HTTPS and is the same domain configured in provider dashboards.
2. In the Razorpay dashboard, enable automatic capture or deliberately add a tested capture workflow before expecting `captured` status.
3. Confirm Cashfree's API version, environment, return URL, and webhook configuration against the current merchant account documentation.
4. Verify the public key ID and environment correspond; keep secret key and webhook secrets server-side only.
5. Test success, failure, abandon/close, delayed payment status, duplicate webhook, out-of-order events, invalid signatures, wrong order IDs, amount/currency mismatch, and backend restart.
6. Verify orders and `PaymentAttempt`/`PaymentWebhookEvent` records directly in the database and provider dashboard. Do not run live charges from tests.
7. Exercise payment expiry and manual reconciliation procedures before accepting real money.

## Official references checked during implementation

- Razorpay Orders API: https://razorpay.com/docs/api/orders/create-orders/
- Razorpay webhook validation: https://razorpay.com/docs/webhooks/validate-test/
- Razorpay security checklist: https://razorpay.com/security/checklist/
- Cashfree Create Order API: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
- Cashfree Get Payments for an Order: https://www.cashfree.com/docs/api-reference/payments/latest/orders/get-payments-for-an-order
- Cashfree webhook signatures: https://www.cashfree.com/docs/api-reference/payments/latest/webhooks/overview

Provider documentation and account capabilities can change; verify endpoints, API version, capture configuration, and webhook headers against the account's current official documentation before production activation.


## Validation status

The adapters are present in source, but no sandbox transaction or provider webhook has been executed in this authoring environment. Run the acceptance tests against real sandbox accounts before staging. Automated refunds and an automated reconciliation worker are not implemented. Payment-initiation timeouts and unprocessed webhook inbox events need operator reconciliation; do not assume that code presence is equivalent to production payment readiness.
