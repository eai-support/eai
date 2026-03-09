#!/usr/bin/env bash
# read-failed-approaches.sh - Read and format failed approaches as warnings
#
# Usage: ./read-failed-approaches.sh --feature-id 001-feature --sessions 3
#
# Arguments:
#   --feature-id   Required. Feature directory name to filter by
#   --sessions     Optional. Number of recent sessions to include (default: 3)
#
# Output: Formatted failed approaches to stdout as warnings
# Exit: Always exits 0

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Defaults
FEATURE_ID=""
SESSIONS=3

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --sessions)
            SESSIONS="$2"
            shift 2
            ;;
        --help)
            head -12 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Validate
if [[ -z "$FEATURE_ID" ]]; then
    echo "Error: --feature-id is required" >&2
    exit 0
fi

# Get paths
REPO_ROOT=$(get_repo_root)
LOGFILE="$REPO_ROOT/.specify/logs/failed-approaches.jsonl"

# Check if file exists
if [[ ! -f "$LOGFILE" ]]; then
    echo "No failed approaches found."
    exit 0
fi

# Filter by feature-id
FEATURE_ENTRIES=$(grep -F "\"featureId\":\"$FEATURE_ID\"" "$LOGFILE" 2>/dev/null)

if [[ -z "$FEATURE_ENTRIES" ]]; then
    echo "No failed approaches found for feature: $FEATURE_ID"
    exit 0
fi

# Get unique session IDs (last N sessions)
SESSION_IDS=$(echo "$FEATURE_ENTRIES" | grep -oE '"sessionId":"[^"]+"' | sed 's/"sessionId":"//;s/"//' | sort -u | tail -n "$SESSIONS")

if [[ -z "$SESSION_IDS" ]]; then
    echo "No failed approaches found for feature: $FEATURE_ID"
    exit 0
fi

# Filter entries to only include entries from the last N sessions
FILTERED=""
while IFS= read -r sid; do
    matching=$(echo "$FEATURE_ENTRIES" | grep -F "\"sessionId\":\"$sid\"")
    if [[ -n "$matching" ]]; then
        if [[ -n "$FILTERED" ]]; then
            FILTERED="$FILTERED"$'\n'"$matching"
        else
            FILTERED="$matching"
        fi
    fi
done <<< "$SESSION_IDS"

if [[ -z "$FILTERED" ]]; then
    echo "No failed approaches found for recent sessions."
    exit 0
fi

COUNT=$(echo "$FILTERED" | wc -l | xargs)

echo "## Approaches Already Tried ($COUNT entries)"
echo ""
echo "> WARNING: The following approaches were tried and failed in previous sessions."
echo "> Do NOT retry these without a fundamentally different strategy."
echo ""

# Format each entry
echo "$FILTERED" | while IFS= read -r line; do
    task_id=$(echo "$line" | grep -oE '"taskId":"[^"]+"' | head -1 | sed 's/"taskId":"//;s/"//')
    approach=$(echo "$line" | grep -oE '"approach":"[^"]+"' | head -1 | sed 's/"approach":"//;s/"$//')
    reason=$(echo "$line" | grep -oE '"failureReason":"[^"]+"' | head -1 | sed 's/"failureReason":"//;s/"$//')

    echo "- **$task_id**: Tried: $approach"
    echo "  - Failed because: $reason"
done

echo ""

exit 0
