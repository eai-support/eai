#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$ROOT/docs-site"
PACKUMENT="$ROOT/docs-site/static/registry/@enterpriseai/cli"
GENERATED_TARBALL=""
GENERATED_ALIAS_TARBALL=""
BACKUP_DIR=""
PACKED_INSTALL_PREFIX=""
ALIAS_INSTALL_PREFIX=""

section() {
  echo ""
  echo "▸ $1"
}

cleanup() {
  if [[ -n "$GENERATED_TARBALL" ]]; then
    rm -f "$ROOT/$GENERATED_TARBALL" 2>/dev/null || true
  fi
  if [[ -n "$GENERATED_ALIAS_TARBALL" ]]; then
    rm -f "$ROOT/$GENERATED_ALIAS_TARBALL" 2>/dev/null || true
  fi
  rm -rf "$ROOT/.release" 2>/dev/null || true
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -rf "$ROOT/docs-site/static/registry"
    if [[ -d "$BACKUP_DIR/registry" ]]; then
      cp -R "$BACKUP_DIR/registry" "$ROOT/docs-site/static/registry"
    fi

    for file in llms.txt llms-full.txt cli-help.txt error-guidance.json; do
      rm -f "$ROOT/docs-site/static/$file"
      if [[ -f "$BACKUP_DIR/$file" ]]; then
        cp "$BACKUP_DIR/$file" "$ROOT/docs-site/static/$file"
      fi
    done

    rm -rf "$BACKUP_DIR"
  fi
  if [[ -n "$PACKED_INSTALL_PREFIX" && -d "$PACKED_INSTALL_PREFIX" ]]; then
    rm -rf "$PACKED_INSTALL_PREFIX"
  fi
  if [[ -n "$ALIAS_INSTALL_PREFIX" && -d "$ALIAS_INSTALL_PREFIX" ]]; then
    rm -rf "$ALIAS_INSTALL_PREFIX"
  fi
}

trap cleanup EXIT

cd "$ROOT"

BACKUP_DIR="$(mktemp -d)"
if [[ -d "$ROOT/docs-site/static/registry" ]]; then
  cp -R "$ROOT/docs-site/static/registry" "$BACKUP_DIR/registry"
fi
for file in llms.txt llms-full.txt cli-help.txt error-guidance.json; do
  if [[ -f "$ROOT/docs-site/static/$file" ]]; then
    cp "$ROOT/docs-site/static/$file" "$BACKUP_DIR/$file"
  fi
done

section "Checking release prerequisites"
for command in node npm git; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "✗ Required command not found: $command"
    exit 1
  fi
done
echo "  ✓ Required commands are available"

section "Installing CLI dependencies"
npm ci --silent
echo "  ✓ npm ci"

section "Running typecheck"
npm run typecheck
echo "  ✓ typecheck"

section "Running lint"
npm run lint
echo "  ✓ lint"

section "Building CLI"
npm run build
echo "  ✓ build"

section "Running tests"
npm run test
echo "  ✓ tests"

section "Smoke testing generated CLI"
CLI_VERSION="$(node dist/index.js --version 2>&1 | tr -d '\r')"
HELP_OUTPUT="$(node dist/index.js --help 2>&1)"
echo "  ✓ eai --version -> $CLI_VERSION"

if ! grep -q "Enterprise AI Platform CLI" <<<"$HELP_OUTPUT"; then
  echo "✗ eai --help is missing the expected product banner"
  exit 1
fi

for command_name in init login dev types resources deploy env verify chat docs whoami doctor update tenant user template; do
  if ! grep -q "$command_name" <<<"$HELP_OUTPUT"; then
    echo "✗ eai --help is missing command group: $command_name"
    exit 1
  fi
done
echo "  ✓ help output contains expected command groups"

section "Checking full e2e command traceability"
node scripts/eai-full-e2e-smoke.cjs --check --write-doc
echo "  ✓ full e2e smoke traceability is current"

section "Scanning for internal platform terminology leaks"
if ! LEAKS="$(node scripts/verify-release-terminology.cjs)"; then
  echo "✗ Internal platform terms found in release surface:"
  echo "$LEAKS"
  exit 1
fi
echo "  ✓ no internal terminology leaks"

section "Verifying API reference routes match code"
node scripts/verify-api-reference.cjs --check
echo "  ✓ api-reference routes align with src/lib/api.ts"

section "Verifying error guidance catalog"
node scripts/verify-error-guidance.cjs
node scripts/generate-error-guidance-docs.cjs --check
echo "  ✓ error guidance catalog and docs align"

section "Building docs site"
(cd "$DOCS_DIR" && npm ci --silent && npm run build >/dev/null)
echo "  ✓ docs-site build"

