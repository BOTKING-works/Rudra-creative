# Legal and business content operations

The platform must not invent business identity, registration data, GSTIN, tax treatment, or legal policies. Legal copy is owner-supplied and should be reviewed by an appropriate professional before publication.

## Current publishing workflow

The API and separate admin app support plain-text content pages with draft/published/archived states, preview, and stored revision records. The editor intentionally avoids arbitrary HTML to reduce stored-XSS risk. Revision restore is not implemented; inspect prior revisions from the protected API before manually reapplying owner-approved content.

For each page:

1. Prepare approved text for the relevant slug (terms, privacy, shipping, returns, cancellations, custom-print terms, warranty/limitations, contact, about, FAQ, and cookie notice where applicable).
2. Sign in to the separate admin app, open **Content Management**, edit the existing slug or create a page, and save it as a draft.
3. Read the saved page back and review the rendered storefront output on desktop and mobile.
4. Confirm placeholders such as `[BUSINESS NAME]` or `[SUPPORT EMAIL]` have been replaced. The server blocks publishing mandatory pages that appear to contain known placeholder markers, but that check is not legal review.
5. Use the editor preview, select **Published**, and save only after owner approval. Verify the public page and retain revision history.

Do not add HTML or script tags to this content. If a rich text editor is introduced later, sanitize on the server using a maintained allowlist sanitizer and test stored/reflected XSS cases.
