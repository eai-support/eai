---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
updated: '{{ISO-timestamp}}'
audience: business-owner
source_inputs:
  - problem-brief.md
  - discovery.md
  - spec-summary.md
  - business-metrics.md
  - visuals/value-stream-asis.md
  - visuals/value-stream-tobe.md
  - visuals/roi-projection.md
  - .specify/memory/brand-profile.json
---

# Business Owner Summary: {{feature-name}}

## Executive Summary

{{three-sentence-business-summary}}

## Branding And Presentation

Apply approved brand profile values for logo, color, typography, header, footer,
and confidentiality label. If branding is pending, keep the neutral Gofer
presentation style and keep the business content unchanged.

## Business Scenario

| Area                  | Summary                |
| --------------------- | ---------------------- |
| Current problem       | {{problem}}            |
| Who is affected       | {{personas-or-teams}}  |
| Process affected      | {{process}}            |
| Cost of doing nothing | {{cost-risk-delay}}    |
| Target outcome        | {{measurable-outcome}} |

## Process Change

| Before                   | After                          | Business benefit |
| ------------------------ | ------------------------------ | ---------------- |
| {{current-step-or-pain}} | {{future-step-or-improvement}} | {{benefit}}      |

## Business Case

| Metric     | Baseline     | Target     | Evidence        |
| ---------- | ------------ | ---------- | --------------- |
| {{metric}} | {{baseline}} | {{target}} | {{source-path}} |

## Visual Review Pack

| Visual                                             | Business question answered                                   | Evidence / render proof                 | Review status |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- | ------------- |
| Value stream as-is: `visuals/value-stream-asis.md` | Where does the current process lose time, quality, or value? | {{path-or-render-proof}}                | {{status}}    |
| Value stream to-be: `visuals/value-stream-tobe.md` | What changes for the user or team after launch?              | {{path-or-render-proof}}                | {{status}}    |
| ROI projection: `visuals/roi-projection.md`        | Why is the business case worth doing now?                    | {{path-or-render-proof}}                | {{status}}    |
| UI screenshot/storyboard, if applicable            | What will the user see or do first?                          | {{path-or-render-proof}}                | {{status}}    |
| Presentation deck: `presentation.marp.md`          | What is the simple story for business review?                | {{path-or-render-proof-or-skip-reason}} | {{status}}    |

## Scope For Business Review

### Included

- {{included-capability}}

### Not Included

- {{excluded-capability-and-reason}}

## Assumptions And Decisions Needed

| Assumption / decision      | Owner          | Status               | Evidence |
| -------------------------- | -------------- | -------------------- | -------- |
| {{assumption-or-decision}} | Business Owner | {{open-or-approved}} | {{path}} |

## Review Ask

Business Owner should respond with one of:

- `approve`: scenario, value case, and process summary are right.
- `revise <section>`: changes are needed before Gofer proceeds.
- `defer <reason>`: decision is blocked and should be tracked.
