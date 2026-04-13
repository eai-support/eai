---
description: 'GitHub issues template - ready to convert to actual GitHub issues'
---

# GitHub Issues: [FEATURE NAME]

**Generated from**: tasks.md **Feature ID**: [###-feature-name] **Total
Issues**: [COUNT]

This file contains GitHub-ready issue definitions for each task. Each issue
follows the Requirements Ticket template from enterpriseaigroup/Issues2025.

---

## Issue #1: [Task ID] - [Task Title]

**Labels**: `enhancement`, `phase-1-setup`, `[story-label]` **Assignees**:
@MikeNowosadko **Title**: [Feature]: [Task Description]

### Screen described (Mike)

[Description of the UI/functionality this task creates or modifies. If
backend-only, describe the API/service behavior.]

### Business Rationale

**Problem**: [What problem does this task solve?]

**Value**: [What value does completing this task provide?]

**Impact**: [How does this contribute to the overall feature goal?]

**Priority**: [P1/P2/P3] - [Reason for priority level]

### Fields required (Mike)

| Field        | Type                        | Source                      | Validation         |
| ------------ | --------------------------- | --------------------------- | ------------------ |
| [field-name] | [string/number/boolean/etc] | [where the data comes from] | [validation rules] |

[If no fields: "N/A - This is a backend/infrastructure task"]

### Acceptance Criteria

- [ ] [Specific testable condition 1]
- [ ] [Specific testable condition 2]
- [ ] [Specific testable condition 3]

### Data needed (Mike)

[What data entities, sources, and APIs does this task require?]

**Entities**: [Entity name and description]

**Sources**: [System/API name and what data it provides]

### Integrations Needed (Team)

[External or internal systems this task must integrate with]

[If no integrations: "N/A - Standalone implementation"]

### Navigation (Mike)

[How users reach this functionality, or how this code is accessed]

### Blocks needed (Team)

**New Components**: [List components to build]

**Reusable Components**: [List components to reuse]

### Definition of Ready

- [ ] Mock up screen signed off (Mike)
- [ ] Business Content (Mike)
- [ ] Screen Understood by Dev team (Mike, Gareth & Team)
- [ ] Requirements Documented: Data (Mike & Team)
- [ ] Requirements Documented: Integrations (Mike & Team)
- [ ] Requirements Documented: Navigation (Mike & Team)
- [ ] Requirements Documented: Fields (Mike & Team)
- [ ] Requirements Documented: Blocks (Mike & Team)
- [ ] Dependencies Identified
- [ ] AC Agreed
- [ ] Identify if we can re-use components (Doug)
- [ ] Effort is sized and prioritised

### Definition of Done

- [ ] Functional: Works as described in acceptance criteria
- [ ] Documented: Architecture changes and implementation documented
- [ ] Demonstrated: Can show it working
- [ ] Stable: No critical bugs
- [ ] Reviewed: PO confirmed

**File Path**: `[file-path-from-task]` **Estimated Effort**: [S/M/L or hours]

---

## Notes

- This template is auto-populated by: `.specify/scripts/node/generate-issues.js`
- Run after creating tasks.md:
  `node .specify/scripts/node/generate-issues.js <feature-dir>`
- All issues follow the enterprise Requirements Ticket template
- See tasks.md for complete task definitions
