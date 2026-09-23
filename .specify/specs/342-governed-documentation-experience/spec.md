# Governed Documentation Experience

**Issue:** #342  
**Status:** Specified for staged delivery

## Outcome

Provide public documentation with local and semantic search, cited answers,
privacy-preserving learning signals, and safe developer guidance. Git remains
the documentation source of truth. The Website chat API remains the only public
AI entry point.

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
   public Docs MCP interface, and short-lived PR preview deployments.

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
- Each Docs PR receives a disposable preview and automated accessibility,
  visual, and live citation checks.
- Production promotion requires green CI, Test evidence, and release approval.
