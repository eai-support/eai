# Changelog

## Unreleased

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
