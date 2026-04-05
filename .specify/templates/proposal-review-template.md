---
feature: '[Feature Name]'
created: '[ISO timestamp]'
status: pending_review
recommendedScenario: '[short label]'
recommendedArchitecture: '[short label]'
selectedOption: ''
approvedBy: ''
approvedAt: ''
---

<!--
  This template is filled in by /1_gofer_research.
  It is the approval gate between research.md and spec.md.
  Location: .specify/specs/[###-feature-name]/proposal-review.md
-->

# Proposal Review: [Feature Name]

## What We Found

[Short, evidence-backed summary of the research findings]

## Business Scenarios Considered

| Scenario   | User Value | Delivery Trade-off | Recommendation |
| ---------- | ---------- | ------------------ | -------------- |
| [Option 1] | [Value]    | [Trade-off]        | [Adopt/defer]  |
| [Option 2] | [Value]    | [Trade-off]        | [Adopt/defer]  |

## Recommended Business Scenario

[What should be specified next and why]

## Technology Architecture Recommendation

### Recommended Architecture

[Plain-language architecture direction]

### Architecture Options

| Option     | Why choose it | Why not choose it now |
| ---------- | ------------- | --------------------- |
| [Option 1] | [Benefit]     | [Trade-off]           |
| [Option 2] | [Benefit]     | [Trade-off]           |

## Key Decisions and Why

- [Decision]: [Rationale]
- [Decision]: [Rationale]

## What Can Change Before Specification

- Scope changes the user may request
- Architecture changes the user may request
- Options that can be revisited before writing `spec.md`

## Open Questions

- [ ] [Question needing user input]
- [ ] [Another question]

## User Feedback and Overrides

- Pending user review

## Approval

- Status: pending_review
- Next action: user approves or requests changes before `/2_gofer_specify`
