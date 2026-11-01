# Architecture and implementation status

## Decisions

- **Pattern:** three-tier modular monolith. Storefront and admin are independent React/TypeScript applications; both call the same REST API. Business logic and authorization stay in Express.
- **API:** Express 5, TypeScript, versioned under `/api/v1`.
- **Persistence:** PostgreSQL through Prisma. The initial versioned migration is `backend/prisma/migrations/20261026000000_init/migration.sql`.
- **Sessions:** random opaque HttpOnly cookie, HMAC-digested token stored in PostgreSQL, expiry and per-user revocation. Session cookies are host-only. Production cookie names use `__Host-` and require HTTPS.
- **CSRF:** signed double-submit token, strict same-site cookie, exact allowlisted `Origin` on state-changing API requests.
- **Files:** S3-compatible Cloudflare R2. Private customer/model files use a private bucket; public product images use a separate public bucket. Model files remain quarantined after inexpensive signature checks.
- **Money:** catalog data uses integer paise; monetary helpers reject unsafe integer arithmetic. Tax configuration is not hard-coded.
- **Deployment:** one VPS, Docker Compose, Caddy automatic HTTPS. No Kubernetes, Redis, microservices or search cluster.

## Request flow

`Browser -> Caddy/static React app -> /api/v1 reverse proxy -> Express middleware -> module/service -> Prisma -> PostgreSQL`.

Direct-to-R2 upload is a distinct flow: authenticated client requests a short-lived presigned PUT URL, uploads to a private bucket, and calls the API to verify metadata/signature. Ownership is checked on presign, completion, and attachment; a completed upload is quarantined. The initial signature inspection is not a malware scanner, STL/OBJ validator, 3MF archive validator, printability assessment or sandbox. An isolated worker and explicit review/approval step are required before any later production processing.

## Repository map

- `frontend/`: customer storefront, product search/detail, sign-in/registration, OTP verification, custom-print request form, legal-page rendering.
- `admin/`: separate admin console, admin login, live catalogue records, draft product creation, custom-print review and quotation submission, quarantine file download links.
- `backend/src/modules/`: health, authentication, catalog, storage, custom-print/quotes, content modules.
- `backend/prisma/`: relational schema, migration, opt-in demo seed.
- `brand/rudra-creative-logo.png`: canonical supplied logo; applications import this file rather than keeping divergent copies.
- `infrastructure/`: production compose, Caddy config and Docker build files.
- `docs/`: security and operations runbooks.

## Implemented in this increment

- Database-backed public product listing, category listing, search/filter/pagination and product detail (requires published product rows).
- Database-backed admin product listing/create/update with server-side role enforcement and audit entries.
- Password hashing with Argon2id; email OTP verification with a keyed digest, expiry, attempt and resend limits; password reset token flow; opaque PostgreSQL-backed sessions; CSRF checks; role-based admin guard.
- Authenticated R2 presigned upload/completion flow, extension/content-type allowlists, size/metadata checks and basic magic-byte checks. Uploads remain private/quarantined until reviewed. Public images and private uploads must be stored in separate buckets.
- Custom-print request submission, customer-owned request retrieval, admin status actions, quotation draft/send attempt, and customer quote accept/decline and a customer request/quotation dashboard. Email is sent before a quote is marked `SENT`; failed mail leaves it as a draft.
- Plain-text database-backed content page API and admin editor with draft/preview/publish, edit revisions, audit records and placeholder publication blocking.
- INR formatting, money/tax calculation helper tests and API/deployment documentation.

## Not implemented or not verified yet

This is **not a finished e-commerce system**. Cart endpoints and guest-cart merge, checkout/order creation, stock reservations, address book, tax/shipping engine UI, invoice generation, order/shipment state machine, Razorpay adapter, Cashfree adapter, payment webhook/reconciliation/refunds, production email notifications beyond auth/quote email, product image attachment/approval UI, content editor revision browsing, and broader end-to-end/security tests remain outstanding. The data model anticipates several of these flows, but a schema model is not a working feature.

Dependency installation timed out in the authoring environment, so package compilation, Prisma validation/migration execution and test suites could not be executed here. Do not infer test success from files existing. Run the commands in `setup.md` in a network-enabled development environment and review/fix any issues before staging.
