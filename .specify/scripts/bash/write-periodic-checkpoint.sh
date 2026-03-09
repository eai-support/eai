#!/usr/bin/env bash
# write-periodic-checkpoint.sh - Write a periodic checkpoint JSON file
#
# Usage: ./write-periodic-checkpoint.sh --feature-id 001-feature --task-number 5 --total-tasks 20 --completed "T001,T002,T003,T004,T005"
#
# Arguments:
#   --feature-id      Required. Feature identifier
#   --task-number     Required. Current task index (1-based)
#   --total-tasks     Required. Total tasks in tasks.md
#   --completed       Required. Comma-separated list of completed task IDs
#   --decisions       Optional. Comma-separated key decisions
#   --files-modified  Optional. Comma-separated files changed
#
# Output: Creates .specify/memory/checkpoints/periodic-{timestamp}.json
# Exit: Always exits 0 (fire-and-forget)

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Defaults
FEATURE_ID=""
TASK_NUMBER=""
TOTAL_TASKS=""
COMPLETED=""
DECISIONS=""
FILES_MODIFIED=""
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --task-number)
            TASK_NUMBER="$2"
            shift 2
            ;;
        --total-tasks)
            TOTAL_TASKS="$2"
            shift 2
            ;;
        --completed)
            COMPLETED="$2"
            shift 2
            ;;
        --decisions)
            DECISIONS="$2"
            shift 2
            ;;
        --files-modified)
            FILES_MODIFIED="$2"
            shift 2
            ;;
        --help)
            head -16 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$FEATURE_ID" || -z "$TASK_NUMBER" || -z "$TOTAL_TASKS" || -z "$COMPLETED" ]]; then
    echo "Error: --feature-id, --task-number, --total-tasks, and --completed are required" >&2
    exit 0  # Fire-and-forget
fi

# Get paths
REPO_ROOT=$(get_repo_root)
CHECKPOINTS_DIR="$REPO_ROOT/.specify/memory/checkpoints"

# Ensure checkpoints directory exists
mkdir -p "$CHECKPOINTS_DIR"

# Build JSON arrays from comma-separated strings
build_json_array() {
    local input="$1"
    if [[ -z "$input" ]]; then
        echo "[]"
        return
    fi
    local result="["
    IFS=',' read -ra ITEMS <<< "$input"
    local first=true
    for item in "${ITEMS[@]}"; do
        item=$(echo "$item" | xargs)  # trim whitespace
        if $first; then
            result="$result\"$item\""
            first=false
        else
            result="$result,\"$item\""
        fi
    done
    result="$result]"
    echo "$result"
}

COMPLETED_JSON=$(build_json_array "$COMPLETED")
DECISIONS_JSON=$(build_json_array "$DECISIONS")
FILES_JSON=$(build_json_array "$FILES_MODIFIED")

# Get timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TIMESTAMP_SLUG=$(date +%s)

# Write checkpoint JSON file
CHECKPOINT_FILE="$CHECKPOINTS_DIR/periodic-${TIMESTAMP_SLUG}.json"
cat > "$CHECKPOINT_FILE" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "featureId": "$FEATURE_ID",
  "taskNumber": $TASK_NUMBER,
  "totalTasks": $TOTAL_TASKS,
  "tasksCompleted": $COMPLETED_JSON,
  "keyDecisions": $DECISIONS_JSON,
  "filesModified": $FILES_JSON,
  "sessionId": "$SESSION_ID"
}
EOF

exit 0
