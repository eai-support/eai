---
id: 342-governed-documentation-experience
title: Governed Documentation Experience
status: ready
created: 2026-09-23
author: Enterprise AI
updated: 2026-09-23
---

# Governed Documentation Experience

**Issue:** #342  
**Status:** In progress - foundation merged; Test and release gates remain

## Outcome

Provide public documentation with local and semantic search, cited answers,
privacy-preserving learning signals, and safe developer guidance. Git remains
the documentation source of truth. The Website chat API remains the only public
AI entry point.

## Selected Approach

Use the published, scoped PublicAPI Docs capability through the Website chat API.
Docusaurus stays a public client and never calls an internal service route.

## User Scenarios

1. A visitor receives matching public guides or a cited answer.
2. An administrator reviews consented, privacy-safe feedback.
3. A developer uses Test-only, read-only documentation tooling.

## Requirements

- FR-001: Use only the approved public Docs and Website corpus.
- FR-002: Return a citation with every answer, or a clear no-answer response.
- FR-003: Rate limit public use and store only privacy-safe telemetry.
- FR-004: Keep feedback consented and restricted to authorised administrators.
- FR-005: Keep explorer and MCP surfaces read-only and allowlisted.

## Success Criteria

- SC-001: Meet the reproducible thresholds in `evaluation.md`.
- SC-002: Do not return a secret, internal path, tenant ID, or unapproved URL.

## Architecture Boundaries

- Docusaurus renders only approved public documentation.
- The Docs drawer calls the Website `/api/chat` endpoint.
- The Website calls the scoped EAI Platform knowledge route and returns citations.
- No public Docs surface receives tenant data, write tools, long-lived tokens,
  secrets, or customer records.

## Delivery PRs

1. **PR A - Specification and evaluation contract:** source allowlist, answer
   evaluation dataset, citation/latency thresholds, privacy schema, and CI gates.
2. **PR B - Website assistant governance:** rate limit, structured telemetry,
   consented feedback intake, and retrieval quality metrics.
3. **PR C - Docs experience:** semantic filters, zero-result recovery,
   accessible drawer behaviour, and feedback status.
4. **PR D - Developer and release experience:** Test-only read-only explorer,
   public Docs MCP interface, and Test evidence validation.

## Delivered Evidence

- Docs filtering, recovery, keyboard drawer behaviour, and consented feedback:
  PRs #344 and #346.
- Versioned cited-answer evaluator: PR #347.
- Website consented feedback storage and Docs CORS support: Website PR #378.
- Website public-assistant rate limiting and privacy-safe operational telemetry:
  Website PRs #376 and #379.

The delivered foundation has not yet satisfied the Test-only explorer, machine
interface or live Test evidence acceptance criteria below.

## Acceptance Criteria

- Every assistant answer has at least one approved citation or returns a clear
  no-answer response.
- Automated evaluation proves citation precision, answer latency, and refusal
  behaviour against the approved public corpus.
- Search supports local results and semantic Docs/Website filtering.
- Feedback stores only consented, privacy-preserving fields and is visible to
  authorised administrators.
- The explorer accepts only short-lived Test credentials with read-only scope.
- The MCP interface exposes only the approved public corpus.
- Each Docs PR receives CI validation. Accessibility, visual, and live citation
  checks run as part of the Test evidence gate.
- Production promotion requires green CI, Test evidence, and release approval.
