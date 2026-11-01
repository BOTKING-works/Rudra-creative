# Authentication and session flows

## Registration and email verification

1. Browser requests `GET /api/v1/auth/csrf` and receives a signed CSRF token cookie and JSON value.
2. Browser sends email/password to `POST /auth/register` with cookie credentials and the `X-CSRF-Token` header.
3. API normalizes email, validates the password, hashes it with Argon2id, creates a user and a short-lived OTP challenge, and sends the six-digit code via SMTP.
4. Only the challenge ID and expiry are returned. The plaintext OTP is never stored or logged.
5. `POST /auth/verify-email-otp` validates expiry/attempt count/digest in constant-time comparison, consumes the challenge once, verifies the account, creates an opaque server-side session and rotates CSRF token.

## Login/logout

Customer login requires a correct password, active user and verified email. Administrator and super-administrator logins additionally require a short-lived, single-use email OTP challenge before a session is created; a successful password check alone does not establish an admin session. The raw random session token is set in an HttpOnly cookie; only its HMAC digest is stored in PostgreSQL. Authentication middleware checks token hash, expiry and active account on each protected request. Logout deletes the current session record and clears the cookie. Password reset revokes sessions. Admin email OTP is an additional challenge, not an independent phishing-resistant factor; consider hardware-backed MFA before granting high-value administrative access.

## Password recovery

For eligible accounts, the API stores a SHA-256 digest of a high-entropy random one-time token and emails the raw token. The reset endpoint requires email, token and a strong new password, consumes the challenge once and revokes all active sessions. Do not put reset tokens in logs or analytics. Consider using a short-lived reset URL and `Referrer-Policy: no-referrer` on the reset route when its UI is completed.

## Limits and operations

OTP lifetime, attempts, resend cooldown and per-user hourly quota are environment-configured. A general auth limiter also applies to the auth route group. IP-specific OTP and recovery quotas need a durable shared implementation before multi-instance deployment. Configure SMTP and test delays, retries, bounce handling, sender domain authentication and rate limits before launch.
