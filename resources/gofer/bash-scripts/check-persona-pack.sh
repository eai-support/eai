#!/usr/bin/env bash
#
# check-persona-pack.sh — Verify a feature dir contains all expected
# persona-pack visual artifacts. Used by /4_gofer_tasks startup gate.
#
# Usage:  check-persona-pack.sh <feature_dir>
#
# Exit codes:
#   0 — all six persona-pack visuals are present
#   1 — critical visuals missing (impact-canvas + value-stream-tobe)
#   2 — non-critical visuals missing (warnings emitted)
#
# Critical visuals (block downstream stages):
#   - visuals/impact-canvas.md
#   - visuals/value-stream-tobe.md
#
# Non-critical visuals (warnings only):
#   - visuals/c4-container.md
#   - visuals/bounded-context.md
#   - visuals/data-model-erd.md
#   - visuals/value-stream-asis.md
#
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <feature_dir>" >&2
  exit 1
fi

FEATURE_DIR="$1"

if [ ! -d "$FEATURE_DIR" ]; then
  echo "ERROR: feature dir not found: $FEATURE_DIR" >&2
  exit 1
fi

VISUALS_DIR="$FEATURE_DIR/visuals"

# Critical (block on missing)
CRITICAL_FILES=(
  "$VISUALS_DIR/impact-canvas.md"
  "$VISUALS_DIR/value-stream-tobe.md"
)

# Non-critical (warn on missing)
NONCRITICAL_FILES=(
  "$VISUALS_DIR/c4-container.md"
  "$VISUALS_DIR/bounded-context.md"
  "$VISUALS_DIR/data-model-erd.md"
  "$VISUALS_DIR/value-stream-asis.md"
)

missing_critical=0
missing_noncritical=0

for f in "${CRITICAL_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "WARN [persona-pack]: critical visual missing: $f" >&2
    missing_critical=$((missing_critical + 1))
  fi
done

for f in "${NONCRITICAL_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "WARN [persona-pack]: visual missing: $f" >&2
    missing_noncritical=$((missing_noncritical + 1))
  fi
done

if [ "$missing_critical" -gt 0 ]; then
  echo "FAIL: persona-pack missing $missing_critical critical visual(s)" >&2
  exit 1
fi

if [ "$missing_noncritical" -gt 0 ]; then
  echo "WARN: persona-pack missing $missing_noncritical non-critical visual(s)" >&2
  exit 2
fi

echo "OK: persona-pack complete at $VISUALS_DIR"
exit 0
