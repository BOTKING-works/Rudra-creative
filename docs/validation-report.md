# Production-readiness audit and validation report

**Assessment date:** 2026-10-31
**Project:** Rudra Creative 3D-printing commerce
**Release status:** **NOT READY FOR PRODUCTION** — source-level hardening has been applied, but dependency resolution, semantic typechecking, integration tests, image builds, and real-service acceptance remain unverified.

## Changes made in this audit

- Pinned the runtime to Node.js 24.22.2 / npm 11.19.1, matching Prisma ORM v6 supported Node requirements; aligned `.nvmrc`, package engines, CI, release checks and Dockerfiles.
- Tightened production environment validation: HTTPS origins must be exactly the storefront/admin origins; production must explicitly declare `DEPLOYMENT_STAGE=staging|production`; database credentials must be non-placeholder and least-privilege; SMTP requires authenticated TLS submission; R2 requires separate account-bound private and public buckets; live payment activation requires complete Razorpay and Cashfree configuration.
- Added `DEPLOYMENT_STAGE=staging|production` as a mandatory setting in production mode. Staging rejects live provider credentials even when checkout is disabled; live production rejects test/sandbox credentials.
- Split checkout gating from provider verification so an emergency checkout disable does not block webhook processing/reconciliation. Updated deployment order so PostgreSQL migrations complete before the API and public proxy are started.
- Added `Cache-Control: no-store` to API responses and separated general API, sensitive-auth, checkout, payment-verify, and upload throttles.
- Added administrator email OTP after password verification; admin session creation occurs only after the single-use OTP succeeds. This is not phishing-resistant MFA.
- Changed R2 uploads to a create-once presigned PUT (`If-None-Match: *`) followed by server-side inspection and copy to a fresh sealed private key; the DB references only the sealed key. Added per-user hourly count/byte quotas.
- Tightened presigned upload URL lifetime to 180 seconds (maximum 300 seconds). Added `R2_UPLOADS_ENABLED=false` as a fail-closed default so public presigned uploads remain disabled until a hard ingress-size limit is installed and tested.
- Added/updated deployment and storage documentation, R2 CORS instructions, lifecycle recommendations, and manual acceptance test cases.

## Runtime baseline

- Node.js 24.22.2; npm 11.19.1 (as bundled by the official Node archive).
- PostgreSQL 16.15; Caddy 2.11.7.
- React/React DOM 19.3.1, Vite 8.3.5, Vitest 5.0.5, TypeScript 7.0.2, Express 5.3.0, Prisma 6.19.3, AWS SDK v3 3.1161.0 and the exact direct dependency versions listed in `docs/dependencies.md`.
- Prisma 6 remains on its supported Node 24 line; no Prisma major migration was attempted.

## Checks actually performed in this environment

| Check | Result | Meaning |
|---|---|---|
| Exact direct dependency declarations | Passed | `npm run deps:check` passed for all four manifests. |
| JSON/YAML syntax | Passed | All seven project JSON files and all five YAML files (including the hidden GitHub workflow/config files) parsed; this is not a Docker schema validation. |
| TypeScript/TSX syntax transpilation | Passed | 31 TypeScript/TSX files parsed with zero syntax diagnostics; this does not prove semantic types or dependency compatibility. |
| Shell and JS script syntax | Passed | All shipped shell scripts and JS helper scripts passed syntax checks. |
| Direct money-helper assertions | Passed | Nine focused backend arithmetic and validation assertions passed. The three Vitest test files (backend, storefront, admin) are present but have not executed because Vitest is not installed. |
| Full TypeScript typecheck | Blocked | `npm run typecheck` stops because `@types/node` is not installed; npm registry cannot be reached from this environment. |
| Vitest suite | Blocked | `npm test` stops at `vitest: not found`; workspace dependencies are not installed. |
| Production build | Blocked | `npm run build` stops for the same missing Node type definitions before frontend/admin builds can execute. |
| `npm audit` | Blocked | `npm run security:deps` returns `ENOLOCK`; no reviewed lockfile exists and registry DNS is unavailable. |
| Prisma generate/validate/migrations | Not run | Prisma package and PostgreSQL server unavailable. |
| Docker/Compose build and smoke test | Blocked | `docker compose ... config` returns `docker: command not found`; Docker is not installed. |
| R2 live tests | Not run | No Cloudflare R2 credentials/buckets/CORS test account supplied. |
| SMTP delivery tests | Not run | No mail credentials supplied. |
| Razorpay/Cashfree sandbox tests | Not run | No provider credentials supplied. |
| DNS/TLS/VPS deployment | Not run | No domain or VPS credentials supplied. |

