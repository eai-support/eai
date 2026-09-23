# Public Contracts

## Assistant

`POST /api/chat` accepts a public question and optional `surface` value. It
returns an answer, zero or more approved citations, and a public error category.
It must not return platform identifiers, internal source paths, credentials, or
tenant data.

## Telemetry

Store only: timestamp, hashed session ID, surface, latency bucket, result count,
citation count, public failure category, and explicit feedback rating. Do not
store IP addresses, raw conversation history, email, or access tokens.

## Explorer and MCP

Both surfaces are Test-only or public-read-only. Their allowlist contains only
published documentation and read operations. Deny-by-default applies to every
unlisted tool, route, document, and object type.
