#!/usr/bin/env bash
# write-session-memory.sh - Append a session memory entry to JSONL log
#
# Usage: ./write-session-memory.sh --task-id T003 --feature-id 001-feature --type decision --content "Learning text"
#
# Arguments:
#   --task-id      Required. Task identifier (e.g., T003)
#   --feature-id   Required. Feature directory name
#   --type         Required. One of: decision, gotcha, pattern, approach
#   --content      Required. 1-3 sentence learning
#   --session-id   Optional. Auto-detected from environment if omitted
#   --files        Optional. Comma-separated list of affected files
#
# Output: Appends JSON line to .specify/logs/session-memory.jsonl
# Exit: Always exits 0 (fire-and-forget)

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Defaults
TASK_ID=""
FEATURE_ID=""
MEMORY_TYPE=""
CONTENT=""
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"
FILES=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --task-id)
            TASK_ID="$2"
            shift 2
            ;;
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --type)
            MEMORY_TYPE="$2"
            shift 2
            ;;
        --content)
            CONTENT="$2"
            shift 2
            ;;
        --session-id)
            SESSION_ID="$2"
            shift 2
            ;;
        --files)
            FILES="$2"
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
if [[ -z "$TASK_ID" || -z "$FEATURE_ID" || -z "$MEMORY_TYPE" || -z "$CONTENT" ]]; then
    echo "Error: --task-id, --feature-id, --type, and --content are required" >&2
    exit 0  # Fire-and-forget: still exit 0
fi

# Validate memory type
case "$MEMORY_TYPE" in
    decision|gotcha|pattern|approach) ;;
    *)
        echo "Error: --type must be one of: decision, gotcha, pattern, approach" >&2
        exit 0
        ;;
esac

# Get paths
REPO_ROOT=$(get_repo_root)
LOGS_DIR="$REPO_ROOT/.specify/logs"

# Ensure logs directory exists
mkdir -p "$LOGS_DIR"

# Build files array JSON
FILES_JSON="[]"
if [[ -n "$FILES" ]]; then
    FILES_JSON="["
    IFS=',' read -ra FILE_ARRAY <<< "$FILES"
    first=true
    for f in "${FILE_ARRAY[@]}"; do
        f=$(echo "$f" | xargs)  # trim whitespace
        if $first; then
            FILES_JSON="$FILES_JSON\"$f\""
            first=false
        else
            FILES_JSON="$FILES_JSON,\"$f\""
        fi
    done
    FILES_JSON="$FILES_JSON]"
fi

# Get timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Escape content for JSON (handle quotes and backslashes)
ESCAPED_CONTENT=$(echo "$CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')

# Write JSONL entry
LOGFILE="$LOGS_DIR/session-memory.jsonl"
echo "{\"timestamp\":\"$TIMESTAMP\",\"taskId\":\"$TASK_ID\",\"featureId\":\"$FEATURE_ID\",\"memoryType\":\"$MEMORY_TYPE\",\"content\":\"$ESCAPED_CONTENT\",\"sessionId\":\"$SESSION_ID\",\"filesAffected\":$FILES_JSON}" >> "$LOGFILE"

exit 0
