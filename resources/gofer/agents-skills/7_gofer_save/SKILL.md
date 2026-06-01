---
name: 7_gofer_save
description: "Save session state and create a handoff checkpoint for resumption in a new context."
---

## Workspace Preflight

Before doing stage/helper work:

1. Resolve the repository root.
2. Check the core Gofer sentinels:
   - `.specify/.gofer-version`
   - `.specify/commands/0_business_scenario.md`
   - `.specify/templates/spec-template.md`
   - `.specify/scripts/bash/create-new-feature.sh`
   - `.specify/scripts/node/parse-stage-command.mjs`
   - `.specify/scripts/hooks/post-tool-use.mjs`
   - `.specify/scripts/powershell/install-optional-tools.ps1`
   - `.specify/templates/gofer-model-policy.yaml`
   - `.specify/memory/gofer-model-policy.yaml`
   - `.specify/specs/`
   - `.specify/memory/`
3. Check host-specific repo-owned files when relevant:
   - Claude: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`
   - Codex: `AGENTS.md`
   - Copilot: `.github/copilot-instructions.md`
   - VS Code extension mirrors Claude/Copilot/Gemini resources itself and should still keep the core scaffold healthy
4. If the repo already has the workspace checker script, prefer running:
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host codex --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.

---
description: Save session progress with comprehensive checkpoint for resumption
---

# Gofer Save

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

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

Checkpoint created by /7_gofer_save
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
/8_gofer_resume
```

### Manual Resume Steps

1. Read this checkpoint file
2. Check `tasks.md` for current task
3. Review `plan.md` for architecture context
4. Continue with `/5_gofer_implement`

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

Progress saved at task [TaskID]. Resume with `/8_gofer_resume`.
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
  /8_gofer_resume

  Or manually:
  cd [repo] && git checkout [branch]
  Read: {FEATURE_DIR}/session-checkpoint.md
  Continue: /5_gofer_implement

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

- `/8_gofer_resume` - Paired resume command
- `/5_gofer_implement` - Can resume implementation
- `/6_gofer_validate` - Can validate partial progress
- `/0_business_scenario` - Detects saved sessions
- `check-context-health.sh` - Triggers save at thresholds
