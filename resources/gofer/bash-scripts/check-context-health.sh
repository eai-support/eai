#!/usr/bin/env bash
# check-context-health.sh - Estimate context window usage and warn at thresholds
#
# Usage: ./check-context-health.sh [OPTIONS]
#
# Options:
#   --json              Output in JSON format
#   --threshold N       Set warning threshold percentage (default: 50)
#   --limit N           Set context limit in tokens (default: 120000)
#   --effective         Use effective context limit (default, 60% of advertised)
#   --advertised        Use advertised context limit (200k for Claude)
#   --help              Show this help message
#
# Context Estimation (2025-2026 Research):
#   - Characters / 4 = approximate tokens (conservative estimate)
#   - Counts: spec.md, plan.md, tasks.md, contracts/, research.md
#   - Also counts recently modified source files
#
# Effective Context Lengths (per 2025-2026 research):
#   While LLMs advertise large context windows, accuracy degrades significantly:
#   - Claude Sonnet 4: 200k advertised → 60-120k effective
#   - Claude Opus 4: 200k advertised → 100-150k effective
#   - Gemini 2.5 Pro: 1M advertised → ~200k effective
#
# Part of the Gofer context management system.

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
JSON_OUTPUT=false
WARNING_THRESHOLD=50  # Warn at 50%
CRITICAL_THRESHOLD=70 # Critical at 70%
# Use EFFECTIVE context limit by default (2025-2026 research shows 60-120k effective for Claude)
CONTEXT_LIMIT=120000  # Effective Claude context (120K tokens)
ADVERTISED_LIMIT=200000  # Advertised Claude context (200K tokens)
USE_EFFECTIVE=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --threshold)
            WARNING_THRESHOLD="$2"
            shift 2
            ;;
        --limit)
            CONTEXT_LIMIT="$2"
            USE_EFFECTIVE=false  # User specified custom limit
            shift 2
            ;;
        --effective)
            CONTEXT_LIMIT=120000
            USE_EFFECTIVE=true
            shift
            ;;
        --advertised)
            CONTEXT_LIMIT=$ADVERTISED_LIMIT
            USE_EFFECTIVE=false
            shift
            ;;
        --help)
            head -25 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Get repository info
REPO_ROOT=$(get_repo_root)
eval "$(get_feature_paths)"

# Token estimation: characters / 4 (conservative)
estimate_tokens() {
    local chars="$1"
    echo $((chars / 4))
}

# Get file size in characters
get_file_chars() {
    local file="$1"
    if [[ -f "$file" ]]; then
        wc -c < "$file" | tr -d ' '
    else
        echo 0
    fi
}

# Get directory size in characters
get_dir_chars() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        find "$dir" \( -type d -name "_*" -prune \) -o \( -type f \( -name "*.md" -o -name "*.yaml" -o -name "*.json" \) -print \) 2>/dev/null | \
            xargs cat 2>/dev/null | wc -c | tr -d ' '
    else
        echo 0
    fi
}

# Calculate spec artifacts size
calculate_spec_context() {
    local total=0

    # Feature specification artifacts
    local spec_chars=$(get_file_chars "$FEATURE_SPEC")
    local plan_chars=$(get_file_chars "$IMPL_PLAN")
    local tasks_chars=$(get_file_chars "$TASKS")
    local research_chars=$(get_file_chars "$RESEARCH")
    local data_model_chars=$(get_file_chars "$DATA_MODEL")
    local quickstart_chars=$(get_file_chars "$QUICKSTART")
    local contracts_chars=$(get_dir_chars "$CONTRACTS_DIR")

    total=$((spec_chars + plan_chars + tasks_chars + research_chars + data_model_chars + quickstart_chars + contracts_chars))

    echo "$total"
}

