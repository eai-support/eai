---
feature: 342-governed-documentation-experience
spec: spec.md
status: ready
created: 2026-09-23
author: Enterprise AI
updated: 2026-09-23
---

# Delivery Plan

## Architecture

`Docusaurus Docs -> Website /api/chat -> PublicAPI scoped docs route -> EAI Platform public knowledge index`.

Git is the content source. The public index is a derived projection. The Docs
site never receives a platform credential. The Website owns rate limits,
telemetry, consent checks, and public response shaping.

## Technical Context

- Docusaurus and React render public documentation.
- The Website `POST /api/chat` endpoint is the only public AI boundary.
- PublicAPI supplies the published scoped documentation capability.
- Payload CMS stores authorised feedback records only.

## Implementation Phases

1. Define contracts and automated evaluation before behavioural changes.
2. Deliver Website governance and Test-only telemetry storage.
3. Deliver Docs search, feedback, accessibility, and preview behaviour.
4. Deliver Test-only developer explorer and public MCP read interface.
5. Validate in Test, then promote only with release evidence.

## Remaining Implementation Contracts

### Test-only Explorer

- The browser receives no platform credential.
- A Website-side broker exchanges the authenticated Test administrator session
  for a single-use, short-lived read-only capability.
- The capability must be audience-bound to the Test PublicAPI, expire within
  five minutes, and allow only an explicit OpenAPI route allowlist.
- Negative tests must prove that write methods, Production hosts, tenant data,
  and expired or replayed capabilities are rejected.

### Public Machine Interface

- Publish a read-only Docs manifest and retrieval interface over the approved
  Website and Docs corpus only.
- The interface must expose no tenant, user, customer, configuration, secret,
  or internal URL data; it must not provide write tools.
- Contract tests must prove that an allowlisted public document is returned and
  non-public routes and mutation tool names are rejected.

### Preview and Evidence Gate

- Each Docs pull request must build a unique, disposable preview URL.
- The preview job must run automated accessibility and visual checks against
  the Search and Ask drawer.
- A Test-only evaluator job must produce the versioned receipt defined in
  `evaluation.md`; the promotion workflow may continue only when the receipt
  meets all thresholds and a release approver accepts the evidence.

## Non-Goals

- No anonymous write operations.
- No production credential in browser code.
- No customer or tenant data in public retrieval, telemetry, MCP, or previews.
