#!/usr/bin/env bash
set -euo pipefail

# Release-channel verification for @enterpriseai/cli.
# npmjs is the primary install/update channel. The GitHub Pages static registry
# remains a fallback for older installs and emergency recovery.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKUMENT="$ROOT/docs-site/static/registry/@enterpriseai/cli"
ENCODED_PACKUMENT="$ROOT/docs-site/static/registry/@enterpriseai%2fcli"
TARBALL_DIR="$ROOT/docs-site/static/registry/-/@enterpriseai"
REGISTRY_INDEX="$ROOT/docs-site/static/registry/index.html"
CI_YML="$ROOT/.github/workflows/ci.yml"
DOCS_YML="$ROOT/.github/workflows/docs.yml"
RELEASE_YML="$ROOT/.github/workflows/release.yml"
RELEASE_SH="$ROOT/release.sh"
SYNC_YML="$ROOT/.github/workflows/sync-linked-sources.yml"
GENERATOR="$ROOT/scripts/generate-registry.cjs"
ALIAS_GENERATOR="$ROOT/scripts/build-npm-alias-package.cjs"
README="$ROOT/README.md"
SETUP_MD="$ROOT/.github/SETUP.md"
AGENTS_MD="$ROOT/AGENTS.md"
CLAUDE_MD="$ROOT/CLAUDE.md"
COPILOT_MD="$ROOT/.github/copilot-instructions.md"
START_HERE_DOC="$ROOT/.tech-docs/start-here.md"
API_REFERENCE_DOC="$ROOT/.tech-docs/api-reference.md"
EAI_CLI_DOC="$ROOT/.tech-docs/eai-cli.md"
LLMS_INDEX="$ROOT/docs-site/static/llms.txt"
LLMS_FULL="$ROOT/docs-site/static/llms-full.txt"
CLI_HELP="$ROOT/docs-site/static/cli-help.txt"
STATIC_REGISTRY_URL="https://eai-tools.github.io/eai/registry/"
CONFIG_CMD="npm config set @enterpriseai:registry ${STATIC_REGISTRY_URL} --location=user"
RECOMMENDED_INSTALL_CMD="npm install -g eai-cli"
CANONICAL_INSTALL_CMD="npm install -g @enterpriseai/cli"
STATIC_FALLBACK_CMD="npm install -g @enterpriseai/cli --@enterpriseai:registry=${STATIC_REGISTRY_URL}"
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

section "Static fallback packument validity"
if [[ -f "$PACKUMENT" ]]; then
  pass "Canonical packument exists"
else
  fail "Canonical packument missing: $PACKUMENT"
fi

if node -e "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8'))" 2>/dev/null; then
  pass "Canonical packument is valid JSON"
else
  fail "Canonical packument is not valid JSON"
fi

if [[ -f "$ENCODED_PACKUMENT" ]]; then
  pass "Canonical encoded packument exists for npm client compatibility"
else
  fail "Canonical encoded packument missing: $ENCODED_PACKUMENT"
fi

PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
LATEST_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8'))['dist-tags']?.latest ?? ''" 2>/dev/null || true)"
if [[ "$LATEST_VERSION" == "$PKG_VERSION" ]]; then
  pass "Canonical packument latest matches package.json ($PKG_VERSION)"
else
  fail "Canonical packument latest mismatch: package.json=$PKG_VERSION packument=${LATEST_VERSION:-missing}"
fi

if node -e "const p=JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')); process.exit(p.versions?.['$PKG_VERSION'] ? 0 : 1)" 2>/dev/null; then
  pass "Canonical packument contains version entry for $PKG_VERSION"
else
  fail "Canonical packument missing version entry for $PKG_VERSION"
fi

EXPECTED_URL="${STATIC_REGISTRY_URL}-/@enterpriseai/cli-${PKG_VERSION}.tgz"
ACTUAL_URL="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')).versions['$PKG_VERSION']?.dist?.tarball ?? ''" 2>/dev/null || true)"
if [[ "$ACTUAL_URL" == "$EXPECTED_URL" ]]; then
  pass "Canonical packument tarball URL uses the static fallback registry"
else
  fail "Canonical packument tarball URL mismatch: expected $EXPECTED_URL got ${ACTUAL_URL:-missing}"
fi

VERSION_TARBALL="$TARBALL_DIR/cli-${PKG_VERSION}.tgz"
LATEST_TARBALL="$TARBALL_DIR/cli-latest.tgz"
if [[ -f "$VERSION_TARBALL" ]]; then
  pass "Canonical versioned fallback tarball exists"
else
  fail "Canonical versioned fallback tarball missing: $VERSION_TARBALL"
fi

if [[ -f "$LATEST_TARBALL" ]]; then
  pass "Canonical latest fallback tarball alias exists"
else
  fail "Canonical latest fallback tarball alias missing: $LATEST_TARBALL"
fi