# Check if context-health-state.json is fresh (< 5 minutes old)
# Returns: "real" data source and sets REAL_TOKENS_USED / REAL_TOKENS_LIMIT on success
check_real_context_health() {
    local state_file="$REPO_ROOT/.specify/memory/context-health-state.json"

    if [[ ! -f "$state_file" ]]; then
        return 1
    fi

    # Check freshness (< 5 minutes = 300 seconds)
    local now
    local file_mtime
    now=$(date +%s)

    if [[ "$(uname)" == "Darwin" ]]; then
        file_mtime=$(stat -f '%m' "$state_file" 2>/dev/null || echo 0)
    else
        file_mtime=$(stat -c '%Y' "$state_file" 2>/dev/null || echo 0)
    fi

    local age=$((now - file_mtime))
    if [[ $age -gt 300 ]]; then
        return 1  # Stale (> 5 minutes)
    fi

    # Extract tokensUsed and tokensLimit using grep/sed (no jq dependency)
    REAL_TOKENS_USED=$(grep -o '"tokensUsed"[[:space:]]*:[[:space:]]*[0-9]*' "$state_file" | grep -o '[0-9]*$' || echo "")
    REAL_TOKENS_LIMIT=$(grep -o '"tokensLimit"[[:space:]]*:[[:space:]]*[0-9]*' "$state_file" | grep -o '[0-9]*$' || echo "")

    if [[ -n "$REAL_TOKENS_USED" && -n "$REAL_TOKENS_LIMIT" && "$REAL_TOKENS_LIMIT" -gt 0 ]]; then
        return 0
    fi

    return 1
}

# Calculate CLAUDE.md and agent files
calculate_system_context() {
    local total=0

    # CLAUDE.md
    if [[ -f "$REPO_ROOT/CLAUDE.md" ]]; then
        total=$((total + $(get_file_chars "$REPO_ROOT/CLAUDE.md")))
    fi

    # AGENTS.md
    if [[ -f "$REPO_ROOT/AGENTS.md" ]]; then
        total=$((total + $(get_file_chars "$REPO_ROOT/AGENTS.md")))
    fi

    echo "$total"
}

