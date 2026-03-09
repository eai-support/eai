---
name: 7_gofer_save
description: Save session progress with comprehensive checkpoint for resumption
agent: agent
tools: ['terminal', 'editFile']
argument-hint: Optional notes about what to remember
---

# Gofer Save

You are creating a comprehensive progress checkpoint when the user needs to
pause work on a feature. This is an **auxiliary command** that can be invoked
anytime during the Gofer pipeline.

---

## When to Use This Command

- User needs to stop mid-implementation
- Switching to another task/feature
- End of work session
- Before a break or context switch
- Context window approaching limits (>50% usage)
- Before risky operations

---

## Step 1: Assess Current State

### Gather Session State

1. **Review conversation history** to understand what was being worked on
2. **Check git status** for uncommitted changes
3. **Identify the active feature** from `.specify/specs/*/`
4. **Check pipeline stage** - which Gofer command was last run

```bash
# Git state
git status
git log --oneline -5

# Find active feature
ls -la .specify/specs/
```

---

## Step 2: Save Code Progress

### Commit Meaningful Work

```bash
git status
git diff --stat

# Create WIP commit if appropriate
git add [specific files]
git commit -m "WIP: [Feature] - [Current state description]

Checkpoint created by /7_gofer_save
Stage: [current pipeline stage]
Next: [what needs to happen next]"
```

### Document Uncommitted Changes

If changes shouldn't be committed yet:

- List files with unsaved changes
- Explain why they weren't committed
- Document what needs to be done before committing

---

## Step 3: Create Session Checkpoint

Write to `{FEATURE_DIR}/session-checkpoint.md`:

```markdown
---
feature: [Feature Name]
created: [ISO timestamp]
stage: [1_research|2_specify|3_plan|4_tasks|5_implement|6_validate]
status: paused
last_commit: [git hash]
branch: [current branch]
---

# Session Checkpoint: [Feature Name]

## Current State

### Pipeline Progress

| Stage             | Status      | Artifact                 |
| ----------------- | ----------- | ------------------------ |
| 1_gofer_research  | [done/skip] | research.md              |
| 2_gofer_specify   | [done/skip] | spec.md                  |
| 3_gofer_plan      | [done/skip] | plan.md, data-model.md   |
| 4_gofer_tasks     | [done/skip] | tasks.md                 |
| 5_gofer_implement | [current]   | [files created/modified] |
| 6_gofer_validate  | pending     | -                        |

### Active Task

- **Current Task**: [Task ID and description from tasks.md]
- **File Being Modified**: `path/to/file.ts:line`
- **What Was Happening**: [Detailed description]

### Task Completion Status

From tasks.md:

- Completed: [X]/[Total] tasks
- Current phase: [Phase name]
- Next task: [Task ID and description]

## Key Decisions Made

[Document any important decisions during this session]

## Blockers or Questions

[Any unresolved issues or questions for next session]

## Next Steps

1. Run `/8_gofer_resume` to continue
2. [Specific next action]
3. [Following action]

## Context Notes

[Any important context the next session needs to know]
```

---

## Step 4: Confirmation

Confirm to user:

```
✅ Session checkpoint saved!

📁 Checkpoint: {FEATURE_DIR}/session-checkpoint.md
🔖 Git commit: [hash] (if created)
📍 Stage: [current pipeline stage]
📋 Tasks: [X]/[Total] complete

To resume later, run: /8_gofer_resume
```
