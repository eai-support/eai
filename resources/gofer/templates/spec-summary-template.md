---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
audience: business-stakeholders
spec-reference: spec.md
---

# {{feature-name}} — Executive Summary

## What We're Building

{{3-sentence-plain-english-summary-of-the-feature}}

## Why It Matters

**Problem**: {{from-problem-brief-root-cause}}
**Impact**: {{from-problem-brief-annual-impact}}
**Solution**: {{one-sentence-how-this-fixes-it}}

## What Changes for Users

| Who                | Before (Today)    | After (With This Feature) |
| ------------------ | ----------------- | ------------------------- |
| {{user-role-1}}    | {{current-pain}}  | {{improved-experience}}   |
| {{user-role-2}}    | {{current-pain}}  | {{improved-experience}}   |

## Implementation Approach

**Selected Option**: Option {{N}} — {{name}}
**Complexity**: {{Low/Medium/High}}
**Estimated Effort**: {{timeframe}}

### What's Included

- {{capability-1-in-plain-english}}
- {{capability-2-in-plain-english}}
- {{capability-3-in-plain-english}}

### What's NOT Included

- {{exclusion-1}} — {{why-excluded-or-planned-for-later}}
- {{exclusion-2}} — {{why-excluded-or-planned-for-later}}

## Risk Assessment

| Risk                          | Likelihood | Impact | Mitigation              |
| ----------------------------- | ---------- | ------ | ----------------------- |
| {{business-risk-1}}           | Low/Med/Hi | Low/Med/Hi | {{how-we-handle-it}} |
| {{business-risk-2}}           | Low/Med/Hi | Low/Med/Hi | {{how-we-handle-it}} |

## ROI Estimate

| Metric                    | Value          |
| ------------------------- | -------------- |
| Development cost estimate | {{estimate}}   |
| Annual value delivered    | {{estimate}}   |
| Payback period            | {{timeframe}}  |
| Break-even point          | {{date}}       |

## Key Assumptions

These assumptions underpin the business case. If any prove false, the plan
may need adjustment:

1. {{critical-assumption-1}} — {{status: VALIDATED/UNVALIDATED}}
2. {{critical-assumption-2}} — {{status: VALIDATED/UNVALIDATED}}

## Decision Points

Before implementation proceeds, the following decisions are needed:

- [ ] **Approve scope**: Is the included/excluded list correct?
- [ ] **Confirm budget**: Is the estimated effort acceptable?
- [ ] **Accept risks**: Are the identified risks manageable?
- [ ] **Validate assumptions**: Are the key assumptions reasonable?

## How We'll Measure Success

| Success Metric | Target          | When We'll Know  |
| -------------- | --------------- | ---------------- |
| {{metric-1}}   | {{target}}      | {{timeframe}}    |
| {{metric-2}}   | {{target}}      | {{timeframe}}    |

---

*This is a business summary. For full technical specification, see `spec.md`.*
*For implementation details, see `plan.md`.*