# Main calculation
main() {
    local data_source="estimated"
    local spec_tokens=0
    local system_tokens=0
    local total_tokens=0

    # Try real data first (from context-health-state.json)
    if check_real_context_health; then
        data_source="real"
        total_tokens=$REAL_TOKENS_USED
        CONTEXT_LIMIT=$REAL_TOKENS_LIMIT
        # Breakdown not available from real data — set to 0
        spec_tokens=0
        system_tokens=0
    else
        # Fallback: estimate from spec artifacts + CLAUDE.md + AGENTS.md
        local spec_chars=$(calculate_spec_context)
        local system_chars=$(calculate_system_context)
        local total_chars=$((spec_chars + system_chars))

        spec_tokens=$(estimate_tokens $spec_chars)
        system_tokens=$(estimate_tokens $system_chars)
        total_tokens=$(estimate_tokens $total_chars)
    fi

    # Calculate percentages
    local usage_percent=$((total_tokens * 100 / CONTEXT_LIMIT))
    local warning_threshold_tokens=$((CONTEXT_LIMIT * WARNING_THRESHOLD / 100))
    local critical_threshold_tokens=$((CONTEXT_LIMIT * CRITICAL_THRESHOLD / 100))

    # Determine status
    local status="healthy"
    local recommendation=""
    local techniques=""

    if [[ $total_tokens -gt $critical_threshold_tokens ]]; then
        status="critical"
        recommendation="Run /7_gofer_save immediately, then start new session with /8_gofer_resume."
        techniques="observation_masking,session_handoff"
    elif [[ $total_tokens -gt $warning_threshold_tokens ]]; then
        status="warning"
        recommendation="Consider running /7_gofer_save to checkpoint progress. Use sub-agents for exploration."
        techniques="sub_agents,artifact_memory"
    else
        recommendation="Context is healthy. Continue working normally."
        techniques="normal"
    fi

    # Output
    if $JSON_OUTPUT; then
        cat <<EOF
{
  "status": "$status",
  "dataSource": "$data_source",
  "totalTokens": $total_tokens,
  "contextLimit": $CONTEXT_LIMIT,
  "effectiveLimit": $USE_EFFECTIVE,
  "usagePercent": $usage_percent,
  "breakdown": {
    "specArtifacts": $spec_tokens,
    "systemFiles": $system_tokens
  },
  "thresholds": {
    "warning": $WARNING_THRESHOLD,
    "critical": $CRITICAL_THRESHOLD
  },
  "recommendation": "$recommendation",
  "suggestedTechniques": "$techniques"
}
EOF
    else
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  Context Health Check"
        echo "═══════════════════════════════════════════════════════════"
        echo ""

        # Status indicator
        case $status in
            healthy)
                echo -e "  Status: ${GREEN}HEALTHY${NC}"
                ;;
            warning)
                echo -e "  Status: ${YELLOW}WARNING${NC}"
                ;;
            critical)
                echo -e "  Status: ${RED}CRITICAL${NC}"
                ;;
        esac

        echo ""
        if $USE_EFFECTIVE; then
            echo "  Context Usage: $total_tokens / $CONTEXT_LIMIT tokens ($usage_percent%)"
            echo -e "  ${BLUE}Using effective context limit (research-based)${NC}"
        else
            echo "  Context Usage: $total_tokens / $CONTEXT_LIMIT tokens ($usage_percent%)"
            echo -e "  ${YELLOW}Using advertised/custom context limit${NC}"
        fi
        echo ""

        # Progress bar
        local bar_width=40
        local filled=$((usage_percent * bar_width / 100))
        local empty=$((bar_width - filled))

        printf "  ["
        if [[ $status == "critical" ]]; then
            printf "${RED}"
        elif [[ $status == "warning" ]]; then
            printf "${YELLOW}"
        else
            printf "${GREEN}"
        fi

        for ((i=0; i<filled; i++)); do printf "█"; done
        printf "${NC}"
        for ((i=0; i<empty; i++)); do printf "░"; done
        printf "] %d%%\n" $usage_percent

        echo ""
        echo "  Data Source: $data_source"
        echo ""
        echo "  Breakdown:"
        echo "    Spec artifacts:  $(printf "%6d" $spec_tokens) tokens"
        echo "    System files:    $(printf "%6d" $system_tokens) tokens"
        echo "    ─────────────────────────────"
        echo "    Total:           $(printf "%6d" $total_tokens) tokens"
        echo ""

        # Thresholds
        echo "  Thresholds:"
        echo -e "    ${YELLOW}Warning${NC}:  ${warning_threshold_tokens} tokens (${WARNING_THRESHOLD}%)"
        echo -e "    ${RED}Critical${NC}: ${critical_threshold_tokens} tokens (${CRITICAL_THRESHOLD}%)"
        echo ""

        echo "  Recommendation:"
        echo "    $recommendation"
        echo ""

        if [[ $status == "warning" ]]; then
            echo "  Recommended Actions:"
            echo "    1. Use sub-agents (Task tool) for codebase exploration"
            echo "    2. Run /7_gofer_save to checkpoint your progress"
            echo "    3. Store key decisions in research.md or constitution.md"
            echo "    4. Avoid reading entire files - use targeted line ranges"
            echo ""
        elif [[ $status == "critical" ]]; then
            echo "  Required Actions:"
            echo -e "    ${RED}1. Run /7_gofer_save NOW to capture session state${NC}"
            echo "    2. Start a new Claude Code session"
            echo "    3. Run /8_gofer_resume to restore context"
            echo "    4. Continue with fresh context window"
            echo ""
            echo "  Context Management Techniques (2025-2026 Research):"
            echo "    - Observation masking: 50%+ cost reduction, 2.6% better performance"
            echo "    - Session handoffs: Preserve progress across context boundaries"
            echo "    - Sub-agent architecture: Condensed results (1-2k tokens vs raw output)"
            echo ""
        fi

        echo "═══════════════════════════════════════════════════════════"
    fi

    # Exit code based on status
    case $status in
        healthy)
            exit 0
            ;;
        warning)
            exit 0  # Warning is not a failure
            ;;
        critical)
            exit 1  # Critical exits with error
            ;;
    esac
}

main
