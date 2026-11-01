# Cloudflare R2 storage

## Required bucket design

Create two separate R2 buckets:

1. **Private bucket** (`R2_BUCKET_NAME`): all incoming uploads, including candidate product images; public access disabled.
2. **Public product-image bucket** (`R2_PUBLIC_BUCKET_NAME`): only administrator-approved product imagery. A custom domain/public read path may expose this bucket, so never place private files in it. The buckets must be distinct.

Use backend-only R2 access keys with the minimum required read/write/delete/list access to those buckets. `R2_ENDPOINT` should be the account's S3-compatible endpoint, typically `https://<account-id>.r2.cloudflarestorage.com`. Set `R2_PUBLIC_BASE_URL` to the public product-image hostname only after it is configured and verified. The example schema expects the public object key to be served at `{R2_PUBLIC_BASE_URL}/products/...`.

## Upload flow currently implemented

- Client asks `/api/v1/uploads/presign` after authentication with file name, content type, size and purpose.
- Backend allowlists model extensions STL/3MF/OBJ and reference/product image PNG/JPEG/WEBP; MIME type must match the extension mapping.
- Backend creates a random `incoming/` object key and asset row, then signs a short-lived PUT that includes `If-None-Match: *`; the key can be created once, not overwritten. `Content-Type` and metadata headers are part of the signed request.
- Browser sends a direct PUT to R2 (bucket CORS must allow the exact deployed storefront/admin origins, `PUT`, and the signed `Content-Type`, `x-amz-meta-assetid`, and `x-amz-meta-ownerid` headers).
- Client calls `/api/v1/uploads/complete`; backend checks actual length, content type and signed metadata, checks a small file signature sample, and rejects/deletes obvious mismatches.
- Completion checks size, MIME metadata, ownership metadata and format signature, then conditionally copies the inspected source using its ETag into a new random `private/` key. The database references only the sealed key; the incoming source is deleted best-effort. A still-valid upload URL can therefore not mutate a file after it is linked for review. Successful completion becomes `QUARANTINED`. The admin can obtain a 120-second signed attachment download URL. Files are not treated as safe or manufacturable based on that status.
- For product images, the admin upload form selects a product, requires descriptive alt text and an explicit publish confirmation, then calls the approval endpoint. The API rechecks source metadata, copies to the public bucket, checks the destination metadata and length, writes the `ProductImage` record and audit log in a transaction, and best-effort removes the private source. Failed/competing state transitions do not create a product link.
- Admins can reject quarantined product images or remove an already-linked image. Database links are updated before best-effort object cleanup; a cleanup failure is logged for operational follow-up.

## Gaps before production

- The API enforces declared per-file limits and per-user count/byte quotas, and verifies actual object length after upload. It does not yet enforce a hard content-length cap at the R2 edge before bytes are stored. Add a streaming upload gateway or a proven provider-supported signed size constraint before public launch; also configure daily account/bucket limits and an alert for unusual storage growth.
- Full object signature, checksum and archive validation is incomplete. The `3MF` check currently recognizes a ZIP header, not a safe/valid archive. Run decompression only in an isolated worker with file-count, uncompressed-size, nesting and CPU limits.
- Bulk image library management, image replacement/reordering across existing galleries, and automatic orphan cleanup are still incomplete. The primary upload/publish/remove path is implemented but must be tested with real R2 buckets and CORS before launch.
- Configure private-bucket CORS to allow only the deployed storefront/admin origins, `PUT`, and the exact headers `content-type`, `if-none-match`, `x-amz-meta-assetid`, and `x-amz-meta-ownerid`. Expose only `ETag` if the browser needs it. Configure a lifecycle rule to delete stale `incoming/` keys after 1 day (completed assets are copied to `private/`), a retention policy for customer files, bucket access logging, and an object recovery strategy.
- Rotate keys; never expose R2 access key/secret to `VITE_*` frontend variables.

## Production upload activation gate

`R2_UPLOADS_ENABLED` defaults to `false`; the API returns `503 UPLOADS_DISABLED` for new presigns and completions while it remains false. Keep it false on public production until a tested upload gateway, Cloudflare edge rule, or other provider-supported control enforces the configured maximum body size before the object is stored. The current direct presigned PUT flow checks actual object size only after upload, so metadata validation and hourly quotas are not a substitute for a hard ingress limit. Enable this flag only after validating the cap with oversized requests from an external client and recording the evidence.
