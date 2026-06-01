#!/usr/bin/env bash
# verify-task.sh - Verify task completion with automated checks
#
# Usage: ./verify-task.sh [OPTIONS] [TASK_ID]
#
# Options:
#   --json          Output in JSON format
#   --quick         Skip slow checks (full test suite)
#   --help          Show this help message
#
# If TASK_ID is omitted, verifies all modified files since last commit.
#
# Part of the Gofer feedback loop system (Gap 7).

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default options
JSON_OUTPUT=false
QUICK_MODE=false
TASK_ID=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --help)
            head -20 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            TASK_ID="$1"
            shift
            ;;
    esac
done

# Get repository info
REPO_ROOT=$(get_repo_root)
eval "$(get_feature_paths)"

# Results tracking
TESTS_PASSED=true
LINT_PASSED=true
TYPES_PASSED=true
FILES_EXIST=true
ERRORS=()

# Detect project type and tools
detect_project_type() {
    if [[ -f "$REPO_ROOT/package.json" ]]; then
        echo "node"
    elif [[ -f "$REPO_ROOT/pyproject.toml" ]] || [[ -f "$REPO_ROOT/setup.py" ]]; then
        echo "python"
    elif [[ -f "$REPO_ROOT/Cargo.toml" ]]; then
        echo "rust"
    elif [[ -f "$REPO_ROOT/go.mod" ]]; then
        echo "go"
    else
        echo "unknown"
    fi
}

# Get modified files
get_modified_files() {
    if [[ -n "$TASK_ID" ]] && [[ -f "$TASKS" ]]; then
        # Extract file path from task in tasks.md
        grep -E "^\s*-\s*\[.\]\s*$TASK_ID" "$TASKS" | \
            grep -oE '\S+\.(ts|tsx|js|jsx|py|rs|go|java|rb|cpp|c|h)' | \
            head -1
    else
        # Get all modified files since last commit
        git diff --name-only HEAD 2>/dev/null || \
        git diff --name-only --cached 2>/dev/null || \
        echo ""
    fi
}

# Check if files exist
check_files_exist() {
    local files="$1"
    local missing=()

    for file in $files; do
        if [[ ! -f "$REPO_ROOT/$file" ]] && [[ ! -f "$file" ]]; then
            missing+=("$file")
            FILES_EXIST=false
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        ERRORS+=("Missing files: ${missing[*]}")
    fi
}

# Run tests for Node.js projects
run_node_tests() {
    local files="$1"
    local test_pattern=""

    # Build test pattern from file names
    for file in $files; do
        local basename=$(basename "$file" | sed 's/\.[^.]*$//')
        if [[ -n "$test_pattern" ]]; then
            test_pattern="$test_pattern|$basename"
        else
            test_pattern="$basename"
        fi
    done

    if [[ -n "$test_pattern" ]]; then
        if $QUICK_MODE; then
            echo -e "${YELLOW}[SKIP]${NC} Tests (quick mode)"
            return 0
        fi

        echo -e "Running tests matching: $test_pattern"

        # Try different test runners
        if [[ -f "$REPO_ROOT/package.json" ]]; then
            if grep -q '"vitest"' "$REPO_ROOT/package.json" 2>/dev/null; then
                npm test -- --grep "$test_pattern" 2>&1 || {
                    TESTS_PASSED=false
                    ERRORS+=("Tests failed for pattern: $test_pattern")
                }
            elif grep -q '"jest"' "$REPO_ROOT/package.json" 2>/dev/null; then
                npm test -- --testNamePattern="$test_pattern" 2>&1 || {
                    TESTS_PASSED=false
                    ERRORS+=("Tests failed for pattern: $test_pattern")
                }
            else
                npm test 2>&1 || {
                    TESTS_PASSED=false
                    ERRORS+=("Tests failed")
                }
            fi
        fi
    fi
}

# Run linter for Node.js projects
run_node_lint() {
    local files="$1"

    if [[ -z "$files" ]]; then
        return 0
    fi

    echo "Running linter on modified files..."

    # Check for ESLint
    if [[ -f "$REPO_ROOT/.eslintrc.js" ]] || [[ -f "$REPO_ROOT/.eslintrc.json" ]] || [[ -f "$REPO_ROOT/eslint.config.js" ]]; then
        local file_list=""
        for file in $files; do
            if [[ -f "$REPO_ROOT/$file" ]]; then
                file_list="$file_list $REPO_ROOT/$file"
            elif [[ -f "$file" ]]; then
                file_list="$file_list $file"
            fi
        done

        if [[ -n "$file_list" ]]; then
            npx eslint $file_list 2>&1 || {
                LINT_PASSED=false
                ERRORS+=("Lint errors found")
            }
        fi
    else
        echo -e "${YELLOW}[SKIP]${NC} No ESLint config found"
    fi
}

# Run TypeScript check
run_typescript_check() {
    if [[ -f "$REPO_ROOT/tsconfig.json" ]]; then
        echo "Running TypeScript check..."

        if $QUICK_MODE; then
            # Quick mode: just check the modified files
            npx tsc --noEmit 2>&1 | head -20 || {
                TYPES_PASSED=false
                ERRORS+=("TypeScript errors found")
            }
        else
            npx tsc --noEmit 2>&1 || {
                TYPES_PASSED=false
                ERRORS+=("TypeScript errors found")
            }
        fi
    fi
}

