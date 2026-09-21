---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
updated: '{{ISO-timestamp}}'
stage: '{{gofer-stage}}'
source_inputs:
  - .specify/memory/brand-profile.json
---

# Stakeholder Review Index: {{feature-name}}

This index tells the operator what stakeholder-facing documents Gofer has built
or updated at the current stage and what needs review before proceeding.

## Documents Ready For Review

| Document                             | Audience                    | Purpose                                                                              | Status     | Review ask                                                                                         |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| `working-backwards-prfaq.md`         | All stakeholders            | Product release PR/FAQ and internal FAQ                                              | {{status}} | {{ask}}                                                                                            |
| `business-owner-summary.md`          | Business Owner              | Business scenario, process, business case, value and assumptions                     | {{status}} | {{ask}}                                                                                            |
| `cto-architecture-summary.md`        | CTO / Architecture          | EAI Platform, Azure, auth, tenancy, data, and contracts                              | {{status}} | {{ask}}                                                                                            |
| `ciso-security-summary.md`           | CISO / Risk                 | Controls, residual risks, security evidence, launch gates                            | {{status}} | {{ask}}                                                                                            |
| `stakeholder-pack.md` and `visuals/` | All stakeholders / AI loops | Simple diagrams, screenshots, heatmaps, and text fallbacks that explain what changed | {{status}} | Confirm each visual answers one review question, renders or has a fallback, and links to evidence. |
| `presentation.marp.md`               | Executives / reviewers      | Simple slide narrative for substantive stakeholder-facing changes                    | {{status}} | Confirm slides start with an executive summary and only skip when Markdown is clearer.             |

Every human-facing document should begin with a three-to-five-bullet executive
summary that explains the decision, value, risk, evidence, and next ask in
simple language.

Brand status should be visible in the review ask when a company, client, or
consulting-firm presentation style is required. If brand approval is pending,
mark the document content review separately from the visual/brand approval.

## Stage Snapshot

| Stage                | Snapshot path                           | What changed | Reviewer focus            |
| -------------------- | --------------------------------------- | ------------ | ------------------------- |
| `/0_gofer_start`     | `prfaq-history/00-business-scenario.md` | {{summary}}  | Business Owner            |
| `/1_gofer_research`  | `prfaq-history/01-research.md`          | {{summary}}  | Business Owner / CTO      |
| `/2_gofer_specify`   | `prfaq-history/02-specify.md`           | {{summary}}  | Business Owner            |
| `/3_gofer_plan`      | `prfaq-history/03-plan.md`              | {{summary}}  | CTO / Architecture        |
| `/4_gofer_tasks`     | `prfaq-history/04-tasks.md`             | {{summary}}  | Delivery                  |
| `/5_gofer_implement` | `prfaq-history/05-implement.md`         | {{summary}}  | Business Owner / Delivery |
| `/6_gofer_validate`  | `prfaq-history/06-validate.md`          | {{summary}}  | CISO / Risk               |

## Review Response Contract

Ask reviewers to respond with:

- `approve`: this document is correct enough to proceed.
- `revise <document> <section>`: Gofer should update the named section.
- `defer <reason>`: the decision is blocked and must be tracked.
- `revise visuals <artifact>`: Gofer should simplify, split, re-render, or
  retrace the named visual before the next stage.
