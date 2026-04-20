#!/usr/bin/env bash
# Sync the gofer submodule into resources/gofer/ so `eai init` ships the
# current Gofer asset set. Called automatically on prepublishOnly; safe to
# run manually any time.
#
# The gofer submodule at ./gofer is the canonical source; resources/gofer/ is
# what gets bundled into the published npm tarball (per package.json "files"
# array). Without this sync, edits to the gofer submodule never reach
# `eai init` end users.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf "\033[0;34mi\033[0m %s\n" "$1"; }
ok()  { printf "\033[0;32m✓\033[0m %s\n" "$1"; }
err() { printf "\033[0;31m✗\033[0m %s\n" "$1" >&2; }

if [[ ! -d "gofer" || ! -f "gofer/.git" && ! -d "gofer/.git" ]]; then
  err "gofer submodule not initialized. Run: git submodule update --init --recursive"
  exit 1
fi

# sync_dir <gofer-path> <resources/gofer-path>
#   Mirrors gofer submodule subdir → resources/gofer/ subdir.
sync_dir() {
  local src="gofer/$1"
  local dst="resources/gofer/$2"

  if [[ ! -d "$src" ]]; then
    log "skip: $src does not exist in submodule"
    return
  fi

  mkdir -p "$dst"
  rsync -a --delete "${src%/}/" "${dst%/}/"
  ok "synced ${src} → ${dst}"
}

GOFER_COMMIT="$(cd gofer && git rev-parse HEAD)"
GOFER_DESCRIBE="$(cd gofer && git describe --tags --always 2>/dev/null || echo 'unknown')"
log "Syncing gofer @ ${GOFER_DESCRIBE} (${GOFER_COMMIT:0:12}) into resources/gofer/ ..."

# Map gofer subdirs → resources/gofer/ subdirs. These names are the ones
# consumed by src/lib/gofer-installer.ts#installGoferResources.
sync_dir ".claude/commands"            "claude-commands"
sync_dir ".claude/agents"              "claude-agents"
sync_dir ".github/prompts"             "copilot-prompts"
sync_dir ".github/instructions"        "copilot-instructions"
sync_dir ".specify/scripts/bash"       "bash-scripts"
sync_dir ".specify/scripts/powershell" "powershell-scripts"
sync_dir ".specify/scripts/node"       "node-scripts"
sync_dir ".specify/scripts/hooks"      "hook-scripts"
sync_dir ".specify/templates"          "templates"
sync_dir ".specify/references"         "references"
sync_dir ".specify/memory"             "memory"

# instruction-templates lives at the gofer repo root historically; if it
# exists, mirror it too.
if [[ -d "gofer/.specify/instruction-templates" ]]; then
  sync_dir ".specify/instruction-templates" "instruction-templates"
elif [[ -d "gofer/instruction-templates" ]]; then
  mkdir -p "resources/gofer/instruction-templates"
  rsync -a --delete "gofer/instruction-templates/" "resources/gofer/instruction-templates/"
  ok "synced gofer/instruction-templates → resources/gofer/instruction-templates"
fi

# Re-chmod scripts after sync.
find resources/gofer/bash-scripts resources/gofer/hook-scripts \
  -type f \( -name "*.sh" -o -name "*.bash" \) -exec chmod +x {} \; 2>/dev/null || true

# Record the synced version so consumers can verify what shipped.
cat > "resources/gofer/.gofer-version" <<EOF
{
  "commit": "${GOFER_COMMIT}",
  "describe": "${GOFER_DESCRIBE}",
  "synced_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
ok "wrote resources/gofer/.gofer-version"

ok "resources/gofer/ is in sync with gofer submodule @ ${GOFER_DESCRIBE}"