# Run Python tests
run_python_tests() {
    local files="$1"

    if $QUICK_MODE; then
        echo -e "${YELLOW}[SKIP]${NC} Tests (quick mode)"
        return 0
    fi

    local test_pattern=""
    for file in $files; do
        local basename=$(basename "$file" | sed 's/\.[^.]*$//')
        if [[ -n "$test_pattern" ]]; then
            test_pattern="$test_pattern or $basename"
        else
            test_pattern="$basename"
        fi
    done

    if [[ -n "$test_pattern" ]]; then
        echo "Running tests matching: $test_pattern"

        if [[ -f "$REPO_ROOT/pyproject.toml" ]] && grep -q "pytest" "$REPO_ROOT/pyproject.toml" 2>/dev/null; then
            pytest -k "$test_pattern" 2>&1 || {
                TESTS_PASSED=false
                ERRORS+=("Tests failed for pattern: $test_pattern")
            }
        fi
    fi
}

# Run Python linter
run_python_lint() {
    local files="$1"

    if [[ -z "$files" ]]; then
        return 0
    fi

    echo "Running Python linter..."

    local file_list=""
    for file in $files; do
        if [[ -f "$REPO_ROOT/$file" ]]; then
            file_list="$file_list $REPO_ROOT/$file"
        elif [[ -f "$file" ]]; then
            file_list="$file_list $file"
        fi
    done

    if [[ -n "$file_list" ]]; then
        if command -v ruff &> /dev/null; then
            ruff check $file_list 2>&1 || {
                LINT_PASSED=false
                ERRORS+=("Ruff lint errors found")
            }
        elif command -v flake8 &> /dev/null; then
            flake8 $file_list 2>&1 || {
                LINT_PASSED=false
                ERRORS+=("Flake8 errors found")
            }
        else
            echo -e "${YELLOW}[SKIP]${NC} No Python linter found"
        fi
    fi
}

# Main execution
main() {
    local project_type=$(detect_project_type)
    local modified_files=$(get_modified_files)

    if [[ -z "$modified_files" ]]; then
        if $JSON_OUTPUT; then
            echo '{"status":"skip","message":"No modified files to verify"}'
        else
            echo -e "${YELLOW}No modified files to verify${NC}"
        fi
        exit 0
    fi

    if ! $JSON_OUTPUT; then
        echo "═══════════════════════════════════════"
        echo "  Task Verification"
        if [[ -n "$TASK_ID" ]]; then
            echo "  Task: $TASK_ID"
        fi
        echo "  Files: $modified_files"
        echo "═══════════════════════════════════════"
        echo ""
    fi

    # Check files exist
    check_files_exist "$modified_files"

    # Run checks based on project type
    case $project_type in
        node)
            run_node_tests "$modified_files"
            run_node_lint "$modified_files"
            run_typescript_check
            ;;
        python)
            run_python_tests "$modified_files"
            run_python_lint "$modified_files"
            ;;
        *)
            if ! $JSON_OUTPUT; then
                echo -e "${YELLOW}Unknown project type. Skipping automated checks.${NC}"
            fi
            ;;
    esac

    # Output results
    if $JSON_OUTPUT; then
        local status="pass"
        if ! $TESTS_PASSED || ! $LINT_PASSED || ! $TYPES_PASSED || ! $FILES_EXIST; then
            status="fail"
        fi

        echo "{"
        echo "  \"status\": \"$status\","
        echo "  \"tests\": $TESTS_PASSED,"
        echo "  \"lint\": $LINT_PASSED,"
        echo "  \"types\": $TYPES_PASSED,"
        echo "  \"filesExist\": $FILES_EXIST,"
        echo "  \"errors\": [$(printf '"%s",' "${ERRORS[@]}" | sed 's/,$//')"]"
        echo "}"
    else
        echo ""
        echo "═══════════════════════════════════════"
        echo "  Verification Results"
        echo "═══════════════════════════════════════"

        if $FILES_EXIST; then
            echo -e "  ${GREEN}✓${NC} Files exist"
        else
            echo -e "  ${RED}✗${NC} Files missing"
        fi

        if $TESTS_PASSED; then
            echo -e "  ${GREEN}✓${NC} Tests pass"
        else
            echo -e "  ${RED}✗${NC} Tests failed"
        fi

        if $LINT_PASSED; then
            echo -e "  ${GREEN}✓${NC} Lint clean"
        else
            echo -e "  ${RED}✗${NC} Lint errors"
        fi

        if $TYPES_PASSED; then
            echo -e "  ${GREEN}✓${NC} Types valid"
        else
            echo -e "  ${RED}✗${NC} Type errors"
        fi

        echo ""

        if $TESTS_PASSED && $LINT_PASSED && $TYPES_PASSED && $FILES_EXIST; then
            echo -e "  ${GREEN}VERIFICATION PASSED${NC}"
            exit 0
        else
            echo -e "  ${RED}VERIFICATION FAILED${NC}"
            echo ""
            echo "  Errors:"
            for error in "${ERRORS[@]}"; do
                echo "    - $error"
            done
            exit 1
        fi
    fi
}

main
