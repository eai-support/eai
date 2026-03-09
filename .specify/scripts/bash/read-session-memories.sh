#!/usr/bin/env bash
# read-session-memories.sh - Read and format session memories for prompt consumption
#
# Usage: ./read-session-memories.sh --feature-id 001-feature --limit 20
#
# Arguments:
#   --feature-id   Required. Feature directory name to filter by
#   --limit        Optional. Maximum entries to return (default: 20)
#
# Output: Formatted session memories to stdout
# Exit: Always exits 0

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Defaults
FEATURE_ID=""
LIMIT=20

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --feature-id)
            FEATURE_ID="$2"
            shift 2
            ;;
        --limit)
            LIMIT="$2"
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
LOGFILE="$REPO_ROOT/.specify/logs/session-memory.jsonl"

# Check if file exists
if [[ ! -f "$LOGFILE" ]]; then
    echo "No session memories found."
    exit 0
fi

# Filter by feature-id and get last N entries
ENTRIES=$(grep -F "\"featureId\":\"$FEATURE_ID\"" "$LOGFILE" 2>/dev/null | tail -n "$LIMIT")

if [[ -z "$ENTRIES" ]]; then
    echo "No session memories found for feature: $FEATURE_ID"
    exit 0
fi

# Count entries
COUNT=$(echo "$ENTRIES" | wc -l | xargs)

echo "## Session Memories ($COUNT entries)"
echo ""

# Format each entry for prompt consumption
echo "$ENTRIES" | while IFS= read -r line; do
    # Extract fields using grep/sed (portable, no jq dependency)
    timestamp=$(echo "$line" | grep -oE '"timestamp":"[^"]+"' | head -1 | sed 's/"timestamp":"//;s/"//')
    task_id=$(echo "$line" | grep -oE '"taskId":"[^"]+"' | head -1 | sed 's/"taskId":"//;s/"//')
    memory_type=$(echo "$line" | grep -oE '"memoryType":"[^"]+"' | head -1 | sed 's/"memoryType":"//;s/"//')
    content=$(echo "$line" | grep -oE '"content":"[^"]+"' | head -1 | sed 's/"content":"//;s/"$//')

    # Format type label
    case "$memory_type" in
        decision) type_label="DECISION" ;;
        gotcha)   type_label="GOTCHA" ;;
        pattern)  type_label="PATTERN" ;;
        approach) type_label="APPROACH" ;;
        *)        type_label="NOTE" ;;
    esac

    echo "- **[$type_label]** ($task_id): $content"
done

echo ""

exit 0
