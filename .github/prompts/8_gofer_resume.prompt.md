---
name: 8_gofer_resume
description:
  Resume work from saved session checkpoint with full context restoration
agent: agent
tools: ['search/codebase', 'terminal', 'editFile']
argument-hint: Optional feature name to resume (or auto-detect)
---

# Gofer Resume

You are resuming previously saved work by restoring full context and continuing
implementation. This is an **auxiliary command** that restores state from
`/7_gofer_save`.

---

## When to Use This Command

- Returning to a previously paused feature
- Starting a new session on existing work
- Switching back to a saved task
- Recovering from an interrupted session

---

## Step 1: Discover Saved State

### Check for Session Checkpoints

```bash
# Find all session checkpoints
find .specify/specs -name "session-checkpoint.md" -type f 2>/dev/null

# List features with their status
for dir in .specify/specs/*/; do
  if [ -f "$dir/session-checkpoint.md" ]; then
    echo "PAUSED: $dir"
  elif [ -f "$dir/tasks.md" ]; then
    echo "IN_PROGRESS: $dir"
  fi
done
```

### Present Options to User

If multiple sessions found:

```markdown
## Saved Sessions Found

| Feature     | Stage       | Last Saved       | Tasks Done |
| ----------- | ----------- | ---------------- | ---------- |
| [feature-1] | 5_implement | 2026-01-13 14:30 | 12/25      |
| [feature-2] | 3_plan      | 2026-01-12 09:15 | 0/0        |

Which feature would you like to resume?
```

### If No Checkpoint Found

Check for features with uncompleted tasks:

```bash
# Find tasks.md files with unchecked items
grep -l "\- \[ \]" .specify/specs/*/tasks.md 2>/dev/null
```

If found, offer to resume from tasks.md directly.

---

## Step 2: Load Session Context

Once feature is identified, read in this order:

### Session Checkpoint (Primary)

```bash
Read: {FEATURE_DIR}/session-checkpoint.md
```

Extract from YAML frontmatter:

- `stage`: Which pipeline stage was active
- `last_commit`: Where code was at save time

### Feature Artifacts

```bash
Read: {FEATURE_DIR}/tasks.md      # Current task list
Read: {FEATURE_DIR}/plan.md       # Architecture context
Read: {FEATURE_DIR}/spec.md       # Requirements (if needed)
Read: {FEATURE_DIR}/research.md   # Technical context (if needed)
```

### Git State

```bash
# Verify we're on the right branch
git branch --show-current

# Check for changes since checkpoint
git log --oneline [last_commit]..HEAD

# Check for uncommitted changes
git status
```

---

## Step 3: Validate Resumption State

### Check Code State

```bash
# Verify build still works
npm run build 2>&1 | tail -20

# Check if tests pass
npm test 2>&1 | tail -20
```

### Check for Conflicts

If codebase changed since checkpoint:

1. **Review changes** to files we were modifying
2. **Check for conflicts** with our work
3. **Update plan** if architecture evolved
4. **Warn user** of any impacts

---

## Step 4: Restore Context

Display summary:

```markdown
## Session Restored: [Feature Name]

### Pipeline Status

| Stage             | Status     |
| ----------------- | ---------- |
| 1_gofer_research  | ✅ Done    |
| 2_gofer_specify   | ✅ Done    |
| 3_gofer_plan      | ✅ Done    |
| 4_gofer_tasks     | ✅ Done    |
| 5_gofer_implement | 🔄 Active  |
| 6_gofer_validate  | ⏳ Pending |

### Current Position

- **Tasks**: [X]/[Total] complete ([Y]%)
- **Current Phase**: [Phase name]
- **Next Task**: [Task ID] - [Description]

### What Was Happening

[Context from checkpoint about what was being worked on]

### Ready to Continue

Run the appropriate command to continue:

- `/5_gofer_implement` to continue implementation
- Or I can continue from where we left off now
```

---

## Step 5: Continue Work

Based on the restored state:

1. **If mid-implementation**: Continue with next task from tasks.md
2. **If mid-planning**: Continue with plan.md completion
3. **If validation pending**: Run `/6_gofer_validate`

Delete checkpoint after successful resumption:

```bash
rm {FEATURE_DIR}/session-checkpoint.md
```
