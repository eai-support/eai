#!/bin/bash
# Mark a task as complete in tasks.md
#
# Usage: mark-task-complete.sh <feature-dir> <task-id>
# Example: mark-task-complete.sh .specify/specs/025-ai-usage-tracking T001

set -euo pipefail

FEATURE_DIR="${1:-.}"
TASK_ID="${2:-}"

if [[ -z "$TASK_ID" ]]; then
  echo "ERROR: Task ID required"
  echo "Usage: $0 <feature-dir> <task-id>"
  echo "Example: $0 .specify/specs/025-ai-usage-tracking T001"
  exit 1
fi

TASKS_FILE="$FEATURE_DIR/tasks.md"

if [[ ! -f "$TASKS_FILE" ]]; then
  echo "ERROR: tasks.md not found at $TASKS_FILE"
  exit 1
fi

# Match common Gofer task formats:
# - [ ] T001 Description
# - [ ] #T001 Description
# - [ ] **T001**: Description
TASK_PATTERN="^[[:space:]]*-[[:space:]]+\\[[ Xx\\-!bB>]\\][[:space:]]+(\\*\\*${TASK_ID}\\*\\*:?([[:space:]]+|$)|#${TASK_ID}\\b|${TASK_ID}\\b)"
COMPLETED_PATTERN="^[[:space:]]*-[[:space:]]+\\[[Xx]\\][[:space:]]+(\\*\\*${TASK_ID}\\*\\*:?([[:space:]]+|$)|#${TASK_ID}\\b|${TASK_ID}\\b)"

if ! grep -Eq "$TASK_PATTERN" "$TASKS_FILE"; then
  echo "ERROR: Task $TASK_ID not found in $TASKS_FILE"
  exit 1
fi

if grep -Eq "$COMPLETED_PATTERN" "$TASKS_FILE"; then
  echo "✓ Task $TASK_ID already marked complete"
  exit 0
fi

# Mark task complete while preserving the rest of the line
sed -E -i.backup \
  "s/^([[:space:]]*-[[:space:]]+)\\[[ Xx\\-!bB>]\\]([[:space:]]+(\\*\\*${TASK_ID}\\*\\*:?([[:space:]]+|$)|#${TASK_ID}\\b|${TASK_ID}\\b).*)$/\\1[X]\\2/" \
  "$TASKS_FILE"
rm -f "$TASKS_FILE.backup"

# Update task count in frontmatter if present
COMPLETED=$(grep -E -c "^[[:space:]]*-[[:space:]]+\\[[Xx]\\]" "$TASKS_FILE" || echo "0")
INCOMPLETE=$(grep -E -c "^[[:space:]]*-[[:space:]]+\\[[[:space:]]\\]" "$TASKS_FILE" || echo "0")
TOTAL=$((COMPLETED + INCOMPLETE))

if [[ "$TOTAL" -gt 0 ]] && grep -q "^tasksCompleted:" "$TASKS_FILE"; then
  sed -i.backup "s/^tasksCompleted:.*/tasksCompleted: $COMPLETED\/$TOTAL ($((COMPLETED * 100 / TOTAL))%)/" "$TASKS_FILE"
  rm -f "$TASKS_FILE.backup"
fi

echo "✓ Marked $TASK_ID as complete ($COMPLETED/$TOTAL tasks done)"
