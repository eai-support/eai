---
feature: 342-governed-documentation-experience
spec: spec.md
status: in-progress
created: 2026-09-23
author: Enterprise AI
updated: 2026-09-24
---

# Delivery Plan

## Architecture

`Docusaurus Docs -> same-origin Website /api/chat -> PublicAPI scoped docs route -> EAI Platform public knowledge index`.

Git is the content source. The public index is a derived projection. The Docs
site never receives a platform credential. The Website owns rate limits,
telemetry, consent checks, and public response shaping.

## Technical Context

- Docusaurus and React render public documentation.
- The Website `POST /api/chat` endpoint is the only public AI boundary.
- PublicAPI supplies the published scoped documentation capability.
- Payload CMS stores authorised feedback records only.
- The semantic index stores a title and canonical public path for each source.

## Implementation Phases

1. Define contracts and automated evaluation before behavioural changes.
2. Deliver Website governance and Test-only telemetry storage.
3. Deliver Docs search, feedback, and accessibility behaviour.
4. Deliver the public MCP read interface.
5. Validate in Test, then promote only with release evidence.
6. Block each environment release until the deployed Docs assistant journey
   passes in a browser.

## Remaining Implementation Contracts

### Public Machine Interface

- Publish a read-only Docs manifest and retrieval interface over the approved
  Website and Docs corpus only.
- The interface must expose no tenant, user, customer, configuration, secret,
  or internal URL data; it must not provide write tools.
- Contract tests must prove that an allowlisted public document is returned and
  non-public routes and mutation tool names are rejected.

### Test Evidence Gate

- A Test-only evaluator job must run automated accessibility and visual checks
  against the Search and Ask drawer.
- It must produce the versioned receipt defined in
  `evaluation.md`; the promotion workflow may continue only when the receipt
  meets all thresholds and a release approver accepts the evidence.

### Deterministic Release Gate

- The Docs website build sets the assistant endpoint to `/api/chat`.
- The generated Docs copy is merged into the Website repository before the
  Website deployment tag is created.
- Dev, Test, and Prod run the same deployed browser scenario: open
  `/docs/eai/docs/installer-setup`, submit `what is gofer`, receive a response,
  and display at least one `enterpriseaigroup.com` citation.
- Local validation builds Docs with its explicit development assistant endpoint
  and verifies the same question before a pull request is opened.
- The promotion workflow runs this check unconditionally. A health response or
  static build alone is not release evidence.

## Non-Goals

- No anonymous write operations.
- No production credential in browser code.
- No customer or tenant data in public retrieval, telemetry, or MCP.
