# REST API outline

Base path: `/api/v1`. JSON errors use `{ "error": { "code": "...", "message": "..." } }`. Do not rely on undocumented database fields; routes should return allowlisted DTOs. Mutation requests require an allowlisted `Origin`, a CSRF cookie and matching `X-CSRF-Token` header. Browser clients should use `credentials: 'include'`.

## Implemented routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/health/live` | Public | Process liveness |
| GET | `/health/ready` | Public | Database readiness |
| GET | `/auth/csrf` | Public | Issue signed CSRF cookie/token |
| POST | `/auth/register` | Public/rate-limited | Register with email/password, initiate email OTP |
| POST | `/auth/verify-email-otp` | Public/rate-limited | Consume single-use email challenge |
| POST | `/auth/resend-email-otp` | Public/rate-limited | Rate-limited resend |
| POST | `/auth/login` | Public/rate-limited | Password login after email verification |
| GET | `/auth/me` | Authenticated | Current user DTO |
| POST | `/auth/logout` | Public with CSRF | Revoke current session cookie if present |
| POST | `/auth/forgot-password` | Public/rate-limited | Send one-time reset token if account qualifies |
| POST | `/auth/reset-password` | Public/rate-limited | Consume reset token and revoke existing sessions |
| GET | `/categories` | Public | Active product categories |
| GET | `/products` | Public | Catalog search, filters, sort, pagination |
| GET | `/search` | Public | Alias of catalog search |
| GET | `/products/:slug` | Public | Published/active product detail |
| POST | `/uploads/presign` | Authenticated | Create a short-lived signed upload URL |
| POST | `/uploads/complete` | Authenticated/owner | Check uploaded object and quarantine it |
| POST | `/custom-print/requests` | Authenticated | Submit custom-print request and quarantined file IDs |
| GET | `/custom-print/requests` | Authenticated/owner | List own requests |
| GET | `/custom-print/requests/:id` | Authenticated/owner | Detail and visible quotations |
| POST | `/custom-print/requests/:id/accept-quote` | Authenticated/owner | Accept an unexpired sent quotation and create one payable order |
| POST | `/custom-print/requests/:id/pay` | Authenticated/owner | Start provider checkout for a converted quote order (requires `Idempotency-Key`) |
| POST | `/custom-print/requests/:id/decline-quote` | Authenticated/owner | Decline a sent quotation using a state-conditional update |
| GET | `/content/:slug` | Public | Published content only |
| GET/POST/PATCH | `/admin/products...` | Admin | Product list/create/update |
| GET/PATCH/POST | `/admin/custom-print...` | Admin | Review requests and prepare/send quotations |
| GET/PUT | `/admin/content...` | Admin | Plain-text content editor API and revisions |
| GET | `/admin/assets/:id/download` | Admin | 120-second signed download for quarantined/approved asset |
| GET | `/admin/inventory/movements` | Admin | Paginated inventory movement history |
| POST | `/admin/inventory/adjustments` | Admin | Atomic, audited manual stock adjustment that cannot undercut reservations |
| GET | `/admin/assets/pending-product-images` | Admin | List quarantined product-image uploads for review |
| POST | `/admin/assets/:id/approve-product-image` | Admin | Verify/copy a product image to public R2 and link it to a product |
| POST | `/admin/assets/:id/reject-product-image` | Admin | Reject and clean up a quarantined product image with a reason |
| DELETE | `/admin/products/:productId/images/:imageId` | Admin | Remove linked image and attempt public-object cleanup |

Product image upload, approval, copy-to-public, link, rejection and deletion are implemented in the admin API and upload UI; inventory adjustment and history are also implemented with atomic reservation-safe SQL. These flows have not been run against real R2/PostgreSQL instances in this environment. Some workflows are implemented only at code level and have not been runtime-tested. Known API gaps include category CRUD, complete refund operations, advanced role/permission management, legal-content revision restore, and automated reconciliation/cleanup jobs. Product image upload/approval/removal is implemented at code level but still needs R2 integration testing. See `production-readiness.md` for release gates.

## Commerce route detail

- Cart: `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`.
- Address book: `GET /addresses`, `POST /addresses`, `DELETE /addresses/:id`.
- Checkout/orders: server-authoritative pricing, tax/shipping configuration checks, idempotency, inventory holds, order history/details, provider verification and guarded fulfillment transitions.
- Custom quotes: accepting a current quote creates one payable order; `POST /custom-print/requests/:id/pay` starts provider checkout with an `Idempotency-Key`. The endpoint requires an owned saved Indian address.
- Provider adapters: provider-specific order/session creation, server-side payment verification, signed webhook inbox and retryable reconciliation state. Automated refunds are not implemented.
- Admin operations: product and variant creation, custom-print review/quotations, order fulfillment, content editing and payment visibility. Some management lifecycle functions remain incomplete.

## Search query parameters

`q`, `category`, `material`, `color`, `minPrice`, `maxPrice`, `availability=in-stock|all`, `sort=relevance|price-asc|price-desc|newest|name`, `page`, `limit` (maximum 48). Prices are integer paise. PostgreSQL full-text matching uses a `simple` text-search configuration and a GIN expression index; SKU substring matching is also supported.


## Cart, addresses, orders, and payments

- `GET /api/v1/cart`
- `POST /api/v1/cart/items` (`variantId`, `quantity`)
- `PATCH /api/v1/cart/items/:id` (`quantity`)
- `DELETE /api/v1/cart/items/:id`
- `GET /api/v1/addresses`
- `POST /api/v1/addresses` (validated India delivery address)
- `DELETE /api/v1/addresses/:id`
- `POST /api/v1/checkout` (requires `Idempotency-Key`; body: `addressId`, `provider` (`RAZORPAY` or `CASHFREE`), optional `customerNote`)
- `GET /api/v1/orders`
- `GET /api/v1/orders/:id`
- `GET /api/v1/payments/orders/:id`
- `POST /api/v1/payments/verify/razorpay`
- `POST /api/v1/payments/verify/cashfree`
- `POST /api/v1/payments/webhooks/razorpay`
- `POST /api/v1/payments/webhooks/cashfree`

All customer commerce routes require an authenticated session. Address, cart, and order records are scoped to the session user. Checkout price, stock, tax, and shipping are recalculated server-side. Checkout is rejected when product tax code/rate/effective date is missing or shipping is chargeable but its tax treatment is not configured. Product tax code and rate must be supplied from owner/accountant-approved business settings. Configure shipping's tax code and rate explicitly (a 0 bps rate may be configured only where approved).

Payment webhooks bypass browser CSRF validation only for the two provider webhook paths; they must pass provider-specific HMAC verification before being processed. Do not mark an order paid based on a return URL or client assertion. See `payments.md` for configuration and limitations.
