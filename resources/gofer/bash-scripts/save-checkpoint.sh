#!/usr/bin/env bash
# save-checkpoint.sh - Create a checkpoint of current work state
#
# Usage: ./save-checkpoint.sh [OPTIONS] [SUMMARY]
#
# Options:
#   --json          Output in JSON format
#   --commit        Create a WIP commit with the checkpoint
#   --no-handoff    Skip generating handoff document
#   --help          Show this help message
#
# Creates:
#   - Git checkpoint (if --commit)
#   - Session handoff document in {FEATURE_DIR}/session-handoff.md
#
# Part of the Gofer session management system (Gap 2).

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
CREATE_COMMIT=false
SKIP_HANDOFF=false
SUMMARY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --commit)
            CREATE_COMMIT=true
            shift
            ;;
        --no-handoff)
            SKIP_HANDOFF=true
            shift
            ;;
        --help)
            head -20 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            SUMMARY="$1"
            shift
            ;;
    esac
done

# Get repository info
REPO_ROOT=$(get_repo_root)
eval "$(get_feature_paths)"

# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_SHORT=$(date +"%Y-%m-%d")

# Get git state
get_git_state() {
    if has_git; then
        local branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
        local last_commit=$(git log -1 --format="%h - %s" 2>/dev/null || echo "none")
        local uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

        echo "BRANCH='$branch'"
        echo "LAST_COMMIT='$last_commit'"
        echo "UNCOMMITTED_COUNT='$uncommitted'"
    else
        echo "BRANCH='none'"
        echo "LAST_COMMIT='none'"
        echo "UNCOMMITTED_COUNT='0'"
    fi
}

# Get task progress from tasks.md
get_task_progress() {
    if [[ -f "$TASKS" ]]; then
        local total=$(grep -c '^\s*- \[.\]' "$TASKS" 2>/dev/null || echo "0")
        local completed=$(grep -c '^\s*- \[[Xx]\]' "$TASKS" 2>/dev/null || echo "0")
        local incomplete=$((total - completed))

        echo "TOTAL_TASKS='$total'"
        echo "COMPLETED_TASKS='$completed'"
        echo "INCOMPLETE_TASKS='$incomplete'"
    else
        echo "TOTAL_TASKS='0'"
        echo "COMPLETED_TASKS='0'"
        echo "INCOMPLETE_TASKS='0'"
    fi
}

# Get current stage based on artifacts
get_current_stage() {
    if [[ ! -f "$FEATURE_SPEC" ]] && [[ ! -f "$RESEARCH" ]]; then
        echo "0_not_started"
    elif [[ -f "$RESEARCH" ]] && [[ ! -f "$FEATURE_SPEC" ]]; then
        echo "1_research"
    elif [[ -f "$FEATURE_SPEC" ]] && [[ ! -f "$IMPL_PLAN" ]]; then
        echo "2_specify"
    elif [[ -f "$IMPL_PLAN" ]] && [[ ! -f "$TASKS" ]]; then
        echo "3_plan"
    elif [[ -f "$TASKS" ]]; then
        # Check if implementation has started
        local completed=$(grep -c '^\s*- \[[Xx]\]' "$TASKS" 2>/dev/null || echo "0")
        if [[ "$completed" -eq 0 ]]; then
            echo "4_tasks"
        else
            local total=$(grep -c '^\s*- \[.\]' "$TASKS" 2>/dev/null || echo "0")
            if [[ "$completed" -eq "$total" ]]; then
                echo "6_validate"
            else
                echo "5_implement"
            fi
        fi
    else
        echo "unknown"
    fi
}

# Get modified files since last commit
get_modified_files() {
    if has_git; then
        git diff --name-only HEAD 2>/dev/null | head -20
    else
        echo ""
    fi
}

# Get context usage estimate
get_context_usage() {
    if [[ -x "$SCRIPT_DIR/check-context-health.sh" ]]; then
        local result=$("$SCRIPT_DIR/check-context-health.sh" --json 2>/dev/null)
        echo "$result" | grep -o '"usagePercent": [0-9]*' | grep -o '[0-9]*'
    else
        echo "unknown"
    fi
}