## Known production blockers

1. **No lockfile.** A reviewed `package-lock.json` is absent. Direct exact pins do not pin transitive dependency versions. CI and Docker builds deliberately refuse to run without it.
2. **No full build or test evidence.** This workspace currently runs Node 22.16.0/npm 10.9.2 and lacks installed workspace dependencies. The selected supported project runtime is Node/npm 24.22.2/11.19.1. The release gate correctly rejects the current runtime. The final local attempts were: typecheck blocked by missing `@types/node`; tests blocked by missing `vitest`; build blocked by missing Node type declarations; `npm audit` blocked with `ENOLOCK`; release gate rejected Node 22.16.0; Docker Compose validation blocked because the Docker CLI is absent.
3. **Payment lifecycle incomplete.** Provider adapters and verification/webhook handling exist, but automated refunds, late-capture refund resolution, and a durable reconciliation worker are not complete. Checkout stock reservations do not yet have a verified scheduled expiry/release job for abandoned/uncertain payments.
4. **Invoices/receipts incomplete.** A production-reviewed invoice/receipt generation and archival workflow is not verified. Tax treatment, HSN/SAC, GST rates and legal invoice text must be owner/accountant approved.
5. **R2 size enforcement.** Actual object size is checked after upload and per-user hourly quotas are enforced, but the current presigned PUT path does not prove a hard max Content-Length limit at the R2 edge before bytes are stored. `R2_UPLOADS_ENABLED` now defaults to false and blocks presign/complete routes. A streaming gateway or validated provider-supported size restriction is required before enabling untrusted public uploads.
6. **File safety.** Format signatures are basic checks only. 3MF is recognized as ZIP, not fully validated; no isolated file parser/slicer is provided. Files need staff review and later sandboxed scanning/validation before use in manufacturing.
7. **Admin identity assurance.** Email OTP is added for admin login, but it is not phishing-resistant MFA. Consider passkeys/security keys before granting privileged access to multiple staff.
8. **Operational acceptance.** SMTP, R2, payment webhooks, DNS/TLS renewals, backups/restores, monitoring, disk alerts, load tests, incident response and rollback have not been executed against real infrastructure.
9. **Automated test coverage is very limited.** Only three Vitest files exist, covering basic money calculations and INR display formatting. Authentication, authorization, database transactions/migrations, cart/checkout, payment adapters/webhooks, uploads, shipping, content publishing, concurrency, and browser journeys do not yet have sufficient automated integration/E2E/security coverage.
10. **Legal and India tax settings.** No GSTIN, HSN/SAC, GST rate, legal policies, seller identity, refund terms, or invoice compliance has been invented or approved.

## Required connected-environment release run

1. On a trusted workstation, install exact Node/npm versions from `.nvmrc` and verify `node --version` is `v24.22.2` and `npm --version` is `11.19.1` or newer within npm 11.
2. Generate the lockfile using `npm run lock:refresh`; inspect transitive resolutions, package integrity, lifecycle scripts and licenses; commit `package-lock.json`.
3. Run `npm ci`, full and production-only `npm audit`, `npm run prisma:generate`, `npm run prisma:validate`, `npm run typecheck`, `npm run test`, and `npm run build`. Resolve all failures/advisories; do not force major upgrades.
4. Build and scan API/web images; validate `docker compose -f docker-compose.production.yml config -q`; apply migrations to a fresh test DB and from a prior schema version.
5. Deploy a production-mode **staging** host with `DEPLOYMENT_STAGE=staging`, secure HTTPS cookies, SMTP, private/public R2, Razorpay test keys and Cashfree sandbox. Run every manual acceptance test, including replayed R2 upload URL and admin OTP.
6. Add/test payment reconciliation and reservation expiry, refund handling, invoice/receipt workflow, and upload hard-size enforcement before a live transaction launch.
7. Complete an independent security review, restore a verified encrypted off-host backup, load-test the intended use, and capture image digests/SBOM/audit/test logs.
8. Only after owner/accountant/legal approval, set `DEPLOYMENT_STAGE=production`, set both provider credentials to live, set `PAYMENTS_ENABLED=true`, and complete a final supervised production smoke test.

**This report does not certify the application secure or production-ready. It records source-level improvements plus the evidence still required before deployment.**
