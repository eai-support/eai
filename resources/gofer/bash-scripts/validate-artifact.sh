#!/usr/bin/env bash
# validate-artifact.sh — Validate pipeline artifact content and frontmatter
#
# Usage: validate-artifact.sh <artifact-type> <file-path> [options]
#
# Artifact Types:
#   spec     Validate spec.md (frontmatter + required sections)
#   plan     Validate plan.md (frontmatter + required sections)
#   tasks    Validate tasks.md (frontmatter + task format)
#
# Options:
#   --json           JSON output format
#   --strict         Treat warnings as errors
#   --schema-dir DIR Directory containing JSON schemas
#
# Exit Codes:
#   0  All validations passed
#   1  Validation errors found
#   2  File not found or unreadable

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Parse arguments
ARTIFACT_TYPE=""
FILE_PATH=""
JSON_OUTPUT=false
STRICT=false
SCHEMA_DIR="$REPO_ROOT/extension/src/schemas"

while [[ $# -gt 0 ]]; do
  case "$1" in
    spec|plan|tasks)
      ARTIFACT_TYPE="$1"
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --strict)
      STRICT=true
      shift
      ;;
    --schema-dir)
      SCHEMA_DIR="$2"
      shift 2
      ;;
    -*)
      echo "ERROR: Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$ARTIFACT_TYPE" ]]; then
        ARTIFACT_TYPE="$1"
      elif [[ -z "$FILE_PATH" ]]; then
        FILE_PATH="$1"
      else
        echo "ERROR: Unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$ARTIFACT_TYPE" ]]; then
  echo "ERROR: Artifact type required (spec, plan, or tasks)" >&2
  exit 1
fi

if [[ -z "$FILE_PATH" ]]; then
  echo "ERROR: File path required" >&2
  exit 1
fi

# Make path absolute
if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="$REPO_ROOT/$FILE_PATH"
fi

if [[ ! -f "$FILE_PATH" ]]; then
  if $JSON_OUTPUT; then
    echo "{\"artifact\":\"$ARTIFACT_TYPE\",\"file\":\"$FILE_PATH\",\"valid\":false,\"errors\":[\"File not found: $FILE_PATH\"],\"warnings\":[]}"
  else
    echo "ERROR: File not found: $FILE_PATH" >&2
  fi
  exit 2
fi

# Arrays for errors and warnings
ERRORS=()
WARNINGS=()

# Extract YAML frontmatter between --- markers
extract_frontmatter() {
  local file="$1"
  local in_frontmatter=false
  local frontmatter=""

  while IFS= read -r line; do
    if [[ "$line" == "---" ]]; then
      if $in_frontmatter; then
        echo "$frontmatter"
        return 0
      else
        in_frontmatter=true
        continue
      fi
    fi
    if $in_frontmatter; then
      frontmatter+="$line"$'\n'
    fi
  done < "$file"

  # No frontmatter found
  return 1
}

# Read a simple YAML field value (handles quoted and unquoted)
yaml_get() {
  local frontmatter="$1"
  local field="$2"
  echo "$frontmatter" | sed -n "s/^${field}:[[:space:]]*['\"]\\{0,1\\}\(.*\\)['\"]\\{0,1\\}$/\\1/p" | head -1 | sed "s/['\"]$//"
}

# Check if a field exists in frontmatter
yaml_has() {
  local frontmatter="$1"
  local field="$2"
  echo "$frontmatter" | grep -q "^${field}:" 2>/dev/null
}

# Check if file contains a markdown section
has_section() {
  local file="$1"
  local section="$2"
  grep -q "^##[[:space:]]*${section}" "$file" 2>/dev/null
}

# Check if file contains a pattern
has_pattern() {
  local file="$1"
  local pattern="$2"
  grep -q "$pattern" "$file" 2>/dev/null
}

# Validate spec frontmatter
validate_spec_frontmatter() {
  local frontmatter="$1"

  # Required fields: id, title, status, created
  for field in id title status created; do
    if ! yaml_has "$frontmatter" "$field"; then
      ERRORS+=("Missing required field: $field")
    fi
  done

  # Validate status enum
  local status
  status=$(yaml_get "$frontmatter" "status")
  if [[ -n "$status" ]] && [[ "$status" != "draft" && "$status" != "ready" && "$status" != "approved" ]]; then
    ERRORS+=("Invalid status value: $status (expected: draft, ready, or approved)")
  fi

  # Optional field warnings
  for field in author updated; do
    if ! yaml_has "$frontmatter" "$field"; then
      WARNINGS+=("Missing optional field: $field")
    fi
  done
}

# Validate plan frontmatter
validate_plan_frontmatter() {
  local frontmatter="$1"

  # Required fields: feature, spec, status, created
  for field in feature spec status created; do
    if ! yaml_has "$frontmatter" "$field"; then
      ERRORS+=("Missing required field: $field")
    fi
  done

  # Validate status enum
  local status
  status=$(yaml_get "$frontmatter" "status")
  if [[ -n "$status" ]] && [[ "$status" != "draft" && "$status" != "ready" && "$status" != "approved" ]]; then
    ERRORS+=("Invalid status value: $status (expected: draft, ready, or approved)")
  fi
}