# Get next session number
get_next_session_number() {
    local session_dir="$FEATURE_DIR"
    local max=0

    # Look for existing session-handoff files
    for file in "$session_dir"/session-handoff*.md; do
        if [[ -f "$file" ]]; then
            local num=$(echo "$file" | grep -oE 'session-handoff-([0-9]+)' | grep -oE '[0-9]+')
            if [[ -n "$num" ]] && [[ "$num" -gt "$max" ]]; then
                max=$num
            fi
        fi
    done

    # If there's a session-handoff.md without number, count it as 1
    if [[ -f "$session_dir/session-handoff.md" ]] && [[ "$max" -eq 0 ]]; then
        max=1
    fi

    echo $((max + 1))
}

# Create handoff document
create_handoff() {
    local session_num=$(get_next_session_number)
    local stage=$(get_current_stage)
    local context_pct=$(get_context_usage)

    eval "$(get_git_state)"
    eval "$(get_task_progress)"

    local feature_name=$(basename "$FEATURE_DIR")
    local handoff_file="$FEATURE_DIR/session-handoff.md"

    # Archive previous handoff if exists
    if [[ -f "$handoff_file" ]]; then
        mv "$handoff_file" "$FEATURE_DIR/session-handoff-$((session_num - 1)).md"
    fi

    cat > "$handoff_file" <<EOF
---
feature: "$feature_name"
session: $session_num
previousSession: $((session_num - 1))
created: "$TIMESTAMP"
contextUsage: "${context_pct}%"
stage: "$stage"
---

# Session Handoff: $feature_name

## Session Summary

**Session**: #$session_num of $feature_name implementation
**Date**: $TIMESTAMP
**Stage at End**: $stage
**Context Usage**: ${context_pct}% at session end

---

## Work Completed

### This Session

${SUMMARY:-"- [Document what was accomplished this session]"}

### Cumulative Progress

| Stage | Status | Notes |
|-------|--------|-------|
| 1_research | $([ -f "$RESEARCH" ] && echo "✓ Complete" || echo "○ Not Started") | $([ -f "$RESEARCH" ] && echo "research.md created" || echo "-") |
| 2_specify | $([ -f "$FEATURE_SPEC" ] && echo "✓ Complete" || echo "○ Not Started") | $([ -f "$FEATURE_SPEC" ] && echo "spec.md created" || echo "-") |
| 3_plan | $([ -f "$IMPL_PLAN" ] && echo "✓ Complete" || echo "○ Not Started") | $([ -f "$IMPL_PLAN" ] && echo "plan.md created" || echo "-") |
| 4_tasks | $([ -f "$TASKS" ] && echo "✓ Complete" || echo "○ Not Started") | $([ -f "$TASKS" ] && echo "tasks.md with $TOTAL_TASKS tasks" || echo "-") |
| 5_implement | $([ "$COMPLETED_TASKS" -gt 0 ] && [ "$COMPLETED_TASKS" -lt "$TOTAL_TASKS" ] && echo "⏳ In Progress" || ([ "$COMPLETED_TASKS" -eq "$TOTAL_TASKS" ] && [ "$TOTAL_TASKS" -gt 0 ] && echo "✓ Complete" || echo "○ Not Started")) | $COMPLETED_TASKS/$TOTAL_TASKS tasks complete |
| 6_validate | ○ Not Started | - |

---

## Current State

### Git State

\`\`\`
Branch: $BRANCH
Last Commit: $LAST_COMMIT
Uncommitted Changes: $UNCOMMITTED_COUNT files
\`\`\`

### Build/Test Status

- **Build**: [Run \`npm run build\` to verify]
- **Tests**: [Run \`npm test\` to verify]
- **Lint**: [Run \`npm run lint\` to verify]

---

## Next Steps

### Immediate (Next Session)

1. [ ] Resume from current stage: $stage
2. [ ] Review this handoff document
3. [ ] Continue with next incomplete task

### Remaining Work

$(if [[ -f "$TASKS" ]]; then
    echo "From tasks.md:"
    grep '^\s*- \[ \]' "$TASKS" | head -5 | sed 's/^/- /'
    local remaining=$(grep -c '^\s*- \[ \]' "$TASKS" 2>/dev/null || echo "0")
    if [[ "$remaining" -gt 5 ]]; then
        echo "- ... and $((remaining - 5)) more tasks"
    fi
else
    echo "- [No tasks.md found - run /4_gofer_tasks first]"
fi)

---

## Key Decisions Made

Document important decisions here before ending the session:

### Decision 1: [Topic]

- **What**: [The decision made]
- **Why**: [Rationale]

---

## Resume Instructions

To continue this work in a new session:

1. Read this handoff document first
2. Run \`check-context-health.sh\` to verify context capacity
3. Load tasks.md to see current progress: \`$TASKS\`
4. Start from the next incomplete task
5. Run \`/5_gofer_implement\` to continue implementation

---

## Handoff Verification

- [$([ "$UNCOMMITTED_COUNT" -eq 0 ] && echo "x" || echo " ")] All work is committed
- [ ] Next steps are clear and actionable
- [ ] Key decisions are documented above
EOF

    echo "$handoff_file"
}

# Create WIP commit
create_wip_commit() {
    if has_git; then
        local stage=$(get_current_stage)
        local message="WIP: checkpoint at $stage"

        if [[ -n "$SUMMARY" ]]; then
            message="WIP: $SUMMARY"
        fi

        git add -A 2>/dev/null || true
        git commit -m "$message" 2>/dev/null || echo "Nothing to commit"
    fi
}

# Main execution
main() {
    # Validate feature directory exists
    if [[ ! -d "$FEATURE_DIR" ]]; then
        if $JSON_OUTPUT; then
            echo '{"status":"error","message":"No feature directory found"}'
        else
            echo -e "${RED}Error: No feature directory found${NC}"
            echo "Run /1_gofer_research first to create a feature."
        fi
        exit 1
    fi

    local handoff_file=""
    local commit_hash=""

    # Create handoff document
    if ! $SKIP_HANDOFF; then
        handoff_file=$(create_handoff)
    fi

    # Create commit if requested
    if $CREATE_COMMIT; then
        commit_hash=$(create_wip_commit)
    fi

    # Get final state
    eval "$(get_git_state)"
    eval "$(get_task_progress)"
    local stage=$(get_current_stage)
    local context_pct=$(get_context_usage)

    # Output results
    if $JSON_OUTPUT; then
        cat <<EOF
{
  "status": "success",
  "timestamp": "$TIMESTAMP",
  "feature": "$(basename "$FEATURE_DIR")",
  "stage": "$stage",
  "contextUsage": "$context_pct",
  "tasks": {
    "total": $TOTAL_TASKS,
    "completed": $COMPLETED_TASKS,
    "remaining": $INCOMPLETE_TASKS
  },
  "git": {
    "branch": "$BRANCH",
    "uncommitted": $UNCOMMITTED_COUNT,
    "commitCreated": $CREATE_COMMIT
  },
  "handoffFile": "$handoff_file"
}
EOF
    else
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  Checkpoint Saved"
        echo "═══════════════════════════════════════════════════════════"
        echo ""
        echo "  Feature: $(basename "$FEATURE_DIR")"
        echo "  Stage: $stage"
        echo "  Context: ${context_pct}%"
        echo ""
        echo "  Progress:"
        echo "    Tasks: $COMPLETED_TASKS / $TOTAL_TASKS complete"
        echo "    Remaining: $INCOMPLETE_TASKS tasks"
        echo ""

        if [[ -n "$handoff_file" ]]; then
            echo -e "  ${GREEN}✓${NC} Handoff document: $handoff_file"
        fi

        if $CREATE_COMMIT; then
            echo -e "  ${GREEN}✓${NC} WIP commit created"
        fi

        echo ""
        echo "  To resume in a new session:"
        echo "    1. Read the handoff document"
        echo "    2. Run /5_gofer_implement to continue"
        echo ""
        echo "═══════════════════════════════════════════════════════════"
    fi
}

main
