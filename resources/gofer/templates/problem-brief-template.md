---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
validated-by: Claude + {{User}}
status: draft
---

# Problem Brief: {{feature-name}}

## Problem Statement

**As Stated**: {{original-problem-description}}

**Refined**: {{clearer-version-after-5-whys}}

## Root Cause Analysis (5 Whys)

| Level | Question              | Answer       |
| ----- | --------------------- | ------------ |
| Why 1 | Why {{problem}}?      | Because...   |
| Why 2 | Why {{cause-1}}?      | Because...   |
| Why 3 | Why {{cause-2}}?      | Because...   |
| Why 4 | Why {{cause-3}}?      | Because...   |
| Why 5 | Why {{cause-4}}?      | ROOT CAUSE   |

**Root Cause Summary**: {{one-sentence-root-cause}}

## Stakeholder Impact

| Stakeholder   | Impact Level | Frequency | Cost per Occurrence | Annual Impact   |
| ------------- | ------------ | --------- | ------------------- | --------------- |
| {{role-1}}    | High/Med/Low | {{freq}}  | {{time-or-money}}   | {{estimate}}    |
| {{role-2}}    | High/Med/Low | {{freq}}  | {{time-or-money}}   | {{estimate}}    |

## Business Case

| Metric                        | Value             |
| ----------------------------- | ----------------- |
| Cost of doing nothing (annual)| {{estimate}}      |
| Estimated value of solving    | {{estimate}}      |
| Payback period                | {{weeks-months}}  |
| Confidence level              | High/Med/Low      |

## Success Metrics

| Metric     | Current Baseline | Target   | Measurement Method |
| ---------- | ---------------- | -------- | ------------------ |
| {{metric}} | {{current}}      | {{goal}} | {{how-measured}}   |

## Constraints

| Constraint Type | Description   | Impact on Solution         |
| --------------- | ------------- | -------------------------- |
| Budget          | {{amount}}    | {{how-it-limits-options}}  |
| Timeline        | {{deadline}}  | {{what-must-be-ready}}     |
| Technical       | {{limit}}     | {{what-it-prevents}}       |
| Regulatory      | {{standard}}  | {{what-must-be-compliant}} |

## Problem-Solution Fit

**Software needed?** Yes/No/Partial

**Simpler alternatives considered**:

1. **Process change**: {{description}} — {{why-it-does-or-doesnt-work}}
2. **Existing tool**: {{description}} — {{why-it-does-or-doesnt-work}}
3. **Manual workaround**: {{description}} — {{why-it-does-or-doesnt-work}}

## Assumptions

- [ ] {{assumption-1}} — UNVALIDATED
- [ ] {{assumption-2}} — UNVALIDATED

## Recommendation

**Proceed**: YES/NO/CONDITIONAL
**Confidence**: High/Med/Low
**Rationale**: {{2-3-sentences-plain-english}}

## Approval

- [ ] Problem validated by stakeholder
- [ ] Root cause confirmed
- [ ] Business case accepted
- [ ] Constraints acknowledged
- [ ] Assumptions documented