# Validate tasks frontmatter
validate_tasks_frontmatter() {
  local frontmatter="$1"

  # Required fields: feature, plan, status, created
  for field in feature plan status created; do
    if ! yaml_has "$frontmatter" "$field"; then
      ERRORS+=("Missing required field: $field")
    fi
  done

  # Validate status enum
  local status
  status=$(yaml_get "$frontmatter" "status")
  if [[ -n "$status" ]] && [[ "$status" != "draft" && "$status" != "review" && "$status" != "approved" && "$status" != "ready" ]]; then
    ERRORS+=("Invalid status value: $status (expected: draft, review, approved, or ready)")
  fi
}

# Validate spec sections
validate_spec_sections() {
  local file="$1"

  # User Stories OR User Scenarios
  if ! has_section "$file" "User Stor" && ! has_section "$file" "User Scenario"; then
    ERRORS+=("Missing section: ## User Stories or ## User Scenarios")
  fi

  # Functional Requirements OR Requirements
  if ! has_section "$file" "Functional Requirement" && ! has_section "$file" "Requirement"; then
    ERRORS+=("Missing section: ## Functional Requirements or ## Requirements")
  fi

  # Success Criteria
  if ! has_section "$file" "Success Criteria"; then
    ERRORS+=("Missing section: ## Success Criteria")
  fi
}

# Validate plan sections
validate_plan_sections() {
  local file="$1"

  # Implementation Phases OR Phases
  if ! has_section "$file" "Implementation Phase" && ! has_section "$file" "Phase"; then
    ERRORS+=("Missing section: ## Implementation Phases or ## Phases")
  fi

  # Tech Stack OR Technical Context
  if ! has_section "$file" "Tech Stack" && ! has_section "$file" "Technical Context"; then
    ERRORS+=("Missing section: ## Tech Stack or ## Technical Context")
  fi
}

# Validate tasks content
validate_tasks_content() {
  local file="$1"

  # Must have at least one task line: - [ ] or - [x] or - [X]
  if ! has_pattern "$file" "^- \[[ xX]\]"; then
    ERRORS+=("No task lines found (expected at least one '- [ ]' pattern)")
  fi
}

# Main validation
FRONTMATTER=""
HAS_FRONTMATTER=true

FRONTMATTER=$(extract_frontmatter "$FILE_PATH") || HAS_FRONTMATTER=false

if ! $HAS_FRONTMATTER; then
  WARNINGS+=("No YAML frontmatter found (legacy artifact)")
else
  # Validate frontmatter by type
  case "$ARTIFACT_TYPE" in
    spec)  validate_spec_frontmatter "$FRONTMATTER" ;;
    plan)  validate_plan_frontmatter "$FRONTMATTER" ;;
    tasks) validate_tasks_frontmatter "$FRONTMATTER" ;;
  esac
fi

# Validate sections by type
case "$ARTIFACT_TYPE" in
  spec)  validate_spec_sections "$FILE_PATH" ;;
  plan)  validate_plan_sections "$FILE_PATH" ;;
  tasks) validate_tasks_content "$FILE_PATH" ;;
esac

# Determine result
VALID=true

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  VALID=false
fi

if $STRICT && [[ ${#WARNINGS[@]} -gt 0 ]]; then
  VALID=false
fi

# Output
if $JSON_OUTPUT; then
  # Build JSON arrays
  errors_json="["
  for i in "${!ERRORS[@]}"; do
    [[ $i -gt 0 ]] && errors_json+=","
    errors_json+="\"${ERRORS[$i]}\""
  done
  errors_json+="]"

  warnings_json="["
  for i in "${!WARNINGS[@]}"; do
    [[ $i -gt 0 ]] && warnings_json+=","
    warnings_json+="\"${WARNINGS[$i]}\""
  done
  warnings_json+="]"

  echo "{\"artifact\":\"$ARTIFACT_TYPE\",\"file\":\"$FILE_PATH\",\"valid\":$VALID,\"errors\":$errors_json,\"warnings\":$warnings_json}"
else
  if $VALID; then
    echo "PASS: $ARTIFACT_TYPE validation passed for $FILE_PATH"
    if [[ ${#WARNINGS[@]} -gt 0 ]]; then
      for w in "${WARNINGS[@]}"; do
        echo "  WARNING: $w"
      done
    fi
  else
    echo "FAIL: $ARTIFACT_TYPE validation failed for $FILE_PATH"
    for e in "${ERRORS[@]}"; do
      echo "  ERROR: $e"
    done
    for w in "${WARNINGS[@]}"; do
      echo "  WARNING: $w"
    done
  fi
fi

if $VALID; then
  exit 0
else
  exit 1
fi
