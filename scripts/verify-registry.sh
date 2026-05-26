#!/usr/bin/env bash
set -euo pipefail

# Static registry release verification for @eai-tools/cli.
# This script validates the committed packument, release workflow, release
# script, and human-facing docs against the GitHub Pages static registry model.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKUMENT="$ROOT/docs-site/static/registry/@eai-tools/cli"
TARBALL_DIR="$ROOT/docs-site/static/registry/-/@eai-tools"
REGISTRY_INDEX="$ROOT/docs-site/static/registry/index.html"
CI_YML="$ROOT/.github/workflows/ci.yml"
DOCS_YML="$ROOT/.github/workflows/docs.yml"
RELEASE_YML="$ROOT/.github/workflows/release.yml"
RELEASE_SH="$ROOT/release.sh"
SYNC_YML="$ROOT/.github/workflows/sync-linked-sources.yml"
GENERATOR="$ROOT/scripts/generate-registry.cjs"
README="$ROOT/README.md"
SETUP_MD="$ROOT/.github/SETUP.md"
AGENTS_MD="$ROOT/AGENTS.md"
CLAUDE_MD="$ROOT/CLAUDE.md"
COPILOT_MD="$ROOT/.github/copilot-instructions.md"
DEPLOY_DOC="$ROOT/.tech-docs/deployment.md"
LLMS_INDEX="$ROOT/docs-site/static/llms.txt"
LLMS_FULL="$ROOT/docs-site/static/llms-full.txt"
CLI_HELP="$ROOT/docs-site/static/cli-help.txt"
STATIC_REGISTRY_URL="https://eai-tools.github.io/eai/registry/"
CONFIG_CMD="npm config set @eai-tools:registry ${STATIC_REGISTRY_URL} --location=user"
INSTALL_CMD="npm install -g @eai-tools/cli"
PASS=0
FAIL=0
SKIP=0

pass() { ((PASS+=1)); echo "  ✓ $1"; }
fail() { ((FAIL+=1)); echo "  ✗ $1"; }
skip() { ((SKIP+=1)); echo "  ○ $1 (skipped — $2)"; }
section() { echo ""; echo "▸ $1"; }

contains() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" 2>/dev/null
}

omits() {
  local file="$1"
  local text="$2"
  ! grep -Fq "$text" "$file" 2>/dev/null
}

section "Packument validity"
if [[ -f "$PACKUMENT" ]]; then
  pass "Packument exists"
else
  fail "Packument missing: $PACKUMENT"
fi

if node -e "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8'))" 2>/dev/null; then
  pass "Packument is valid JSON"
else
  fail "Packument is not valid JSON"
fi

PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
LATEST_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8'))['dist-tags']?.latest ?? ''" 2>/dev/null || true)"
if [[ "$LATEST_VERSION" == "$PKG_VERSION" ]]; then
  pass "Packument latest matches package.json ($PKG_VERSION)"
else
  fail "Packument latest mismatch: package.json=$PKG_VERSION packument=${LATEST_VERSION:-missing}"
fi

if node -e "const p=JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')); process.exit(p.versions?.['$PKG_VERSION'] ? 0 : 1)" 2>/dev/null; then
  pass "Packument contains version entry for $PKG_VERSION"
else
  fail "Packument missing version entry for $PKG_VERSION"
fi

EXPECTED_URL="${STATIC_REGISTRY_URL}-/@eai-tools/cli-${PKG_VERSION}.tgz"
ACTUAL_URL="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')).versions['$PKG_VERSION']?.dist?.tarball ?? ''" 2>/dev/null || true)"
if [[ "$ACTUAL_URL" == "$EXPECTED_URL" ]]; then
  pass "Packument tarball URL uses the static registry"
else
  fail "Packument tarball URL mismatch: expected $EXPECTED_URL got ${ACTUAL_URL:-missing}"
fi

