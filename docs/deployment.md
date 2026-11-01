# Deployment on one Linux VPS (4 GB RAM)

## Scope and status

The Compose files are a conservative deployment starting point, not evidence of a tested production deployment. The selected Node 24.22.2 / Prisma 6 combination is within Prisma v6 supported Node requirements. Direct npm dependencies are exact-version pinned. Node.js 24.22.2 is paired with npm 11.19.1. A committed `package-lock.json` is still required for reproducible production releases; this workspace could not create it because registry DNS is unavailable. CI, release scripts and Dockerfiles require a reviewed lockfile and use `npm ci`; they intentionally fail when it is absent. Image builds run `npm audit` gates for moderate-or-higher findings. **Before production, run `npm run lock:refresh` in a trusted connected environment, review and commit `package-lock.json`, then rebuild and verify against that lockfile.** PostgreSQL, API, Node and Caddy image tags have been advanced to maintained releases. The API build stage includes a native-addon toolchain for Argon2 fallback compilation; the runtime stage contains only the native runtime libraries. Docker/Compose and external service validation were unavailable here, so the deployment remains unverified end-to-end.



## DNS and hostnames

Choose the actual hostnames and set `PUBLIC_APP_DOMAIN` and `PUBLIC_ADMIN_DOMAIN` in the host's `.env`. Use only hostnames (no scheme, path, port, or trailing slash). Create DNS A records pointing to the VPS public IPv4 address; create AAAA records only if IPv6 is configured and reachable. Wait for DNS and confirm resolution from outside the VPS. Caddy obtains and renews certificates automatically when ports 80 and 443 are reachable and DNS is correct.

Use an SSH key, disable password SSH only after confirming key access, and restrict SSH through the VPS firewall/security group. Permit inbound TCP 80 and 443. Do not expose PostgreSQL's port publicly. The API is only exposed inside Docker networks.

## First deployment sequence

