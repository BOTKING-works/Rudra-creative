# Application security notes

## Implemented safeguards

- Express security headers via Helmet; production HSTS; JSON request limit; URL-encoded request limit; origin allowlist; credentials-enabled CORS without wildcard.
- Signed CSRF token cookie, strict same-site cookie and exact origin check for state-changing methods.
- HttpOnly, host-only session cookie; `Secure` in production; random 256-bit session secret stored as a keyed digest in PostgreSQL; expiry and server-side revocation; no localStorage authentication token.
- Argon2id password hashing; email OTP generated using a cryptographically secure random generator; keyed OTP digest instead of plaintext; expiry, attempt limit, one-time use, replacement invalidation, resend cooldown and per-user hourly cap.
- Admin roles checked on server routes; no public admin registration; explicit bootstrap command; create/update catalog and quote status actions audited.
- Zod validation and allowlisted DTOs on implemented write endpoints; Prisma parameterization plus parameterized full-text SQL; customer ownership checks on custom-print requests and asset upload/complete.
- Checkout idempotency records, unique provider-payment attempt identifiers, webhook event inbox uniqueness, provider-state verification, and stock reservations are present in source; race behavior is still untested.
- Separate R2 buckets: public images in the public image bucket; custom models/reference uploads in a private bucket. Signed download links are short-lived. Model files remain quarantined after superficial signature checks.
- Production environment validation rejects secret placeholders and missing SMTP settings. Real keys must stay backend-only.

## Important gaps / launch blockers

- **No security audit or penetration test has been run.** Automated checks, once they run, cannot prove the absence of vulnerabilities.
- Payment adapters and webhook verification are present in source but have not been sandbox-tested here. Automated refunds and a reconciliation worker are not implemented. Do not take live payments.
- The R2 completion process does not perform malware scanning, full 3MF ZIP validation, comprehensive OBJ parsing, geometric complexity limits or manufacturability checks. It does not run customer files through a slicer. A dedicated low-privilege isolated worker plus quotas/timeouts is needed for any deeper inspection.
- Product-image attachment/approval workflow is incomplete. Do not publish an unreviewed upload by simply exposing a bucket.
- Automated order cancellation/expiry, uncertain provider-initiation reconciliation, and refund processing remain incomplete; checkout/inventory/payment race behavior requires tests.
- Session-store cleanup, OTP cleanup, abandoned-upload cleanup, content-management UI, full audit browsing and retention jobs are not yet implemented.
- Rate limiting currently uses process-local in-memory counters. On a single API instance this is a useful baseline, but it resets on restart and would not coordinate multiple instances; reassess before scaling.
- Reverse proxy headers, Caddy domain setup, object-store bucket CORS/IAM, the configured Content Security Policy and production cookies need staging verification.

## Required review areas before launch

1. Authentication, account enumeration and recovery.
2. CSRF, same-site cookies, proxy trust and origin validation across the final domains.
3. Broken object-level authorization across customer data and private objects.
4. Payment provider signature verification, out-of-order/duplicate webhooks and reconciliation once adapters are built.
5. Atomic stock reservation, idempotent checkout, late/duplicate webhook delivery, and provider timeout reconciliation.
6. R2 presign abuse, content length enforcement, abandoned object cleanup, upload CORS and separate bucket policies.
7. Dependency/container vulnerabilities, secrets scanning, backup restoration and least-privileged PostgreSQL user.
8. Content injection/XSS; content body currently renders as plain text, not arbitrary HTML.
