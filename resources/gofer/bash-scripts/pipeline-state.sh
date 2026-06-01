#!/usr/bin/env bash
# pipeline-state.sh — Manage persistent pipeline state
#
# Usage: pipeline-state.sh <command> [options]
#
# Commands:
#   init     Create new pipeline-state.json with fresh runId
#   read     Read current state (JSON output)
#   update   Update current stage and add to completedStages
#   status   Get current stage name only
#
# Options:
#   --feature-dir DIR   Feature directory (default: auto-detect from branch)
#   --stage STAGE       Stage name (required for update)
#   --json              JSON output format
#
# Examples:
#   pipeline-state.sh init --feature-dir .specify/specs/002-...
#   pipeline-state.sh update --stage 3_plan
#   pipeline-state.sh read --json
#   pipeline-state.sh status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Valid stage names
VALID_STAGES=("1_research" "2_specify" "3_plan" "4_tasks" "5_implement" "6_validate")

# Parse arguments
COMMAND=""
FEATURE_DIR=""
STAGE=""
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    init|read|update|status)
      COMMAND="$1"
      shift
      ;;
    --feature-dir)
      FEATURE_DIR="$2"
      shift 2
      ;;
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$COMMAND" ]]; then
  echo "ERROR: No command specified. Use: init, read, update, or status" >&2
  exit 1
fi

# Auto-detect feature directory from branch name if not provided
detect_feature_dir() {
  if [[ -n "$FEATURE_DIR" ]]; then
    # Make absolute if relative
    if [[ "$FEATURE_DIR" != /* ]]; then
      FEATURE_DIR="$REPO_ROOT/$FEATURE_DIR"
    fi
    return
  fi

  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  if [[ -z "$branch" || "$branch" == "main" || "$branch" == "master" ]]; then
    echo "ERROR: Cannot auto-detect feature directory. Use --feature-dir or switch to a feature branch." >&2
    exit 1
  fi

  # Try to find a matching spec directory
  local feature_name="${branch#feature/}"
  feature_name="${feature_name#feat/}"

  for dir in "$REPO_ROOT"/.specify/specs/*/; do
    if [[ -d "$dir" ]]; then
      local dirname
      dirname=$(basename "$dir")
      if [[ "$dirname" == *"$feature_name"* || "$feature_name" == *"$dirname"* ]]; then
        FEATURE_DIR="$dir"
        return
      fi
    fi
  done

  echo "ERROR: Could not auto-detect feature directory from branch '$branch'. Use --feature-dir." >&2
  exit 1
}

# Get pipeline-state.json path
get_state_path() {
  echo "$FEATURE_DIR/pipeline-state.json"
}

# Validate stage name
validate_stage() {
  local stage="$1"
  for valid in "${VALID_STAGES[@]}"; do
    if [[ "$stage" == "$valid" ]]; then
      return 0
    fi
  done
  echo "ERROR: Invalid stage '$stage'. Valid stages: ${VALID_STAGES[*]}" >&2
  exit 1
}

# Generate UUID v4
generate_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif command -v python3 &>/dev/null; then
    python3 -c 'import uuid; print(uuid.uuid4())'
  else
    # Fallback: generate from /dev/urandom
    od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}' | sed 's/./4/13; s/./a/17'
  fi
}

# Read JSON field using jq or python3 fallback
json_read() {
  local file="$1"
  local field="$2"

  if command -v jq &>/dev/null; then
    jq -r ".$field" "$file" 2>/dev/null
  elif command -v python3 &>/dev/null; then
    python3 -c "import json; data=json.load(open('$file')); print(data.get('$field', ''))"
  else
    echo "ERROR: Neither jq nor python3 available for JSON parsing" >&2
    exit 1
  fi
}

# Write JSON using jq or python3 fallback
json_write() {
  local file="$1"
  local json="$2"

  if command -v jq &>/dev/null; then
    echo "$json" | jq '.' > "$file"
  elif command -v python3 &>/dev/null; then
    python3 -c "import json, sys; data=json.loads(sys.stdin.read()); json.dump(data, open('$file', 'w'), indent=2)" <<< "$json"
  else
    echo "$json" > "$file"
  fi
}

# Update JSON field using jq or python3 fallback
json_update() {
  local file="$1"
  local field="$2"
  local value="$3"
  local value_type="${4:-string}" # string, array_append, raw

  if command -v jq &>/dev/null; then
    case "$value_type" in
      string)
        jq --arg v "$value" ".$field = \$v" "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
        ;;
      array_append)
        jq --arg v "$value" ".$field += [\$v]" "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
        ;;
      raw)
        jq ".$field = $value" "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
        ;;
    esac
  elif command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
with open('$file') as f:
    data = json.load(f)
field = '$field'
value = '$value'
vtype = '$value_type'
if vtype == 'string':
    data[field] = value
elif vtype == 'array_append':
    if field not in data:
        data[field] = []
    if value not in data[field]:
        data[field].append(value)
elif vtype == 'raw':
    data[field] = json.loads(value)
with open('$file', 'w') as f:
    json.dump(data, f, indent=2)
"
  fi
}

# Command: init
cmd_init() {
  detect_feature_dir
  local state_path
  state_path=$(get_state_path)
  local run_id
  run_id=$(generate_uuid)
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local feature_id
  feature_id=$(basename "$FEATURE_DIR")
  local feature_dir_rel
  feature_dir_rel=$(echo "$FEATURE_DIR" | sed "s|$REPO_ROOT/||")

  local json
  json=$(cat <<EOF
{
  "runId": "$run_id",
  "featureId": "$feature_id",
  "featureDir": "$feature_dir_rel",
  "currentStage": "1_research",
  "completedStages": [],
  "startedAt": "$timestamp",
  "updatedAt": "$timestamp",
  "status": "initialized"
}
EOF
)

  json_write "$state_path" "$json"
  cat "$state_path"
}

# Command: read
cmd_read() {
  detect_feature_dir
  local state_path
  state_path=$(get_state_path)

  if [[ ! -f "$state_path" ]]; then
    echo "ERROR: pipeline-state.json not found at $state_path" >&2
    exit 1
  fi

  cat "$state_path"
}

# Command: update
cmd_update() {
  if [[ -z "$STAGE" ]]; then
    echo "ERROR: --stage required for update command" >&2
    exit 1
  fi

  validate_stage "$STAGE"
  detect_feature_dir
  local state_path
  state_path=$(get_state_path)

  if [[ ! -f "$state_path" ]]; then
    echo "ERROR: pipeline-state.json not found. Run 'init' first." >&2
    exit 1
  fi

  local current_stage
  current_stage=$(json_read "$state_path" "currentStage")
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Add current stage to completedStages if not already there
  if [[ -n "$current_stage" && "$current_stage" != "$STAGE" ]]; then
    json_update "$state_path" "completedStages" "$current_stage" "array_append"
  fi

  # Update current stage
  json_update "$state_path" "currentStage" "$STAGE" "string"
  json_update "$state_path" "updatedAt" "$timestamp" "string"
  json_update "$state_path" "status" "in_progress" "string"

  cat "$state_path"
}

# Command: status
cmd_status() {
  detect_feature_dir
  local state_path
  state_path=$(get_state_path)

  if [[ ! -f "$state_path" ]]; then
    echo "ERROR: pipeline-state.json not found" >&2
    exit 1
  fi

  json_read "$state_path" "currentStage"
}

# Execute command
case "$COMMAND" in
  init)   cmd_init ;;
  read)   cmd_read ;;
  update) cmd_update ;;
  status) cmd_status ;;
esac
