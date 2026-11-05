# Changelog

## Unreleased

- Add `eai login --switch-account`, which sends `prompt=select_account` on
  the authorize request so the browser shows its account picker instead of
  reusing the session it already holds. EAI Setup runs `eai logout` and then
  this command for its Use a different account action. Prepared as 3.20.10.
- `eai login` opens the sign-in directory's AU Admin Portal page first, chosen
  by directory and never by region. School and company emails go straight to
  their own sign-in; other emails get the ordinary sign-in page with the email
  filled in. The CLI still builds the sign-in request itself with fresh state
  and PKCE. `eai login --company` opens the company sign-in page directly, and
  `eai login --direct` (or `EAI_LOGIN_VIA_PORTAL=false`) keeps the earlier flow.
  Directories without a known Portal use the direct flow. `--switch-account`
  applies to the direct flow; the Portal and `--company` flows always ask for
  a fresh sign-in.
- Portal and `--company` sign-ins use `prompt=login` and show the signed-in
  account before saving; a token email that differs from the typed email is
  saved only after `y`. Logins with the company sign-in app pass the stored
  login check, and refresh keeps using that app.
- The local callback answers only `localhost:<port>` requests with the current
  state, keeps waiting after a mismatch, and sends `no-store` and
  `no-referrer` on every response.
- Explain PublicAPI's 502 `FEDERATED_ROUTE_NOT_ENABLED` for company sign-in
  accounts (`E297`).
- The production company sign-in app ID is intentionally unset until that app
  exists, so production `eai login --company` reports that company sign-in
  isn't set up yet.
- Wait out PublicAPI's HTTP 429 in every command: honour `Retry-After`
  (seconds or an HTTP date, capped at 30 s), otherwise back off exponentially
  with full jitter; at most 4 retries within about 90 s, then stop with
  "PublicAPI is busy (rate limited). Wait a minute and try again." The gateway
  refuses before the backend runs, so any method is resent; other statuses
  are not retried. Each wait prints one line on stderr, so JSON output is
  unchanged, and `eai types seed` schema polling stops instead of polling on.

- Support nonempty UTF-8 Markdown KB files (`.md`/`.markdown`) with canonical
  `text/markdown` headers and metadata. Normalize the compatibility alias and
  limit empty/octet/plain MIME fallback to Markdown filenames. Preserve bytes,
  filenames and existing upload/readback/index custody; keep generic resource,
  configured document and typed-CU policies unchanged.

- Reuse safe supported-format guidance when an identity-verified KB indexing
  response explicitly reports an unsupported content type. Keep stored-document
  warnings and all unknown-error, single-request and no-cleanup behavior.

## 3.20.8 — prepared

- Preserve PDF, Word and other filename MIME types for resource file uploads,
  with an optional validated content type.
- Add tenant-explicit Knowledge Base upload and indexing through the existing
  Portal API flow, resolving the workspace's regional API before writing.
- Reject unsupported KB extraction types before record creation, with specific
  safe input errors. General resource and Curate uploads stay unchanged.
- Keep failed, uncertain and pending outcomes visible without automatic retries
  or deletion. Preserve upload-owned file metadata through a readback instead
  of a redundant record update. Configured document and Curate upload behavior
  is unchanged.

This local release preparation has not been published or deployed.
