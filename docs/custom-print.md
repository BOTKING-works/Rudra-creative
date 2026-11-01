# Custom-print workflow

## Customer flow currently available

1. Customer signs in with a verified email account.
2. Customer provides material/color preferences, quantity, optional dimensions/instructions, and uploads at least one STL/3MF/OBJ model. Reference images can be attached.
3. Uploads are created in private R2 storage under random keys, checked for configured size and metadata/signature mismatch, and initially marked `QUARANTINED`. This is a preliminary check, not comprehensive mesh-file validation.
4. Customer submits asset IDs. The API verifies ownership, asset status and purpose before creating a request reference.
5. Customer can list/open only their own requests. Private downloads use short-lived signed URLs after customer/admin authorization.
6. Admin reviews requests and files, can request clarification or reject, and can create a quotation with subtotal, shipping, manually-entered tax, lead time, terms and expiry.
7. Creating/sending a quotation first persists the quote and places the request in `QUOTED`; the notification email is then attempted. If email sending or later persistence fails, check the quote and delivery logs before retrying. A draft quote should not be assumed delivered merely because it is visible in admin.
8. Customer can accept or decline a valid, unexpired sent quote. The server checks quote/request state and performs the acceptance transaction.
9. Acceptance creates a `PENDING_PAYMENT` order with a snapshot of the quoted amounts and marks the request `CONVERTED_TO_ORDER`. The customer can continue via `POST /api/v1/custom-print/requests/:id/pay`, supplying a saved Indian address, provider choice and `Idempotency-Key`.
10. Checkout creates a provider order/session through the selected Razorpay or Cashfree adapter. The order is not marked paid from a browser redirect; provider verification and/or a valid provider webhook must establish payment status.
11. After verified payment, fulfillment uses the normal admin order/shipping workflow.

## Important limitations

- Quote subtotal, shipping and tax are manually entered by an admin. The quote-to-order path snapshots those values; it does not independently prove the tax classification or recompute the quotation through the ready-made catalog tax engine. Confirm pricing/tax treatment before production and have a qualified tax professional approve the rules.
- Quote revision history UI, expiry processing jobs, richer clarification/rejection-reason UX, automated notification retries, invoices/receipts, automated refunds, and full provider reconciliation tooling remain incomplete or require validation.
- The API code path is not yet runtime- or sandbox-validated in this environment. Do not treat this workflow as release-ready until the manual tests in `manual-testing.md` pass.
- No automatic manufacturability, slicing, volume, support, mesh repair or print-time analysis is claimed.

## File handling policy

Treat model files as untrusted. Never execute a model file or feed it directly to a privileged slicer. The current initial signature and metadata checks do not constitute robust validation of STL/3MF/OBJ structure. If mesh inspection is added, use a separate process/container with no network, a read-only filesystem where possible, resource limits, strict timeouts and output-size limits. Private downloads must be owner/admin authenticated and short-lived. Product images are uploaded privately first; an authorized admin approval flow copies an approved asset to the configured public-assets bucket and creates its catalog association.