1. Provision a supported Linux distribution and update packages.
2. Install Docker Engine and the Compose plugin from the operating-system/vendor documentation.
3. Create a dedicated application directory and copy the repository there.
4. Create `.env` from `.env.example`; set `DEPLOYMENT_STAGE=staging` for a production-mode staging environment, or `DEPLOYMENT_STAGE=production` for the live environment. Replace every placeholder with independently generated secrets. Do not commit or share the resulting file. The app runs with `NODE_ENV=production` in both stages, so secure cookies and production checks remain enabled.
5. Set `POSTGRES_DB`, `POSTGRES_USER`, and a strong `POSTGRES_PASSWORD` for PostgreSQL bootstrap only. The production Compose file mounts `infrastructure/docker/postgres-init/01-create-app-role.sh`, which creates a separate app role on first database initialization. Set `APP_DB_USER` and a separate strong `APP_DB_PASSWORD`, and set `DATABASE_URL` to `postgresql://APP_DB_USER:URL_ENCODED_APP_DB_PASSWORD@postgres:5432/POSTGRES_DB?schema=public`. The API receives only the application connection string, not the PostgreSQL bootstrap password. URL-encode reserved characters in credentials. Init scripts only run when the PostgreSQL data directory is first initialized; credential/role rotation must be done deliberately on an existing database.
6. Set the exact public origin URLs and domains; check that `CORS_ALLOWED_ORIGINS` contains only the scheme/host origins used by both apps.
7. Configure SMTP and private/public R2 buckets before enabling OTP. Keep `R2_UPLOADS_ENABLED=false` until a real gateway/edge hard-size limit is installed and verified; the direct R2 presign flow validates actual size only after transfer. Enable uploads only after the oversized-object rejection test passes. Set R2 private-bucket CORS to the exact storefront/admin origins and the required upload headers (`Content-Type`, `If-None-Match`, and the two `x-amz-meta-*` headers); apply the `incoming/` lifecycle rule described in `docs/storage.md`. If shipping has a nonzero taxable charge, set `SHIPPING_TAX_CODE`, `SHIPPING_TAX_RATE_BPS`, and an ISO-8601 `SHIPPING_TAX_EFFECTIVE_FROM` date/time approved by the business accountant; checkout blocks if any are missing or the rate is not effective yet. For staging use Razorpay `rzp_test_` credentials, Cashfree sandbox, and `PAYMENTS_ENABLED=true`. For live production use Razorpay `rzp_live_` credentials, Cashfree production, `DEPLOYMENT_STAGE=production`, and enable `PAYMENTS_ENABLED=true` only after both sandbox integrations and owner approval. The API allows provider verification/webhook reconciliation to continue even if new checkout is disabled.
8. Review Dockerfiles and Compose settings; build in CI or a separate build host where possible to reduce peak RAM on the VPS.
9. Run `docker compose -f docker-compose.production.yml config` and review the resolved configuration without exposing secrets in shared logs.
10. Confirm `package-lock.json` is present and reviewed before building. Build both images without starting public services: `docker compose -f docker-compose.production.yml build`. Both Dockerfiles intentionally fail when the lockfile is absent or the npm audit gate reports a moderate-or-higher advisory.
11. Start only PostgreSQL and wait until it reports `healthy`: `docker compose -f docker-compose.production.yml up -d postgres`. Confirm the application database role exists (on a new volume it is created by the init script).
12. Apply migrations from the built API image before starting the API or public proxy: `docker compose -f docker-compose.production.yml run --rm --no-deps api npx prisma migrate deploy --schema backend/prisma/schema.prisma`. Review the migration plan and backup state first. This command is not run automatically on application startup.
13. Start the API and wait until its readiness healthcheck is healthy: `docker compose -f docker-compose.production.yml up -d api`. Then start the public Caddy proxy: `docker compose -f docker-compose.production.yml up -d web`. This ensures public routes are not exposed before migrations have been applied. Run health checks and a manual acceptance pass; inspect Caddy logs for certificate errors.
14. Create the first administrator with a compiled one-off bootstrap script and pass the values only to that one-off process (do not add them to the long-running API service): `INITIAL_ADMIN_EMAIL=owner@example.invalid INITIAL_ADMIN_PASSWORD='REPLACE_WITH_A_UNIQUE_LONG_PASSWORD' docker compose -f docker-compose.production.yml run --rm -e INITIAL_ADMIN_EMAIL -e INITIAL_ADMIN_PASSWORD api node backend/dist/modules/auth/bootstrap-admin.js`. Replace the example values with the owner-approved email and a newly generated password. Remove them from the invoking environment immediately afterward. Never set a fixed default password or expose the bootstrap operation publicly.
15. Verify backups and restore into a separate test database before launch. Confirm a private R2 upload cannot be overwritten with a replayed presigned URL and that a published image is the only public copy.
16. Before live payments, complete the remaining production gates in `docs/production-readiness.md`, including refunds/reconciliation, payment-reservation expiry, invoice/receipt workflow, hard upload-size enforcement, independent security review, monitoring and load tests.

## Updates and rollback

- Build and test a specific source revision; record the git SHA and image digests.
- Back up PostgreSQL and confirm R2 retention before schema changes.
- Prefer backward-compatible expand/contract migrations across releases. Do not automatically reverse a migration containing data changes.
- Deploy the tested revision, run `prisma migrate deploy`, and execute smoke tests.
- If the API/frontend release is faulty, redeploy the previous image/source revision. Restore a database backup only after assessing writes since deployment; restoring can discard valid orders and must be an explicit owner-approved recovery action.
- Never run `docker compose down -v` on production. It deletes persistent volumes.

## Resource guidance

Current Compose limits are starting points, not capacity promises. Watch host memory, OOM events, Postgres active connections, disk use, request latency, and container restarts. Load test representative product browsing, auth, and checkout (after provider sandbox validation) before estimating traffic capacity. Do not add Redis, a search cluster, or a message broker without a measured need.
