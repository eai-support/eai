---
name: 7_gofer_save
description: Save session progress with comprehensive checkpoint for resumption
agent: copilot-workspace
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebSearch
argument-hint: feature-name-or-description
gofer:
  workflowProfile: enterpriseai
  canonicalSource: .claude/commands/7_gofer_save.md
  canonicalChecksum: d23fd96c753c0a905d10652fab5107f170145ccd868442731941aa43ebb25514
  metadataSource: scripts/generate-commands.ts
---


# Gofer Save

You are creating a comprehensive progress checkpoint when the user needs to
pause work on a feature. This is an **auxiliary command** that can be invoked
anytime during the Gofer pipeline.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

---

## When to Use This Command

- User needs to stop mid-implementation
- Switching to another task/feature
- End of work session
- Before a break or context switch
- **Context window approaching limits (>50% usage)**
- **Context health check returns WARNING or CRITICAL**
- Before risky operations

### Context-Triggered Saves (2025-2026 Best Practice)

Run context health check periodically during long sessions:

```bash
.specify/scripts/bash/check-context-health.sh --json
```

| Status   | Token Usage | Action                                  |
| -------- | ----------- | --------------------------------------- |
| Healthy  | < 50%       | Continue normally                       |
| Warning  | 50-70%      | Consider checkpoint, use sub-agents     |
| Critical | > 70%       | **Save immediately**, start new session |

**Why this matters**: Research shows LLMs lose accuracy as context grows.
Effective context for Claude is ~60-120k tokens, not the advertised 200k.

---

## Step 1: Assess Current State

### 1.1 Context Window Health

```bash
.specify/scripts/bash/check-context-health.sh
```

Document current context usage - this informs how much detail to include in
handoff.

### 1.2 Gather Session State

1. **Review conversation history** to understand what was being worked on
2. **Check git status** for uncommitted changes
3. **Identify the active feature** from `.specify/specs/*/`
4. **Review TodoWrite list** for current tasks
5. **Check pipeline stage** - which Gofer command was last run

```bash
# Git state
git status
git log --oneline -5

# Find active feature
ls -la .specify/specs/
```

---

## Step 2: Save Code Progress

### 2.1 Commit Meaningful Work

```bash
git status
git diff --stat

# Create WIP commit if appropriate
git add [specific files]
git commit -m "WIP: [Feature] - [Current state description]

Checkpoint created by #7_gofer_save
Stage: [current pipeline stage]
Next: [what needs to happen next]"
```

### 2.2 Document Uncommitted Changes

If changes shouldn't be committed yet:

- List files with unsaved changes
- Explain why they weren't committed
- Document what needs to be done before committing

---

## Step 3: Create Session Checkpoint

Write to `{FEATURE_DIR}/session-checkpoint.md`:

````markdown
---
feature: [Feature Name]
created: [ISO timestamp]
stage: [1_research|2_specify|3_plan|4_tasks|5_implement|6_validate]
status: paused
context_usage: [percentage from health check]
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

## Code Changes

### Committed This Session

```bash
git log --oneline [session_start_commit]..HEAD
```
````

### Uncommitted Changes

| File           | Status   | Description                |
| -------------- | -------- | -------------------------- |
| `path/to/file` | Modified | [What was changed and why] |
| `path/other`   | New      | [Purpose of new file]      |

### Files NOT to Modify (Protected)

From tasks.md Protected Files section:

- [List protected files]

## Context for Resumption

### Key Decisions Made

1. [Decision]: [Why and implications]
2. [Decision]: [Why and implications]

### Blockers Encountered

- [Blocker]: [Status and workaround if any]

### Gotchas Discovered

- [Gotcha]: [How to handle]

### Open Questions

- [ ] [Question requiring user input]
- [ ] [Question requiring research]

## Resumption Instructions

### Quick Resume

```bash
cd [repo path]
git checkout [branch]
#8_gofer_resume
```

### Manual Resume Steps

1. Read this checkpoint file
2. Check `tasks.md` for current task
3. Review `plan.md` for architecture context
4. Continue with `#5_gofer_implement`

### Context to Load First

1. `{FEATURE_DIR}/tasks.md` - Current task list
2. `{FEATURE_DIR}/plan.md` - Architecture decisions
3. `[Current file being edited]` - Continue from here

## Test Status

- [ ] Build passes: `npm run build`
- [ ] Tests pass: `npm test`
- [ ] Lint passes: `npm run lint`

## Notes

[Any additional context that would help future you or another agent]

````

---

## Step 4: Update Tasks.md

Add checkpoint marker to tasks.md:

```markdown
## Checkpoint: [ISO timestamp]

Progress saved at task [TaskID]. Resume with `#8_gofer_resume`.
````

---

## Step 5: Present Summary

```
================================================================
  SESSION SAVED: [Feature Name]
================================================================

  Branch: [branch name]
  Stage: [pipeline stage]
  Tasks: [X]/[Total] complete

  Checkpoint: {FEATURE_DIR}/session-checkpoint.md

  Code Status:
  - Committed: [X] files
  - Uncommitted: [Y] files (documented)
  - Tests: [passing/failing/not run]

  To resume:
  #8_gofer_resume

  Or manually:
  cd [repo] && git checkout [branch]
  Read: {FEATURE_DIR}/session-checkpoint.md
  Continue: #5_gofer_implement

================================================================
```

---

## Step 6: Observability Logging

```bash
.specify/scripts/bash/log-stage.sh 7_save --complete --tokens [N] --compactions [N]
```

---

## Best Practices for Checkpoints

### Always Capture

- Exact file and line number being edited
- Why you stopped (not just what you were doing)
- Any mental model or context not in artifacts
- Test status at time of save

### Machine-Readable State

The YAML frontmatter allows automated tools to:

- Detect where to resume
- Calculate time between sessions
- Track feature velocity

### Human-Readable Context

The markdown body ensures:

- Any agent (or human) can understand the state
- No context is lost between sessions
- Resumption is fast and accurate

---

## Context Management Best Practices (2025-2026 Research)

### What to Preserve (High Value)

- **Key decisions and rationale** - These are hard to reconstruct
- **Blockers and workarounds** - Prevent repeated dead ends
- **Exact file:line being edited** - Enables precise resumption
- **Mental model context** - Insights not captured in artifacts

### What to Summarize (Medium Value)

- Tool outputs and exploration results
- Code snippets that are in committed files
- Error messages (keep only the key ones)

### What to Omit (Low Value / High Cost)

- Full file contents (can be re-read)
- Repetitive conversation history
- Superseded attempts or dead ends
- Verbose tool outputs

### Handoff Size Target

Aim for session-checkpoint.md to be:

- **< 2,000 tokens** for critical information
- **< 5,000 tokens** total including context

This ensures the resume session starts with clean context.

---

## Integration

This command works with:

- `#8_gofer_resume` - Paired resume command
- `#5_gofer_implement` - Can resume implementation
- `#6_gofer_validate` - Can validate partial progress
- `/0_business_scenario` - Detects saved sessions
- `check-context-health.sh` - Triggers save at thresholds
