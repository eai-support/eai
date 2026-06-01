---
feature: '[Feature Name]'
session: 1
previousSession: null
created: '[ISO timestamp]'
contextUsage: '[N%]'
stage: '[current stage]'
---

# Session Handoff: [Feature Name]

## Session Summary

**Session**: #[N] of [Feature Name] implementation **Date**: [ISO timestamp]
**Stage at End**: [1_research / 2_specify / 3_plan / 4_tasks / 5_implement /
6_validate] **Context Usage**: [N%] at session end

---

## Work Completed

### This Session

- [x] [Major accomplishment 1]
- [x] [Major accomplishment 2]
- [x] [Major accomplishment 3]

### Cumulative Progress

| Stage       | Status         | Notes                          |
| ----------- | -------------- | ------------------------------ |
| 1_research  | ✓ Complete     | research.md created            |
| 2_specify   | ✓ Complete     | spec.md created                |
| 3_plan      | ✓ Complete     | plan.md, data-model.md created |
| 4_tasks     | ✓ Complete     | tasks.md with N tasks          |
| 5_implement | ⏳ In Progress | N/M tasks complete             |
| 6_validate  | ○ Not Started  | -                              |

---

## Current State

### Files Modified This Session

| File               | Change Type | Description    |
| ------------------ | ----------- | -------------- |
| `path/to/file1.ts` | Created     | [What it does] |
| `path/to/file2.ts` | Modified    | [What changed] |

### Git State

```
Branch: [branch-name]
Last Commit: [commit hash] - [commit message]
Uncommitted Changes: [yes/no - list if yes]
```

### Build/Test Status

- **Build**: [✓ Passing / ✗ Failing - reason]
- **Tests**: [✓ N/N passing / ✗ N failures - list]
- **Lint**: [✓ Clean / ⚠️ N warnings / ✗ N errors]
- **Types**: [✓ Valid / ✗ N errors]

---

## Next Steps

### Immediate (Next Session)

1. [ ] [First thing to do when resuming]
2. [ ] [Second thing to do]
3. [ ] [Third thing to do]

### Remaining Work

From tasks.md, the following remains:

- [ ] [Task ID]: [Description]
- [ ] [Task ID]: [Description]
- [ ] [Task ID]: [Description]

**Estimated Remaining**: [N] tasks across [N] phases

---

## Key Decisions Made

Decisions that MUST be preserved for context continuity:

### Decision 1: [Topic]

- **What**: [The decision made]
- **Why**: [Rationale]
- **Impact**: [How this affects implementation]

### Decision 2: [Topic]

- **What**: [The decision made]
- **Why**: [Rationale]
- **Impact**: [How this affects implementation]

---

## Context to Preserve

### Critical Information

The following context is essential and must be loaded in the next session:

1. **[Topic 1]**: [Brief explanation of why this matters]
2. **[Topic 2]**: [Brief explanation]
3. **[Topic 3]**: [Brief explanation]

### Files to Review First

When resuming, start by reading:

1. `{FEATURE_DIR}/tasks.md` - Current task status
2. `{FEATURE_DIR}/plan.md` - Architecture reference
3. [Other critical file]

---

## Known Issues / Blockers

### Active Issues

| Issue     | Severity       | Status               | Notes     |
| --------- | -------------- | -------------------- | --------- |
| [Issue 1] | [High/Med/Low] | [Open/Investigating] | [Details] |

### Resolved This Session

- [Issue that was resolved]: [How it was fixed]

---

## Session Metrics

| Metric              | Value |
| ------------------- | ----- |
| Tasks Completed     | N     |
| Files Created       | N     |
| Files Modified      | N     |
| Tests Added         | N     |
| Context Compactions | N     |
| Errors Encountered  | N     |

---

## Resume Instructions

To continue this work in a new session:

1. Read this handoff document first
2. Run `check-context-health.sh` to verify context capacity
3. Load tasks.md to see current progress
4. Start from "Immediate (Next Session)" tasks above
5. Mark this handoff as "superseded" once work resumes

---

## Handoff Verification

Before ending this session, verify:

- [ ] All work is committed or documented
- [ ] Build passes
- [ ] No uncommitted changes that would be lost
- [ ] Next steps are clear and actionable
- [ ] Key decisions are documented above
