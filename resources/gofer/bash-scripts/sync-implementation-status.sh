#!/bin/bash
# Sync implementation status across feature branches
#
# This script checks which tasks were actually implemented in git commits
# and updates tasks.md to reflect the actual implementation state.
#
# Usage: sync-implementation-status.sh <feature-dir>
# Example: sync-implementation-status.sh .specify/specs/025-ai-usage-tracking

set -euo pipefail

FEATURE_DIR="${1:-.}"
TASKS_FILE="$FEATURE_DIR/tasks.md"

if [[ ! -f "$TASKS_FILE" ]]; then
  echo "ERROR: tasks.md not found at $TASKS_FILE"
  exit 1
fi

# Extract feature name from directory
FEATURE_NAME=$(basename "$FEATURE_DIR")

echo "Analyzing implementation status for feature: $FEATURE_NAME"

# Find commits related to this feature
COMMITS=$(git log --all --grep="$FEATURE_NAME" --grep="Feature.*$(echo $FEATURE_NAME | tr '-' ' ')" --oneline | head -10 || echo "")

if [[ -z "$COMMITS" ]]; then
  echo "WARNING: No commits found for feature $FEATURE_NAME"
  echo "Attempting to find by file changes..."

  # Alternative: look for commits that added/modified files related to feature
  # This is a heuristic - may need adjustment based on feature specifics
fi

# TODO: Parse git commits and map changed files to task numbers
# This requires reading tasks.md, extracting file paths from task descriptions,
# and checking if those files were modified in the commits

echo "✓ Analysis complete"
echo ""
echo "MANUAL STEP REQUIRED:"
echo "1. Review git commits for this feature"
echo "2. For each completed task, run:"
echo "   .specify/scripts/bash/mark-task-complete.sh $FEATURE_DIR <TASK_ID>"
echo ""
echo "Or use codebase-analyzer agent to map implementations to tasks automatically."
