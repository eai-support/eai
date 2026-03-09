#!/usr/bin/env bash
set -euo pipefail

# ── Static npm Registry Verification ──
# Runs automatable test cases from test-cases.md (TC001-TC040)
# Usage: ./scripts/verify-registry.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKUMENT="$ROOT/docs/public/registry/@eai-tools/cli"
TARBALL_DIR="$ROOT/docs/public/registry/-/@eai-tools"
PASS=0
FAIL=0
SKIP=0

pass() { ((PASS++)); echo "  ✓ $1"; }
fail() { ((FAIL++)); echo "  ✗ $1"; }
skip() { ((SKIP++)); echo "  ○ $1 (skipped — $2)"; }
section() { echo ""; echo "▸ $1"; }

# ══════════════════════════════════════════
#  Phase 1: Registry Generation Script
# ══════════════════════════════════════════

section "TC001: Packument file exists and is valid JSON"
if [[ -f "$PACKUMENT" ]]; then
  pass "Packument file exists"
else
  fail "Packument file missing: $PACKUMENT"
fi

if node -e "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8'))" 2>/dev/null; then
  pass "Packument is valid JSON"
else
  fail "Packument is not valid JSON"
fi

section "TC002: Packument has required top-level and version fields"
PKG_VERSION=$(node -p "require('$ROOT/package.json').version")
PJSON=$(node -e "
  const p = JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8'));
  const v = p.versions['$PKG_VERSION'];
  const checks = {
    name: p.name === '@eai-tools/cli',
    distTags: 'latest' in (p['dist-tags'] || {}),
    versions: Object.keys(p.versions || {}).length > 0,
    vName: v && v.name === '@eai-tools/cli',
    vVersion: v && v.version === '$PKG_VERSION',
    vDescription: v && typeof v.description === 'string',
    vBin: v && v.bin && v.bin.eai === './dist/index.js',
    vEngines: v && v.engines && v.engines.node === '>=20.0.0',
    vDeps: v && typeof v.dependencies === 'object',
    vTarball: v && v.dist && typeof v.dist.tarball === 'string',
    vShasum: v && v.dist && typeof v.dist.shasum === 'string',
    vIntegrity: v && v.dist && typeof v.dist.integrity === 'string',
  };
  console.log(JSON.stringify(checks));
" 2>/dev/null || echo '{}')

for field in name distTags versions vName vVersion vDescription vBin vEngines vDeps vTarball vShasum vIntegrity; do
  val=$(echo "$PJSON" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).$field" 2>/dev/null || echo "false")
  if [[ "$val" == "true" ]]; then
    pass "Field check: $field"
  else
    fail "Field check: $field"
  fi
done

section "TC003: Tarball exists at correct registry path"
TARBALL_FILE="$TARBALL_DIR/cli-${PKG_VERSION}.tgz"
if [[ -f "$TARBALL_FILE" ]]; then
  pass "Tarball exists: cli-${PKG_VERSION}.tgz"
else
  fail "Tarball missing: $TARBALL_FILE"
fi

if [[ -f "$TARBALL_FILE" ]] && [[ -s "$TARBALL_FILE" ]]; then
  pass "Tarball is non-empty"
else
  fail "Tarball is empty or missing"
fi

section "TC004: Tarball URL points to GitHub Pages"
EXPECTED_URL="https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-${PKG_VERSION}.tgz"
ACTUAL_URL=$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8')).versions['$PKG_VERSION'].dist.tarball" 2>/dev/null || echo "")
if [[ "$ACTUAL_URL" == "$EXPECTED_URL" ]]; then
  pass "Tarball URL correct"
else
  fail "Tarball URL mismatch: expected $EXPECTED_URL, got $ACTUAL_URL"
fi

section "TC005: SHA-1 and SHA-512 hashes are correct"
if [[ -f "$TARBALL_FILE" ]]; then
  # SHA-1
  ACTUAL_SHA1=$(shasum "$TARBALL_FILE" | cut -d' ' -f1)
  PACKUMENT_SHA1=$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8')).versions['$PKG_VERSION'].dist.shasum" 2>/dev/null || echo "")
  if [[ "$ACTUAL_SHA1" == "$PACKUMENT_SHA1" ]]; then
    pass "SHA-1 matches ($ACTUAL_SHA1)"
  else
    fail "SHA-1 mismatch: file=$ACTUAL_SHA1 packument=$PACKUMENT_SHA1"
  fi

  # SHA-512
  ACTUAL_SHA512=$(openssl dgst -sha512 -binary "$TARBALL_FILE" | base64)
  PACKUMENT_INTEGRITY=$(node -p "JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8')).versions['$PKG_VERSION'].dist.integrity" 2>/dev/null || echo "")
  EXPECTED_INTEGRITY="sha512-${ACTUAL_SHA512}"
  if [[ "$EXPECTED_INTEGRITY" == "$PACKUMENT_INTEGRITY" ]]; then
    pass "SHA-512 integrity matches"
  else
    fail "SHA-512 mismatch: computed=$EXPECTED_INTEGRITY packument=$PACKUMENT_INTEGRITY"
  fi

  INTEGRITY_PREFIX="${PACKUMENT_INTEGRITY:0:7}"
  if [[ "$INTEGRITY_PREFIX" == "sha512-" ]]; then
    pass "Integrity starts with sha512-"
  else
    fail "Integrity prefix: $INTEGRITY_PREFIX"
  fi
else
  skip "SHA-1 check" "tarball missing"
  skip "SHA-512 check" "tarball missing"
  skip "Integrity prefix" "tarball missing"
fi

section "TC025: Tarball integrity — registry copy matches source"
SOURCE_TGZ=$(ls "$ROOT"/eai-tools-cli-*.tgz 2>/dev/null | head -1 || true)
if [[ -n "$SOURCE_TGZ" ]] && [[ -f "$TARBALL_FILE" ]]; then
  SRC_HASH=$(shasum "$SOURCE_TGZ" | cut -d' ' -f1)
  REG_HASH=$(shasum "$TARBALL_FILE" | cut -d' ' -f1)
  if [[ "$SRC_HASH" == "$REG_HASH" ]]; then
    pass "Registry tarball matches source tarball"
  else
    fail "Tarball mismatch: source=$SRC_HASH registry=$REG_HASH"
  fi
else
  skip "Tarball copy integrity" "source .tgz not found (run npm pack first)"
fi

section "TC038: Packument structure supports semver resolution"
SEMVER_CHECK=$(node -e "
  const p = JSON.parse(require('fs').readFileSync('$PACKUMENT','utf-8'));
  const versions = Object.keys(p.versions);
  const latest = p['dist-tags'].latest;
  const allValid = versions.every(v => /^\d+\.\d+\.\d+/.test(v));
  const latestExists = versions.includes(latest);
  const allHaveFields = versions.every(v => {
    const e = p.versions[v];
    return e.dependencies && e.engines && e.bin;
  });
  console.log(JSON.stringify({ allValid, latestExists, allHaveFields, count: versions.length }));
" 2>/dev/null || echo '{}')

for check in allValid latestExists allHaveFields; do
  val=$(echo "$SEMVER_CHECK" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).$check" 2>/dev/null || echo "false")
  if [[ "$val" == "true" ]]; then
    pass "Semver check: $check"
  else
    fail "Semver check: $check"
  fi
done

section "TC039: Packument lists all published versions"
VERSION_COUNT=$(echo "$SEMVER_CHECK" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).count" 2>/dev/null || echo "0")
if (( VERSION_COUNT > 0 )); then
  pass "Packument has $VERSION_COUNT version(s)"
else
  fail "Packument has no versions"
fi

# ══════════════════════════════════════════
#  Phase 2: Release Workflow (release.yml)
# ══════════════════════════════════════════

RELEASE_YML="$ROOT/.github/workflows/release.yml"

section "TC006: No npm publish in release workflow"
for term in "npm publish" "NPM_TOKEN" "registry.npmjs.org" "NODE_AUTH_TOKEN"; do
  if grep -q "$term" "$RELEASE_YML" 2>/dev/null; then
    fail "Found '$term' in release.yml"
  else
    pass "No '$term' in release.yml"
  fi
done

section "TC007: Registry generation step exists in workflow"
for term in "node scripts/generate-registry.cjs" "git add docs/public/registry/" "git push origin HEAD:main"; do
  if grep -q "$term" "$RELEASE_YML" 2>/dev/null; then
    pass "Found '$term' in release.yml"
  else
    fail "Missing '$term' in release.yml"
  fi
done

section "TC008: GitHub Release body has correct install instructions"
if grep -q "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry" "$RELEASE_YML" 2>/dev/null; then
  pass "Release body has .npmrc config"
else
  fail "Release body missing .npmrc config"
fi
if grep -q "npm install -g @eai-tools/cli" "$RELEASE_YML" 2>/dev/null; then
  pass "Release body has npm install"
else
  fail "Release body missing npm install"
fi
for term in "brew" "homebrew" "tap"; do
  if grep -qi "$term" "$RELEASE_YML" 2>/dev/null; then
    fail "Found '$term' in release.yml"
  else
    pass "No '$term' in release.yml"
  fi
done

# ══════════════════════════════════════════
#  Phase 3: Release Script (release.sh)
# ══════════════════════════════════════════

RELEASE_SH="$ROOT/release.sh"

section "TC026: Release script has registry generation step"
if grep -q "node scripts/generate-registry.cjs" "$RELEASE_SH" 2>/dev/null; then
  pass "release.sh has generate-registry.cjs"
else
  fail "release.sh missing generate-registry.cjs"
fi

# Verify npm pack appears before generate-registry
PACK_LINE=$(grep -n "npm pack" "$RELEASE_SH" 2>/dev/null | head -1 | cut -d: -f1 || echo "0")
GEN_LINE=$(grep -n "generate-registry.cjs" "$RELEASE_SH" 2>/dev/null | head -1 | cut -d: -f1 || echo "0")
if (( PACK_LINE > 0 && GEN_LINE > 0 && PACK_LINE < GEN_LINE )); then
  pass "npm pack appears before generate-registry"
else
  fail "npm pack should appear before generate-registry (pack=$PACK_LINE gen=$GEN_LINE)"
fi

section "TC027: Release script stages registry files"
if grep -q "docs/public/registry/" "$RELEASE_SH" 2>/dev/null; then
  pass "release.sh stages registry files"
else
  fail "release.sh missing registry file staging"
fi

section "TC028: Release script install instructions use .npmrc"
if grep -q "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry" "$RELEASE_SH" 2>/dev/null; then
  pass "release.sh has .npmrc registry URL"
else
  fail "release.sh missing .npmrc registry URL"
fi
if grep -q "npm install -g @eai-tools/cli" "$RELEASE_SH" 2>/dev/null; then
  pass "release.sh has npm install instruction"
else
  fail "release.sh missing npm install instruction"
fi
for term in "brew" "homebrew"; do
  if grep -qi "$term" "$RELEASE_SH" 2>/dev/null; then
    fail "Found '$term' in release.sh"
  else
    pass "No '$term' in release.sh"
  fi
done

# ══════════════════════════════════════════
#  Phase 4: Package.json Cleanup
# ══════════════════════════════════════════

section "TC029: No publishConfig in package.json"
if node -e "
  const p = JSON.parse(require('fs').readFileSync('$ROOT/package.json','utf-8'));
  if (p.publishConfig) process.exit(1);
" 2>/dev/null; then
  pass "No publishConfig in package.json"
else
  fail "publishConfig found in package.json"
fi

if node -e "JSON.parse(require('fs').readFileSync('$ROOT/package.json','utf-8'))" 2>/dev/null; then
  pass "package.json is valid JSON"
else
  fail "package.json is not valid JSON"
fi

section "TC030: Build still works"
if npm run build --prefix "$ROOT" >/dev/null 2>&1; then
  pass "npm run build succeeds"
else
  fail "npm run build failed"
fi

# ══════════════════════════════════════════
#  Phase 5: Documentation Content
# ══════════════════════════════════════════

INSTALL_MDX="$ROOT/docs/src/content/docs/getting-started/installation.mdx"
INDEX_MDX="$ROOT/docs/src/content/docs/index.mdx"
GLOSSARY_MDX="$ROOT/docs/src/content/docs/reference/glossary.mdx"
README="$ROOT/README.md"
SETUP_MD="$ROOT/.github/SETUP.md"

section "TC012: Installation page has .npmrc configuration"
if grep -q '@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry' "$INSTALL_MDX" 2>/dev/null; then
  pass "installation.mdx has registry URL"
else
  fail "installation.mdx missing registry URL"
fi
if grep -q '>> ~/.npmrc' "$INSTALL_MDX" 2>/dev/null; then
  pass "installation.mdx has .npmrc echo command"
else
  fail "installation.mdx missing .npmrc echo command"
fi

section "TC013: Installation page has npm as primary method"
if grep -q 'label="npm (recommended)"' "$INSTALL_MDX" 2>/dev/null; then
  pass "npm (recommended) tab exists"
else
  fail "npm (recommended) tab missing"
fi
if grep -q "npm install -g @eai-tools/cli" "$INSTALL_MDX" 2>/dev/null; then
  pass "npm install command present"
else
  fail "npm install command missing"
fi

section "TC014: Installation page has three install tabs"
for tab in 'label="npm (recommended)"' 'label="npm from GitHub"' 'label="From source"'; do
  if grep -q "$tab" "$INSTALL_MDX" 2>/dev/null; then
    pass "Tab found: $tab"
  else
    fail "Tab missing: $tab"
  fi
done

section "TC015: Installation page has version pinning"
if grep -q "npm install -g @eai-tools/cli@0.1.0" "$INSTALL_MDX" 2>/dev/null; then
  pass "Version pinning example present"
else
  fail "Version pinning example missing"
fi

section "TC016: Installation page has update instructions"
if grep -q "npm install -g @eai-tools/cli@latest" "$INSTALL_MDX" 2>/dev/null; then
  pass "Update command present"
else
  fail "Update command missing"
fi

section "TC017: No Homebrew in installation docs"
for term in "homebrew" "brew install" "brew tap" "Homebrew"; do
  if grep -qi "$term" "$INSTALL_MDX" 2>/dev/null; then
    fail "Found '$term' in installation.mdx"
  else
    pass "No '$term' in installation.mdx"
  fi
done

section "TC018: No Homebrew in any modified documentation"
for file in "$README" "$SETUP_MD" "$INDEX_MDX" "$GLOSSARY_MDX"; do
  fname=$(basename "$file")
  if grep -qi "brew" "$file" 2>/dev/null; then
    fail "Found 'brew' in $fname"
  else
    pass "No 'brew' in $fname"
  fi
done

section "TC031: Homepage install section has .npmrc"
if grep -q '@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry' "$INDEX_MDX" 2>/dev/null; then
  pass "index.mdx has registry URL"
else
  fail "index.mdx missing registry URL"
fi
if grep -q "npm install -g @eai-tools/cli" "$INDEX_MDX" 2>/dev/null; then
  pass "index.mdx has npm install"
else
  fail "index.mdx missing npm install"
fi
if grep -q "npx @eai-tools/cli" "$INDEX_MDX" 2>/dev/null; then
  fail "index.mdx still has npx (won't work without .npmrc)"
else
  pass "index.mdx has no npx reference"
fi

section "TC032: Glossary CLI entry mentions .npmrc"
if grep -q "configuring the EAI registry in" "$GLOSSARY_MDX" 2>/dev/null; then
  pass "Glossary mentions .npmrc configuration"
else
  fail "Glossary missing .npmrc mention"
fi

section "TC033: README install section uses .npmrc method"
if grep -q '@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry' "$README" 2>/dev/null; then
  pass "README has registry URL"
else
  fail "README missing registry URL"
fi
if grep -q "npm install -g @eai-tools/cli" "$README" 2>/dev/null; then
  pass "README has npm install"
else
  fail "README missing npm install"
fi
if grep -q 'github:eai-tools/eai-cli' "$README" 2>/dev/null; then
  fail "README still has old github: install method"
else
  pass "README no old github: install method"
fi
if grep -q "Registry generation" "$README" 2>/dev/null; then
  pass "README has registry generation in release docs"
else
  fail "README missing registry generation in release docs"
fi

section "TC011: SETUP.md describes static registry"
if grep -q "static npm registry" "$SETUP_MD" 2>/dev/null; then
  pass "SETUP.md mentions static npm registry"
else
  fail "SETUP.md missing static npm registry"
fi
if grep -q "GitHub Pages" "$SETUP_MD" 2>/dev/null; then
  pass "SETUP.md mentions GitHub Pages"
else
  fail "SETUP.md missing GitHub Pages"
fi
if grep -q 'Set the name to.*NPM_TOKEN' "$SETUP_MD" 2>/dev/null || grep -q 'secret.*NPM_TOKEN' "$SETUP_MD" 2>/dev/null; then
  fail "SETUP.md still has NPM_TOKEN setup instructions"
else
  pass "SETUP.md no NPM_TOKEN setup instructions"
fi
if grep -q "Generate static registry metadata" "$SETUP_MD" 2>/dev/null; then
  pass "SETUP.md describes registry generation"
else
  fail "SETUP.md missing registry generation description"
fi

# ══════════════════════════════════════════
#  Build & Integration
# ══════════════════════════════════════════

section "TC034: TypeScript build succeeds"
if npm run build --prefix "$ROOT" >/dev/null 2>&1; then
  pass "TypeScript build succeeds"
else
  fail "TypeScript build failed"
fi

section "TC035: ESLint passes"
if npm run lint --prefix "$ROOT" >/dev/null 2>&1; then
  pass "ESLint passes"
else
  fail "ESLint failed"
fi

section "TC036: Docs site builds and includes registry files"
if (cd "$ROOT/docs" && npm run build >/dev/null 2>&1); then
  pass "Docs build succeeds"
else
  fail "Docs build failed"
fi
if [[ -f "$ROOT/docs/dist/registry/@eai-tools/cli" ]]; then
  pass "Packument in docs/dist"
else
  fail "Packument missing from docs/dist"
fi
if [[ -f "$ROOT/docs/dist/registry/-/@eai-tools/cli-${PKG_VERSION}.tgz" ]]; then
  pass "Tarball in docs/dist"
else
  fail "Tarball missing from docs/dist"
fi

section "TC037: Packument survives Astro build (source matches dist)"
if [[ -f "$ROOT/docs/dist/registry/@eai-tools/cli" ]]; then
  if diff -q "$PACKUMENT" "$ROOT/docs/dist/registry/@eai-tools/cli" >/dev/null 2>&1; then
    pass "Packument source matches dist"
  else
    fail "Packument differs between source and dist"
  fi
else
  skip "Packument diff" "dist file missing"
fi

# ══════════════════════════════════════════
#  Manual Tests (skipped — require deployed Pages)
# ══════════════════════════════════════════

section "Manual tests (TC019-TC022 — require deployed GitHub Pages)"
skip "TC019: Documented steps lead to working install" "requires deployed Pages"
skip "TC020: npm outdated detects available update" "requires deployed Pages with 2+ versions"
skip "TC021: npm install @latest upgrades" "requires deployed Pages with 2+ versions"
skip "TC022: Missing .npmrc produces clear failure" "requires clean environment"

# ══════════════════════════════════════════
#  Destructive Tests (skipped — would modify working tree)
# ══════════════════════════════════════════

section "Destructive tests (TC009, TC010, TC023, TC024, TC040 — would modify files)"
skip "TC009: Version accumulation" "would modify package.json"
skip "TC010: Prior version preservation" "would modify package.json"
skip "TC023: First-ever run from scratch" "would delete registry files"
skip "TC024: Idempotent generation" "would regenerate registry"
skip "TC040: Re-tagged release changes hashes" "would modify source files"

# ══════════════════════════════════════════
#  Summary
# ══════════════════════════════════════════

echo ""
echo "══════════════════════════════════════════"
echo "  Static npm Registry Verification"
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
else
  echo "  Result: PASS"
  echo ""
  echo "══════════════════════════════════════════"
  exit 0
fi
