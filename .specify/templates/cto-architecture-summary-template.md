---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
updated: '{{ISO-timestamp}}'
audience: cto-architecture
source_inputs:
  - plan.md
  - contract-pack.md
  - data-model.md
  - service-fit-matrix.md
  - eai-preflight.md
  - visuals/c4-context.md
  - visuals/c4-container.md
  - .specify/memory/brand-profile.json
---

# CTO Architecture Summary: {{feature-name}}

## Executive Summary

{{three-sentence-architecture-summary}}

## Branding And Presentation

Use the approved brand profile for document styling while keeping diagrams
source-controlled, readable in monochrome, and linked to architecture evidence.
If a branded Marp deck is produced, use the approved theme path from
`.specify/memory/brand-profile.json`.

## Architecture Direction

| Decision                   | Direction                             | Rationale                  | Evidence |
| -------------------------- | ------------------------------------- | -------------------------- | -------- |
| Primary platform           | EAI Platform                          | {{why-eai-platform}}       | {{path}} |
| Cloud/supporting substrate | Azure-first unless exception approved | {{why-azure-or-exception}} | {{path}} |
| App template / UI blocks   | {{eai-app-template-or-na}}            | {{block-rationale}}        | {{path}} |
| Integration model          | {{integration-model}}                 | {{rationale}}              | {{path}} |

## EAI Platform Fit

| Capability     | EAI Platform service / template asset | Fit status                                 | Evidence |
| -------------- | ------------------------------------- | ------------------------------------------ | -------- |
| {{capability}} | {{service-or-block}}                  | {{accessible-now-purchasable-unavailable}} | {{path}} |

## Auth, Tenancy, Data, And Contracts

| Area                 | Summary                         | Evidence |
| -------------------- | ------------------------------- | -------- |
| Authentication       | {{auth-summary}}                | {{path}} |
| Authorization        | {{authorization-summary}}       | {{path}} |
| Tenant boundaries    | {{tenant-boundary-summary}}     | {{path}} |
| Data model           | {{object-types-and-data-model}} | {{path}} |
| API/events/contracts | {{contract-summary}}            | {{path}} |

## Diagrams

| Visual                                      | Question answered                                               | Evidence / render proof                 | Freshness             |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- | --------------------- |
| C4 context: `visuals/c4-context.md`         | Who uses the system and what external systems does it rely on?  | {{path-or-render-proof}}                | {{fresh-stale-or-na}} |
| C4 container: `visuals/c4-container.md`     | What deployable/runtime parts exist and where does code belong? | {{path-or-render-proof}}                | {{fresh-stale-or-na}} |
| Data model ERD: `visuals/data-model-erd.md` | What objects/data relationships must be preserved?              | {{path-or-render-proof}}                | {{fresh-stale-or-na}} |
| Sequence/state/value/risk visuals           | What flow, lifecycle, business process, or risk needs review?   | {{path-or-render-proof}}                | {{fresh-stale-or-na}} |
| Presentation deck: `presentation.marp.md`   | What is the simple architecture story for stakeholder review?   | {{path-or-render-proof-or-skip-reason}} | {{fresh-stale-or-na}} |

Visuals should be simple enough for a reviewer to understand without external
docs: one question per visual, about seven or fewer primary nodes/steps where
practical, a plain-language preamble, Mermaid/source-controlled source or text
fallback, Marp when slides help, and links back to requirements, code/tests, and
EAI Platform evidence.

## Architecture Risks And Open Questions

| Risk / question | Impact     | Owner              | Next action     |
| --------------- | ---------- | ------------------ | --------------- |
| {{risk}}        | {{impact}} | CTO / Architecture | {{next-action}} |

## Review Ask

CTO / Architecture should approve, revise, or defer:

- EAI Platform and Azure direction.
- Auth, tenant, data, and integration model.
- Any non-EAI or non-Azure exception with owner, expiry, and evidence.