if [[ -f "$VERSION_TARBALL" ]]; then
  FILE_SHA1="$(shasum "$VERSION_TARBALL" | awk '{print $1}')"
  PACKUMENT_SHA1="$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf8')).versions['$PKG_VERSION']?.dist?.shasum ?? ''" 2>/dev/null || true)"
  if [[ "$FILE_SHA1" == "$PACKUMENT_SHA1" ]]; then
    pass "Canonical packument shasum matches version tarball"
  else
    fail "Canonical packument shasum mismatch"
  fi
else
  skip "Canonical version tarball checksum" "versioned tarball missing"
fi

section "Registry landing page and generators"
for required in "$RECOMMENDED_INSTALL_CMD" "$CANONICAL_INSTALL_CMD" "$CONFIG_CMD" "$STATIC_FALLBACK_CMD"; do
  if contains "$GENERATOR" "$required"; then
    pass "Registry generator contains '$required'"
  else
    fail "Registry generator missing '$required'"
  fi
done

if contains "$ALIAS_GENERATOR" "aliasPackageJson('eai-cli'"; then
  pass "Alias package generator builds eai-cli"
else
  fail "Alias package generator does not build eai-cli"
fi

if [[ -f "$REGISTRY_INDEX" ]]; then
  pass "Registry landing page exists"
else
  fail "Registry landing page missing"
fi

for required in "$RECOMMENDED_INSTALL_CMD" "$CANONICAL_INSTALL_CMD" "$CONFIG_CMD" "$STATIC_FALLBACK_CMD"; do
  if contains "$REGISTRY_INDEX" "$required"; then
    pass "Registry landing page contains '$required'"
  else
    fail "Registry landing page missing '$required'"
  fi
done

if omits "$REGISTRY_INDEX" '>> ~/.npmrc'; then
  pass "Registry landing page no longer uses shell redirection"
else
  fail "Registry landing page still uses shell redirection"
fi

section "Release workflow"
for required in \
  "Create GitHub release" \
  "id-token: write" \
  "registry-url: https://registry.npmjs.org/" \
  "npm install -g npm@11.18.0" \
  "npm publish --access public --provenance" \
  "npm publish .release/eai-cli-package --access public --provenance" \
  "node scripts/build-npm-alias-package.cjs" \
  "$RECOMMENDED_INSTALL_CMD" \
  "$CANONICAL_INSTALL_CMD" \
  "$STATIC_FALLBACK_CMD" \
  "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24" \
  "softprops/action-gh-release@v3"; do
  if contains "$RELEASE_YML" "$required"; then
    pass "release.yml contains '$required'"
  else
    fail "release.yml missing '$required'"
  fi
done

for forbidden in "NPM_TOKEN" "NODE_AUTH_TOKEN"; do
  if omits "$RELEASE_YML" "$forbidden"; then
    pass "release.yml omits long-lived token '$forbidden'"
  else
    fail "release.yml references long-lived token '$forbidden'"
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

section "Release script"
for required in \
  "verify_npmjs_latest" \
  "verify_static_registry_latest" \
  "wait_for_release_run" \
  "wait_for_docs_run" \
  "$RECOMMENDED_INSTALL_CMD" \
  "$CANONICAL_INSTALL_CMD" \
  "$STATIC_FALLBACK_CMD"; do
  if contains "$RELEASE_SH" "$required"; then
    pass "release.sh contains '$required'"
  else
    fail "release.sh missing '$required'"
  fi
done

section "Human-facing docs and agent guidance"
for file in "$README" "$SETUP_MD" "$AGENTS_MD" "$CLAUDE_MD" "$COPILOT_MD" "$START_HERE_DOC" "$API_REFERENCE_DOC" "$EAI_CLI_DOC"; do
  label="$(basename "$file")"
  for required in "$RECOMMENDED_INSTALL_CMD" "$CANONICAL_INSTALL_CMD" "$STATIC_FALLBACK_CMD"; do
    if contains "$file" "$required"; then
      pass "$label contains '$required'"
    else
      fail "$label missing '$required'"
    fi
  done
done

section "Release-facing docs bundles"
for file in "$LLMS_INDEX" "$LLMS_FULL" "$CLI_HELP"; do
  label="$(basename "$file")"
  if [[ -f "$file" ]]; then
    pass "$label exists"
  else
    fail "$label missing"
    continue
  fi
  if contains "$file" "$RECOMMENDED_INSTALL_CMD"; then
    pass "$label contains recommended install command"
  else
    fail "$label missing recommended install command"
  fi
done

if contains "$LLMS_INDEX" "$STATIC_FALLBACK_CMD"; then
  pass "llms.txt contains static fallback guidance"
else
  fail "llms.txt missing static fallback guidance"
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

if [[ -f "$ROOT/docs-site/build/registry/@enterpriseai/cli" ]]; then
  pass "Built docs include the canonical fallback packument"
else
  fail "Built docs missing canonical fallback packument"
fi


echo ""
echo "══════════════════════════════════════════"
echo "  Release Channel Verification"
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
