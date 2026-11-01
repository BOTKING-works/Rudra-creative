# Production-readiness gates

This checklist is deliberately conservative. The current repository is **not production-ready**. Mark each item only when evidence is available.

## Foundation

- [ ] Install dependencies in a clean environment and commit the generated lockfile.
- [ ] `npm run typecheck`, `npm run test`, and `npm run build` all pass in CI.
- [ ] Prisma schema validates; migration applies cleanly to a fresh PostgreSQL instance and from a prior release.
- [ ] Docker image builds; production Compose configuration is rendered/reviewed and smoke-tested.
- [ ] Startup validation rejects placeholder secrets; no real secrets appear in source, image layers, logs, or frontend bundles.

## Identity and access

- [ ] Configure and verify production SMTP; test registration, OTP expiry/replay/limits, login, password reset, logout, session rotation/revocation, and deliverability.
- [ ] Review CSRF, Origin/CORS, __Host secure cookies, proxy trust, security headers, and rate limits on actual public hostnames.
- [ ] Verify administrator sign-in requires password plus single-use email OTP; assess phishing-resistant MFA (such as passkeys/security keys) before granting broad admin access.
- [ ] Test role and per-object authorization with multiple customers and admin roles.
- [ ] Conduct an independent security review; automated tests are not a penetration test.

## Catalog, assets, and custom print

- [ ] Test one-write presigned PUT (`If-None-Match: *`), immutable seal copy, signature checks, approval copy, public URL delivery, deletion, and exact-origin R2 CORS against real buckets; complete content moderation workflow.
- [ ] Validate uploaded files using a robust format-specific validation strategy; test compressed/archive bombs and parser limits if format parsing is added.
- [ ] Verify R2 bucket policy, private/public split, CORS, signed URL TTL, hard ingress size enforcement, quotas, retention lifecycle and key rotation. Keep `R2_UPLOADS_ENABLED=false` until the hard size cap is proven against oversized uploads.
- [ ] Test quote revision, expiry, customer notification and conversion-to-order/payment workflows end to end; verify email-failure behavior and duplicate/racing customer actions.

## Commerce and payments — blocking

- [ ] Integration-test transactional cart, Indian address validation, configurable product/shipping tax (including effective dates), order snapshots, stock reservations and order state machine under concurrency.
- [ ] Implement invoice/receipt output with owner-approved tax details.
- [ ] In `DEPLOYMENT_STAGE=staging`, sandbox-test Razorpay adapter, server-side verification, raw-body webhook signature validation, idempotency, reconciliation and refund handling; current automated refund operations remain incomplete.
- [ ] Sandbox-test Cashfree adapter independently with its own signature/event semantics and versioned API contract. Only set `DEPLOYMENT_STAGE=production` and enable live payments after both providers pass staging.
- [ ] Test duplicate/out-of-order webhooks, mismatches, timeout/uncertain states, refunds, and inventory races.
- [ ] Obtain owner approval before using production payment credentials.

## Admin and content

- [ ] Exercise the content-management draft/preview/publish UI and test revision history, authorization, and required-page placeholder controls.
- [ ] Validate order, inventory adjustments/movement history, shipping and payment visibility UI; improve financial reconciliation and refund operations before production launch.
- [ ] Check every sensitive admin action for reauthentication/confirmation, authorization, and audit logging.

## Deployment and operations

- [ ] Confirm DNS, TLS renewal, proxy headers, admin hostname restrictions, CSP and security headers.
- [ ] Run backup scripts; store encrypted backups off-host; test database and object restore.
- [ ] Establish monitoring, disk alerts, resource dashboards, log retention/redaction, on-call/incident response and secret rotation.
- [ ] Load test the intended workloads and tune Postgres connections, Node heap and container limits based on measurement.
- [ ] Complete `docs/manual-testing.md` with actual results; fix all critical/high-risk findings before launch.
- [ ] Replace and approve all legal/business placeholders; review tax and invoicing with a qualified professional.

No box should be considered complete based solely on generated files. Preserve logs, test reports, and review records as evidence.
