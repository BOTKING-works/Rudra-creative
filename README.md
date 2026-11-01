# Rudra Creative — India-focused 3D-printing commerce

This repository is a TypeScript modular-monolith implementation increment for the supplied master specification. It includes a separate React/TypeScript customer storefront and admin app, an Express API, PostgreSQL/Prisma schema and migration, the supplied brand image, and single-VPS deployment/documentation scaffolding.

**This is not yet verified as production-ready.** No dependency install, Prisma validation, container build, sandbox payment, deployment, or end-to-end test could be completed in the authoring environment because the npm registry was unreachable and Docker/PostgreSQL were unavailable. The implementation requires a clean connected-environment build and the acceptance gates in `docs/production-readiness.md` before use with real customers.

## What is implemented in this increment

- Storefront: home/catalog pages, database-backed product details, URL-shareable search/filter/sort, variant selection, persistent account cart, Indian address entry, checkout initiation, payment status page, custom-print request submission, account/quote views, and database-backed legal/info pages.
- Admin: separate app with password-plus-email-OTP administrator login, product records, variant creation and reservation-safe stock adjustments with inventory movement history, private-first product-image publish/removal, custom-print review and quotation creation, plain-text content drafting/preview/publishing, order/payment visibility, and constrained fulfillment transitions.
- Backend: Express REST API at `/api/v1`, Prisma/PostgreSQL models and migration, email/password plus email-OTP challenge flows, database sessions, object ownership checks, catalog search, one-write Cloudflare R2 presign/complete flow with a server-sealed private object key and private-first product-image approval/copy/link/removal, custom-print and quotation endpoints, server-priced checkout, conditional stock reservations, order snapshots, Razorpay/Cashfree provider adapters, provider-side payment verification, signed webhook validation and event inbox, and admin fulfillment endpoints.
- Deployment: Docker Compose, Nginx/Caddy configuration, separate PostgreSQL app role on fresh production volume initialization, database backup/restore scripts, conservative memory settings, CI workflow, and operations/security docs.

## Known gaps and release blockers

- A committed dependency lockfile is still pending because this environment cannot resolve the npm registry. Direct dependencies are exact-version pinned; CI, release scripts and Docker builds refuse to run without a reviewed `package-lock.json`, then use `npm ci` and audit gates. Generate and commit the lockfile from a connected trusted environment before a production release.
- Runtime typechecking, production bundle builds, Prisma schema/migration validation, Docker Compose validation, and application tests have not been executed in this environment.
- Razorpay and Cashfree adapters are code-level integrations only; sandbox credentials, exact event fixtures, checkout SDK behavior, retries, reconciliation, and edge cases still need provider sandbox acceptance testing. Automated refunds and a complete financial reconciliation operations workflow are not implemented.
- Payment-initiation timeouts can leave uncertain provider state that needs a documented/manual reconciliation process. The API intentionally holds stock/orders and blocks duplicate attempts in uncertain states. Do not run live charges until this behavior is sandbox-tested and an operator reconciliation runbook is exercised.
- R2 upload flows default to disabled (`R2_UPLOADS_ENABLED=false`) until a hard ingress size cap is installed and tested. Product-image publishing still requires real bucket credentials/CORS; robust STL/3MF/OBJ format inspection, model parsing/slicing, and production-grade custom-model moderation are not included.
- Invoice/receipt generation, shipping-carrier integration, comprehensive content revision UX, automated refunds, and production monitoring are incomplete or require validation. Quote-to-order/payment is implemented at code level but has not been runtime or sandbox validated.
- Business identity, GSTIN, tax classification/rates, legal text, shipping policy, sender identity, domain, and credentials are deliberately not fabricated.

## Requirements

- Node.js 24.22.2 (see `.nvmrc`) and npm 11.19.1+
- Docker Engine and Compose plugin for local PostgreSQL / deployment
- A PostgreSQL database for non-Docker development
- Provider accounts, SMTP, and Cloudflare R2 credentials to exercise integrations

## Local development

1. Copy `.env.example` to `.env`. Replace all development placeholders with independent random secrets. Never commit `.env`.
2. Start the database: `docker compose up -d postgres`.
3. Create a reviewed lockfile once with `npm run lock:refresh`, then commit `package-lock.json`. For a clean install use `npm ci`. The deployment Dockerfiles require a committed lockfile and fail closed when it is absent. The build runs `npm audit` and fails on moderate-or-higher findings.
4. Generate Prisma client: `npm run prisma:generate`.
5. Apply migrations: `npm run db:migrate`.
6. Start API: `npm run dev:api`.
7. Start storefront and admin in separate terminals: `npm run dev:storefront` and `npm run dev:admin`.

Default local URLs: storefront `http://localhost:5173`, admin `http://localhost:5174`, API live check `http://localhost:4000/api/v1/health/live`.

The catalogue starts empty unless the explicit demo seed is run. To bootstrap the first administrator, set a unique owner email and strong password only in the one-off shell, then run `npm --workspace backend run admin:bootstrap` after migrations. Public admin registration is not provided. The exact bootstrap/runtime command must be checked against the built image before production use.

OTP delivery requires configured SMTP. Production startup fails if SMTP configuration is incomplete. Checkout blocks when required tax classifications/rates are not configured; configure only rates and tax codes approved by the business's accountant. Payment UI callbacks and redirects do not prove payment success—the API checks provider state.

## Useful commands

- `./scripts/secure-deps.sh` (requires Node/npm pins and a committed lockfile; clean install, dependency audits, Prisma generation, typecheck, tests and production build)
- `npm run deps:check`
- `npm run security:deps`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run prisma:generate`
- `npm run db:migrate`
- `npm run db:seed` (creates clearly labelled demo data only)

Read `docs/dependencies.md`, `docs/production-readiness.md`, `docs/deployment.md`, `docs/payments.md`, `docs/security.md`, and `docs/manual-testing.md` before staging.