VERSION_TARBALL="$TARBALL_DIR/cli-${PKG_VERSION}.tgz"
LATEST_TARBALL="$TARBALL_DIR/cli-latest.tgz"
if [[ -f "$VERSION_TARBALL" ]]; then
  pass "Versioned tarball exists"
else
  fail "Versioned tarball missing: $VERSION_TARBALL"
fi

if [[ -f "$LATEST_TARBALL" ]]; then
  pass "Latest tarball alias exists"
else
  fail "Latest tarball alias missing: $LATEST_TARBALL"
fi

if [[ -f "$VERSION_TARBALL" ]]; then
  FILE_SHA1="$(shasum "$VERSION_TARBALL" | awk '{print $1}')"
  PACKUMENT_SHA1="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')).versions['$PKG_VERSION']?.dist?.shasum ?? ''" 2>/dev/null || true)"
  if [[ "$FILE_SHA1" == "$PACKUMENT_SHA1" ]]; then
    pass "Packument shasum matches version tarball"
  else
    fail "Packument shasum mismatch"
  fi
else
  skip "Version tarball checksum" "versioned tarball missing"
fi

section "Registry landing page and generator"
if contains "$GENERATOR" "$CONFIG_CMD"; then
  pass "Registry generator emits npm config set guidance"
else
  fail "Registry generator missing npm config set guidance"
fi

if omits "$GENERATOR" '>> ~/.npmrc'; then
  pass "Registry generator no longer uses shell redirection"
else
  fail "Registry generator still uses shell redirection"
fi

if [[ -f "$REGISTRY_INDEX" ]]; then
  pass "Registry landing page exists"
else
  fail "Registry landing page missing"
fi

if contains "$REGISTRY_INDEX" "$CONFIG_CMD"; then
  pass "Registry landing page shows npm config set guidance"
else
  fail "Registry landing page missing npm config set guidance"
fi

if contains "$REGISTRY_INDEX" "$INSTALL_CMD"; then
  pass "Registry landing page shows install command"
else
  fail "Registry landing page missing install command"
fi

if omits "$REGISTRY_INDEX" '>> ~/.npmrc'; then
  pass "Registry landing page no longer uses shell redirection"
else
  fail "Registry landing page still uses shell redirection"
fi

section "Release workflow"
for required in "Create GitHub release" "$CONFIG_CMD" "$INSTALL_CMD" "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24" "softprops/action-gh-release@v3"; do
  if contains "$RELEASE_YML" "$required"; then
    pass "release.yml contains '$required'"
  else
    fail "release.yml missing '$required'"
  fi
done

section "Workflow runtime alignment"
for workflow in "$CI_YML" "$DOCS_YML" "$SYNC_YML"; do
  label="$(basename "$workflow")"
  if contains "$workflow" 'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24'; then
    pass "$label opts JavaScript actions into Node 24"
  else
    fail "$label is missing FORCE_JAVASCRIPT_ACTIONS_TO_NODE24"
  fi
done

if contains "$SYNC_YML" 'peter-evans/create-pull-request@v8'; then
  pass "sync-linked-sources.yml uses create-pull-request@v8"
else
  fail "sync-linked-sources.yml is not on create-pull-request@v8"
fi

for forbidden in "NPM_TOKEN" "NODE_AUTH_TOKEN" "registry.npmjs.org" "npm publish --access public --provenance"; do
  if omits "$RELEASE_YML" "$forbidden"; then
    pass "release.yml omits '$forbidden'"
  else
    fail "release.yml still references '$forbidden'"
  fi
done

section "Release script"
for required in "verify_static_registry_latest" "wait_for_release_run" "wait_for_docs_run" "$CONFIG_CMD" "$INSTALL_CMD"; do
  if contains "$RELEASE_SH" "$required"; then
    pass "release.sh contains '$required'"
  else
    fail "release.sh missing '$required'"
  fi
done

for forbidden in "registry.npmjs.org/@eai-tools%2fcli" "npm publish --dry-run"; do
  if omits "$RELEASE_SH" "$forbidden"; then
    pass "release.sh omits '$forbidden'"
  else
    fail "release.sh still references '$forbidden'"
  fi
