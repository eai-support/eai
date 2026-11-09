# Implementation Plan: Mintlify-Style Documentation Experience

## Decision

Keep Docusaurus. Add an owned experience layer on top of the existing Git-generated documentation pipeline.

## Architecture

```text
.tech-docs + CLI metadata
        |
        +-- release generators --> llms.txt, error guidance, CLI help
        +-- experience generator --> docs-search-index.json
                                      |
                                      v
Docusaurus UI: home, search, assistant, request builder, feedback
                                      |
                                      v
GitHub Pages and enterpriseaigroup.com static copy
```

## Delivery Scope

1. Replace the default visual system with an Enterprise AI documentation design.
2. Add task-led landing pages and navigation.
3. Generate a local search index from public documentation.
4. Add search and source-linked assistant components.
5. Add a safe API request builder.
6. Add optional feedback URL support.
7. Add build checks for the new assets.
8. Make the public EAI Setup installer the default desktop onboarding path and retain manual CLI setup as an alternative.

## Explicit Limits

- No external AI model, paid search service, or analytics provider is configured.
- No authenticated API playground is added. The request builder produces a redacted command only.
- No external MCP server is deployed. Existing `llms.txt` output remains the agent integration path.

## Validation

- `npm run docs:experience-assets`
- `npm run docs:experience-assets:check`
- `cd docs-site && npm ci && npm run build`
- Existing API and release documentation checks
- Browser-level checks against the built site when available
