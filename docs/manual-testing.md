# Manual acceptance test plan

**Execution status:** Not executed as part of initial repository creation. Set actual results only after performing each test in the intended environment. Use `Pending`, `Pass`, `Fail`, or `Blocked`; attach a ticket or request ID for failures.

| ID | Area | Preconditions and steps | Expected result | Actual result / notes |
|---|---|---|---|---|
| MAN-001 | Responsive UI | Open storefront on desktop, tablet, and mobile viewport; use keyboard navigation | Layout reflows; controls are focusable and labelled | Pending |
| MAN-002 | Catalog | Seed demo data, browse products, search by product/SKU, apply sort and pagination | API-backed results match selected filters; empty states are clear | Pending |
| MAN-003 | Registration | Configure SMTP, register a new address, inspect delivered email | No OTP is returned by API; OTP is time-limited and single-use | Pending |
| MAN-004 | OTP abuse | Reuse OTP, submit wrong values past limit, resend repeatedly | Replays and excess attempts/resends are rejected and rate-limited | Pending |
| MAN-005 | Password recovery | Request a reset for known and unknown email addresses | Responses avoid account enumeration; one-use reset succeeds only before expiry | Pending |
| MAN-006 | Admin access | Try admin endpoints while anonymous and as a customer | Requests are denied; only authorized admins may perform admin actions | Pending |
| MAN-007 | Object authorization | Try reading another user's request/address/order/upload by changing an ID | No cross-customer data is returned | Pending |
| MAN-008 | Upload policy | Upload allowed, disallowed, oversize, malformed, and mismatched MIME files | Invalid objects are rejected/quarantined; private objects remain private | Pending |
| MAN-009 | Custom print | Create request with owned quarantined asset; review from admin account | Request status/history persists; customer sees only their own requests | Pending |
| MAN-010 | Quote workflow | Draft a quote, attempt access before send, send and expire it, accept/decline | Only valid, current quotes can be accepted; no quote creates paid state by itself | Pending |
| MAN-011 | Payment | Use configured sandbox credentials to test success/failure/timeout | Verified provider data alone drives state; no live charge occurs | Not run: sandbox access and dependencies unavailable |
| MAN-012 | Webhooks | Send invalid/duplicate/out-of-order events to each provider webhook in sandbox | Bad signatures rejected; duplicate delivery is idempotent | Not run: sandbox access and dependencies unavailable |
| MAN-013 | Tax/shipping | Change browser totals and submit invalid PIN/addresses through checkout | Server recomputes totals and enforces configured India-only shipping | Not run: database/API integration environment unavailable |
| MAN-014 | Content | Save draft, verify public route hides it, publish approved copy | Only published content is public; revisions/audit data persist | Pending |
| MAN-015 | HTTPS | Browse both real hostnames and inspect headers/certificates | Valid TLS, secure cookies, strict CORS and security headers | Pending: no live domain configured |
| MAN-016 | Restart/recovery | Restart containers, then restore a backup into isolated DB | Data persists and restore drill is documented with evidence | Pending |
| MAN-017 | VPS resources | Run representative load and monitor process/container memory | Actual capacity is measured; no assumed traffic guarantee | Pending |
| MAN-018 | Rollback | Deploy prior tested revision to staging following a faulty release | Service recovers without deleting persistent volumes | Pending |
| MAN-019 | Inventory adjustment and reservation race | Configure database and a product variant with known stock; attempt a checkout reservation concurrently with an admin adjustment that would reduce stock below the reserved quantity | Database transaction/conditional update prevents stock falling below reserved quantity; movement and audit records are consistent | Not run: database/API integration environment unavailable |
| MAN-020 | Product-image publishing lifecycle | Configure private and public R2 buckets/CORS; upload a permitted image with returned signed headers, complete upload, approve it as admin, then try customer access to private source and remove the published image | Private source is not public; only an authorized admin can publish; public asset metadata and ProductImage association match; removal cleans up safely or leaves an auditable retryable result | Not run: R2 credentials and integration environment unavailable |

Automated test files currently cover only basic money helper behavior. A test file existing is not evidence that tests passed; run the root `npm run test`, `npm run typecheck`, and `npm run build` commands in an environment where dependencies can be installed, then append the actual logs/results.


## Environment execution status

At initial handoff, dependency installation was blocked because the npm registry was unreachable. No browser E2E, API integration, database migration, provider sandbox, Docker image, HTTPS deployment, or backup restoration test was executed. Leave actual result/status fields as NOT RUN until evidence is attached.




## Storage security release checks

| ID | Preconditions | Steps | Expected outcome | Actual | Result | Notes |
|---|---|---|---|---|---|---|
| STO-07 | R2 private bucket CORS configured for exact origins | Obtain a PUT presign, upload the file, then repeat the same PUT with the same URL | First create succeeds; repeat receives a precondition failure; no object can be overwritten | Pending | Not run | Verify `If-None-Match: *` is signed and accepted by R2 |
| STO-08 | R2 private bucket and API configured | Complete a valid file upload, then attempt to reuse its old URL and call complete again | Database points to sealed `private/` key; old URL cannot mutate that object; duplicate completion is rejected safely | Pending | Not run | Inspect R2 object metadata and DB record |
| ADM-OTP-01 | SMTP configured and provisioned admin account | Sign in with admin password, enter wrong OTP up to the configured limit, then try correct/expired/replayed OTP | No session before correct OTP; wrong/expired/replayed codes rejected; successful OTP creates one session | Pending | Not run | Admin email OTP is not phishing-resistant MFA |


## Production configuration fail-closed tests

| ID | Preconditions | Steps | Expected outcome | Actual | Result | Notes |
|---|---|---|---|---|---|---|
| ENV-01 | Test deployment environment and valid staging configuration | Start with `NODE_ENV=production` and `DEPLOYMENT_STAGE` unset or `development`; then try a staging configuration with any live payment credential | Startup rejects missing/development stage; staging rejects live provider credentials | Pending | Not run | Never use actual production credentials in this test |
| STO-09 | `R2_UPLOADS_ENABLED=false` (default) and API running in staging | Call both upload presign and upload-complete endpoints as an authenticated customer | Both respond `503 UPLOADS_DISABLED`; no new object or asset record is created | Pending | Not run | Keep uploads disabled until hard ingress-size cap is independently tested |
