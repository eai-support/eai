#!/usr/bin/env bash
# write-failed-approach.sh - Append a failed approach entry to JSONL log
#
# Usage: ./write-failed-approach.sh --task-id T005 --feature-id 001-feature --approach "Tried X" --reason "Failed because Y"
#
# Arguments:
#   --task-id      Required. Task identifier
#   --feature-id   Required. Feature directory name
#   --approach     Required. Description of what was tried
#   --reason       Required. Why it failed
#   --files        Optional. Comma-separated affected files
#   --session-id   Optional. Auto-detected if omitted
#
# Output: Appends JSON line to .specify/logs/failed-approaches.jsonl
# Exit: Always exits 0 (fire-and-forget)

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Defaults
TASK_ID=""
FEATURE_ID=""
APPROACH=""
REASON=""
FILES=""
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

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
        --approach)
            APPROACH="$2"
            shift 2
            ;;
        --reason)
            REASON="$2"
            shift 2
            ;;
        --files)
            FILES="$2"
            shift 2
            ;;
        --session-id)
            SESSION_ID="$2"
            shift 2
            ;;
        --help)
            head -15 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$TASK_ID" || -z "$FEATURE_ID" || -z "$APPROACH" || -z "$REASON" ]]; then
    echo "Error: --task-id, --feature-id, --approach, and --reason are required" >&2
    exit 0  # Fire-and-forget: still exit 0
fi

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

# Escape content for JSON
ESCAPED_APPROACH=$(echo "$APPROACH" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
ESCAPED_REASON=$(echo "$REASON" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')

# Write JSONL entry
LOGFILE="$LOGS_DIR/failed-approaches.jsonl"
echo "{\"timestamp\":\"$TIMESTAMP\",\"taskId\":\"$TASK_ID\",\"featureId\":\"$FEATURE_ID\",\"approach\":\"$ESCAPED_APPROACH\",\"failureReason\":\"$ESCAPED_REASON\",\"filesAffected\":$FILES_JSON,\"sessionId\":\"$SESSION_ID\"}" >> "$LOGFILE"

exit 0
