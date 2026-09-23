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

## Non-Goals

- No anonymous write operations.
- No production credential in browser code.
- No customer or tenant data in public retrieval, telemetry, MCP, or previews.
