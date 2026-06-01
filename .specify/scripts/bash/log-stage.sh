#!/usr/bin/env bash
# log-stage.sh - Log pipeline stage metrics for observability
#
# Usage: ./log-stage.sh STAGE [OPTIONS]
#
# Arguments:
#   STAGE           The stage being logged (1_research, 2_specify, etc.)
#
# Options:
#   --start         Log stage start (default if no completion options)
#   --complete      Log stage completion
#   --error MSG     Log stage error with message
#   --tokens N      Token count for this stage
#   --compactions N Number of context compactions
#   --json          Output in JSON format
#   --help          Show this help message
#
# Creates/appends to:
#   - .specify/logs/pipeline.jsonl (stage metrics)
#   - .specify/logs/quality-metrics.jsonl (quality data)
#
# Part of the Gofer observability system (Gap 8).

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default options
STAGE=""
ACTION="start"
TOKEN_COUNT=0
COMPACTION_COUNT=0
ERROR_MSG=""
JSON_OUTPUT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --start)
            ACTION="start"
            shift
            ;;
        --complete)
            ACTION="complete"
            shift
            ;;
        --error)
            ACTION="error"
            ERROR_MSG="$2"
            shift 2
            ;;
        --tokens)
            TOKEN_COUNT="$2"
            shift 2
            ;;
        --compactions)
            COMPACTION_COUNT="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help)
            head -25 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            if [[ -z "$STAGE" ]]; then
                STAGE="$1"
            fi
            shift
            ;;
    esac
done

# Validate stage
if [[ -z "$STAGE" ]]; then
    echo -e "${RED}Error: Stage name required${NC}"
    echo "Usage: $0 STAGE [OPTIONS]"
    exit 1
fi

# Get paths
REPO_ROOT=$(get_repo_root)
eval "$(get_feature_paths)"
LOGS_DIR="$REPO_ROOT/.specify/logs"

# Ensure logs directory exists
mkdir -p "$LOGS_DIR"

# Get timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Get feature name
FEATURE_NAME=$(basename "$FEATURE_DIR" 2>/dev/null || echo "unknown")

# Calculate duration for completion
get_stage_duration() {
    local stage="$1"
    local pipeline_log="$LOGS_DIR/pipeline.jsonl"

    if [[ -f "$pipeline_log" ]]; then
        # Find the most recent start entry for this stage and feature
        local start_time=$(grep "\"stage\":\"$stage\"" "$pipeline_log" | \
            grep "\"feature\":\"$FEATURE_NAME\"" | \
            grep "\"action\":\"start\"" | \
            tail -1 | \
            grep -oE '"timestamp":"[^"]+"' | \
            grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}')

        if [[ -n "$start_time" ]]; then
            # Calculate duration (simplified - just return the difference in minutes)
            local start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$start_time" "+%s" 2>/dev/null || echo "0")
            local now_epoch=$(date "+%s")
            local diff=$((now_epoch - start_epoch))
            local minutes=$((diff / 60))
            echo "PT${minutes}M"
            return
        fi
    fi
    echo "PT0M"
}

# Log to pipeline.jsonl
log_pipeline_event() {
    local pipeline_log="$LOGS_DIR/pipeline.jsonl"
    local duration=""

    if [[ "$ACTION" == "complete" ]]; then
        duration=$(get_stage_duration "$STAGE")
    fi

    local entry=$(cat <<EOF
{"feature":"$FEATURE_NAME","stage":"$STAGE","action":"$ACTION","timestamp":"$TIMESTAMP","tokensUsed":$TOKEN_COUNT,"compactionEvents":$COMPACTION_COUNT,"duration":"$duration","error":"$ERROR_MSG"}
EOF
)

    echo "$entry" >> "$pipeline_log"
    echo "$entry"
}

# Get quality metrics
get_quality_metrics() {
    local test_coverage="0"
    local lint_issues="0"
    local type_errors="0"

    # Try to get test coverage
    if [[ -f "$REPO_ROOT/coverage/coverage-summary.json" ]]; then
        test_coverage=$(grep -oE '"pct":[0-9.]+' "$REPO_ROOT/coverage/coverage-summary.json" | head -1 | grep -oE '[0-9.]+' || echo "0")
    fi

    # Try to count lint issues (from most recent lint run)
    if command -v npm &> /dev/null && [[ -f "$REPO_ROOT/package.json" ]]; then
        lint_issues=$(npm run lint 2>&1 | grep -cE "warning|error" || echo "0")
    fi

    echo "COVERAGE='$test_coverage'"
    echo "LINT_ISSUES='$lint_issues'"
}

# Log quality metrics (only on stage complete)
log_quality_metrics() {
    if [[ "$ACTION" != "complete" ]]; then
        return
    fi

    local quality_log="$LOGS_DIR/quality-metrics.jsonl"
    eval "$(get_quality_metrics)"

    local entry=$(cat <<EOF
{"feature":"$FEATURE_NAME","stage":"$STAGE","timestamp":"$TIMESTAMP","testCoverage":"$COVERAGE","lintIssues":"$LINT_ISSUES"}
EOF
)

    echo "$entry" >> "$quality_log"
}

# Main execution
main() {
    local result=$(log_pipeline_event)
    log_quality_metrics

    if $JSON_OUTPUT; then
        echo "$result"
    else
        echo ""
        case $ACTION in
            start)
                echo -e "${BLUE}📊 Stage Started${NC}"
                echo "   Feature: $FEATURE_NAME"
                echo "   Stage: $STAGE"
                echo "   Time: $TIMESTAMP"
                ;;
            complete)
                echo -e "${GREEN}📊 Stage Completed${NC}"
                echo "   Feature: $FEATURE_NAME"
                echo "   Stage: $STAGE"
                echo "   Tokens: $TOKEN_COUNT"
                echo "   Compactions: $COMPACTION_COUNT"
                ;;
            error)
                echo -e "${RED}📊 Stage Error${NC}"
                echo "   Feature: $FEATURE_NAME"
                echo "   Stage: $STAGE"
                echo "   Error: $ERROR_MSG"
                ;;
        esac
        echo ""
        echo "   Log: $LOGS_DIR/pipeline.jsonl"
    fi
}

main