section "Generating release artifacts"
GENERATED_TARBALL="$(npm pack --silent)"
node scripts/build-npm-alias-package.cjs >/dev/null
GENERATED_ALIAS_TARBALL="$(npm pack --silent .release/eai-cli-package)"
node scripts/generate-registry.cjs >/dev/null
node scripts/generate-error-guidance-docs.cjs >/dev/null
node scripts/generate-release-docs.cjs >/dev/null
echo "  ✓ npm pack -> $GENERATED_TARBALL"
echo "  ✓ eai-cli alias pack -> $GENERATED_ALIAS_TARBALL"
echo "  ✓ static registry metadata regenerated"
echo "  ✓ release-facing docs regenerated"

section "Smoke testing packed CLI tarball"
PACKED_INSTALL_PREFIX="$(mktemp -d)"
npm install --global --omit=dev --prefix "$PACKED_INSTALL_PREFIX" "$ROOT/$GENERATED_TARBALL" --silent
PACKED_EAI="$PACKED_INSTALL_PREFIX/bin/eai"
PACKED_VERSION="$("$PACKED_EAI" --version 2>&1 | tr -d '\r')"
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
UPDATE_PACKUMENT_URL="$(
  node -e "process.stdout.write('data:application/json,' + encodeURIComponent(JSON.stringify({ 'dist-tags': { latest: process.argv[1] } })))" "$EXPECTED_VERSION"
)"
if [[ "$PACKED_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "✗ packed eai --version returned $PACKED_VERSION, expected $EXPECTED_VERSION"
  exit 1
fi
echo "  ✓ packed eai --version -> $PACKED_VERSION"

PACKED_HELP="$("$PACKED_EAI" --help 2>&1)"
if ! grep -q "Enterprise AI Platform CLI" <<<"$PACKED_HELP"; then
  echo "✗ packed eai --help is missing the expected product banner"
  exit 1
fi
for command_name in update template doctor gofer publicapi errors agent; do
  if ! "$PACKED_EAI" "$command_name" --help >/dev/null 2>&1; then
    echo "✗ packed eai $command_name --help failed"
    exit 1
  fi
done
if ! "$PACKED_EAI" errors explain E101 --format json >/dev/null 2>&1; then
  echo "✗ packed eai errors explain E101 --format json failed"
  exit 1
fi
if ! "$PACKED_EAI" agent guide --format json >/dev/null 2>&1; then
  echo "✗ packed eai agent guide --format json failed"
  exit 1
fi
if ! "$PACKED_EAI" template check --help >/dev/null 2>&1; then
  echo "✗ packed eai template check --help failed"
  exit 1
fi
if ! "$PACKED_EAI" gofer refresh --help >/dev/null 2>&1; then
  echo "✗ packed eai gofer refresh --help failed"
  exit 1
fi
if ! EAI_UPDATE_NPMJS_PACKUMENT_URL="$UPDATE_PACKUMENT_URL" EAI_UPDATE_PACKUMENT_URL="$UPDATE_PACKUMENT_URL" NO_COLOR=1 "$PACKED_EAI" update --check --no-project-refresh >/dev/null 2>&1; then
  echo "✗ packed eai update --check failed"
  exit 1
fi
echo "  ✓ packed CLI starts with production dependencies only"
echo "  ✓ packed eai update --check succeeds"

section "Smoke testing packed eai-cli alias tarball"
ALIAS_INSTALL_PREFIX="$(mktemp -d)"
npm install --global --omit=dev --prefix "$ALIAS_INSTALL_PREFIX" "$ROOT/$GENERATED_ALIAS_TARBALL" --silent
ALIAS_EAI="$ALIAS_INSTALL_PREFIX/bin/eai"
ALIAS_VERSION="$("$ALIAS_EAI" --version 2>&1 | tr -d '\r')"
if [[ "$ALIAS_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "✗ packed eai-cli alias eai --version returned $ALIAS_VERSION, expected $EXPECTED_VERSION"
  exit 1
fi
if ! "$ALIAS_EAI" --help >/dev/null 2>&1; then
  echo "✗ packed eai-cli alias eai --help failed"
  exit 1
fi
if ! "$ALIAS_EAI" update --check --no-project-refresh >/dev/null 2>&1; then
  echo "✗ packed eai-cli alias eai update --check failed"
  exit 1
fi
echo "  ✓ packed eai-cli alias installs the eai command"

if [[ "${EAI_RELEASE_FULL_E2E_SMOKE:-0}" == "1" ]]; then
  section "Running live full e2e smoke against dedicated test tenant"
  node scripts/eai-full-e2e-smoke.cjs --live --cli "$PACKED_EAI" --write-doc
  echo "  ✓ live full e2e smoke passed"
else
  section "Skipping live full e2e smoke"
  echo "  → Set EAI_RELEASE_FULL_E2E_SMOKE=1 with a dedicated test profile/user to run it."
fi

section "Validating static registry metadata"
node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const packument = JSON.parse(fs.readFileSync(path.join(root, 'docs-site/static/registry/@enterpriseai/cli'), 'utf-8'));
const version = pkg.version;
const tarballPath = path.join(root, `docs-site/static/registry/-/@enterpriseai/cli-${version}.tgz`);
const encodedPackumentPath = path.join(root, 'docs-site/static/registry/@enterpriseai%2fcli');

if (packument.name !== '@enterpriseai/cli') {
  throw new Error(`unexpected package name in packument: ${packument.name}`);
}
if (packument['dist-tags']?.latest !== version) {
  throw new Error(`packument latest (${packument['dist-tags']?.latest ?? 'missing'}) does not match package.json (${version})`);
}
if (!packument.versions?.[version]) {
  throw new Error(`packument is missing version entry for ${version}`);
}
if (!fs.existsSync(tarballPath)) {
  throw new Error(`registry tarball missing: ${tarballPath}`);
}
if (!fs.existsSync(encodedPackumentPath)) {
  throw new Error(`encoded canonical packument missing: ${encodedPackumentPath}`);
}
EOF
echo "  ✓ packument latest matches package.json"
echo "  ✓ versioned tarballs exist"

section "Verifying release metadata"
node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

if (!readme.includes('npm config set @enterpriseai:registry https://eai-support.github.io/eai/registry/ --location=user')) {
  throw new Error('README install instructions are missing the static registry fallback command');
}

if (!readme.includes('npm install -g eai-cli')) {
  throw new Error('README install instructions are missing the recommended eai-cli install command');
}

if (!readme.includes('npm install -g @enterpriseai/cli')) {
  throw new Error('README install instructions are missing the canonical package install command');
}

if (!readme.includes('npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/')) {
  throw new Error('README install instructions are missing the static registry fallback install command');
}

if (!pkg.files?.includes('resources')) {
  throw new Error('package.json files list must include bundled resources');
}

const llmsIndex = fs.readFileSync(path.join(root, 'docs-site/static/llms.txt'), 'utf-8');
const llmsFull = fs.readFileSync(path.join(root, 'docs-site/static/llms-full.txt'), 'utf-8');
const cliHelp = fs.readFileSync(path.join(root, 'docs-site/static/cli-help.txt'), 'utf-8');
const currentVersion = pkg.version;

if (!llmsIndex.includes(currentVersion)) {
  throw new Error('llms.txt is missing the current package version');
}
if (!llmsIndex.includes('npm config set @enterpriseai:registry https://eai-support.github.io/eai/registry/ --location=user')) {
  throw new Error('llms.txt is missing the static registry fallback command');
}
if (!llmsIndex.includes('npm install -g eai-cli')) {
  throw new Error('llms.txt is missing the recommended eai-cli install command');
}
if (!llmsIndex.includes('npm install -g @enterpriseai/cli')) {
  throw new Error('llms.txt is missing the canonical package install command');
}
if (!llmsIndex.includes('npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/')) {
  throw new Error('llms.txt is missing the static registry fallback install command');
}
if (!llmsIndex.includes('Error Guidance')) {
  throw new Error('llms.txt is missing the error guidance documentation link');
}
if (!llmsIndex.includes('eai agent guide --format json')) {
  throw new Error('llms.txt is missing the AI agent guide command');
}
if (!llmsFull.includes(currentVersion)) {
  throw new Error('llms-full.txt is missing the current package version');
}
if (!llmsFull.includes('eai agent guide --help')) {
  throw new Error('llms-full.txt is missing the agent guide help snapshot');
}
if (!llmsFull.includes('eai gofer refresh --help')) {
  throw new Error('llms-full.txt is missing current Gofer help output');
}
if (!llmsFull.includes('eai template check --help')) {
  throw new Error('llms-full.txt is missing the template check help snapshot');
}
if (!cliHelp.includes('eai gofer refresh --help')) {
  throw new Error('cli-help.txt is missing the Gofer refresh help snapshot');
}
if (!cliHelp.includes('eai template check --help')) {
  throw new Error('cli-help.txt is missing the template check help snapshot');
}
if (!cliHelp.includes('eai agent guide --help')) {
  throw new Error('cli-help.txt is missing the agent guide help snapshot');
}
const guidance = JSON.parse(fs.readFileSync(path.join(root, 'docs-site/static/error-guidance.json'), 'utf-8'));
if (!guidance.entries?.some((entry) => entry.reasonCode === 'tenant_authorization_incomplete')) {
  throw new Error('error-guidance.json is missing tenant authorization guidance');
}
const aliasPkg = JSON.parse(fs.readFileSync(path.join(root, '.release/eai-cli-package/package.json'), 'utf-8'));
if (aliasPkg.name !== 'eai-cli') {
  throw new Error('alias package name must be eai-cli');
}
if (aliasPkg.version !== currentVersion) {
  throw new Error(`alias package version ${aliasPkg.version} does not match ${currentVersion}`);
}
if (aliasPkg.bin?.eai !== 'dist/index.js') {
  throw new Error('alias package must expose the eai binary');
}
if (aliasPkg.publishConfig?.registry !== 'https://registry.npmjs.org/') {
  throw new Error('alias package must publish to npmjs');
}
EOF
echo "  ✓ README, package metadata, alias package, and release docs align with the npmjs release flow"

echo ""
echo "✓ Release preflight passed"