done

section "Human-facing docs and agent guidance"
for file in "$README" "$SETUP_MD" "$AGENTS_MD" "$CLAUDE_MD" "$COPILOT_MD"; do
  label="$(basename "$file")"
  if contains "$file" "$CONFIG_CMD"; then
    pass "$label contains npm config set guidance"
  else
    fail "$label missing npm config set guidance"
  fi
  if contains "$file" "$INSTALL_CMD"; then
    pass "$label contains install command"
  else
    fail "$label missing install command"
  fi
done

section "Technical docs"
if contains "$DEPLOY_DOC" "$CONFIG_CMD"; then
  pass "deployment.md contains npm config set guidance"
else
  fail "deployment.md missing npm config set guidance"
fi

if omits "$DEPLOY_DOC" '>> ~/.npmrc'; then
  pass "deployment.md no longer uses shell redirection"
else
  fail "deployment.md still uses shell redirection"
fi

if contains "$DEPLOY_DOC" 'eai update  # Reinstalls the latest CLI from the scoped EAI registry'; then
  pass "deployment.md explains the update command against the static registry"
else
  fail "deployment.md missing updated eai update guidance"
fi

section "Release-facing docs bundles"
for file in "$LLMS_INDEX" "$LLMS_FULL" "$CLI_HELP"; do
  label="$(basename "$file")"
  if [[ -f "$file" ]]; then
    pass "$label exists"
  else
    fail "$label missing"
    continue
  fi
  if contains "$file" "$INSTALL_CMD"; then
    pass "$label contains install command"
  else
    fail "$label missing install command"
  fi
done

if contains "$LLMS_INDEX" "$CONFIG_CMD"; then
  pass "llms.txt contains registry setup guidance"
else
  fail "llms.txt missing registry setup guidance"
fi

if contains "$LLMS_FULL" 'eai gofer refresh --help'; then
  pass "llms-full.txt contains current Gofer help output"
else
  fail "llms-full.txt missing Gofer help output"
fi

if contains "$LLMS_FULL" 'eai template check --help'; then
  pass "llms-full.txt contains template check help output"
else
  fail "llms-full.txt missing template check help output"
fi

if contains "$CLI_HELP" 'eai doctor --help'; then
  pass "cli-help.txt contains doctor help snapshot"
else
  fail "cli-help.txt missing doctor help snapshot"
fi

if contains "$CLI_HELP" 'eai template check --help'; then
  pass "cli-help.txt contains template check help snapshot"
else
  fail "cli-help.txt missing template check help snapshot"
fi

section "Build and docs generation"
if npm run build --prefix "$ROOT" >/dev/null 2>&1; then
  pass "npm run build succeeds"
else
  fail "npm run build failed"
fi

if npm run lint --prefix "$ROOT" >/dev/null 2>&1; then
  pass "npm run lint succeeds"
else
  fail "npm run lint failed"
fi

if (cd "$ROOT/docs-site" && npm run build >/dev/null 2>&1); then
  pass "docs-site build succeeds"
else
  fail "docs-site build failed"
fi

if [[ -f "$ROOT/docs-site/build/registry/index.html" ]]; then
  pass "Built docs include the registry landing page"
else
  fail "Built docs missing registry landing page"
fi

if [[ -f "$ROOT/docs-site/build/registry/@eai-tools/cli" ]]; then
  pass "Built docs include the packument"
else
  fail "Built docs missing the packument"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  Static Registry Verification"
echo "══════════════════════════════════════════"
echo ""
echo "  Pass: $PASS"
echo "  Fail: $FAIL"
echo "  Skip: $SKIP"
echo "  Total: $((PASS + FAIL + SKIP))"
echo ""

if (( FAIL > 0 )); then
  echo "  Result: FAIL"
  echo ""
  echo "══════════════════════════════════════════"
  exit 1
fi

echo "  Result: PASS"
echo ""
echo "══════════════════════════════════════════"
