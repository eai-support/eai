#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$ROOT/docs-site"
PACKUMENT="$ROOT/docs-site/static/registry/@eai-tools/cli"
GENERATED_TARBALL=""
BACKUP_DIR=""

section() {
  echo ""
  echo "▸ $1"
}

cleanup() {
  if [[ -n "$GENERATED_TARBALL" ]]; then
    rm -f "$ROOT/$GENERATED_TARBALL" 2>/dev/null || true
  fi
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -rf "$ROOT/docs-site/static/registry"
    if [[ -d "$BACKUP_DIR/registry" ]]; then
      cp -R "$BACKUP_DIR/registry" "$ROOT/docs-site/static/registry"
    fi

    for file in llms.txt llms-full.txt cli-help.txt; do
      rm -f "$ROOT/docs-site/static/$file"
      if [[ -f "$BACKUP_DIR/$file" ]]; then
        cp "$BACKUP_DIR/$file" "$ROOT/docs-site/static/$file"
      fi
    done

    rm -rf "$BACKUP_DIR"
  fi
}

trap cleanup EXIT

cd "$ROOT"

BACKUP_DIR="$(mktemp -d)"
if [[ -d "$ROOT/docs-site/static/registry" ]]; then
  cp -R "$ROOT/docs-site/static/registry" "$BACKUP_DIR/registry"
fi
for file in llms.txt llms-full.txt cli-help.txt; do
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

section "Scanning for internal platform terminology leaks"
IP_TERMS="Configurator|ResourceAPI|AICore|PayloadCMS|OPA|Rego|HyPE|OBO"
LEAKS="$(
  grep -rn \
    --include='*.ts' \
    --include='*.md' \
    -E "$IP_TERMS" \
    src/ README.md AGENTS.md CLAUDE.md 2>/dev/null \
    | grep -v node_modules || true
)"
if [[ -n "$LEAKS" ]]; then
  echo "✗ Internal platform terms found in release surface:"
  echo "$LEAKS"
  exit 1
fi
echo "  ✓ no internal terminology leaks"

section "Building docs site"
(cd "$DOCS_DIR" && npm ci --silent && npm run build >/dev/null)
echo "  ✓ docs-site build"

section "Generating release artifacts"
GENERATED_TARBALL="$(npm pack --silent)"
node scripts/generate-registry.cjs >/dev/null
node scripts/generate-release-docs.cjs >/dev/null
echo "  ✓ npm pack -> $GENERATED_TARBALL"
echo "  ✓ static registry metadata regenerated"
echo "  ✓ release-facing docs regenerated"

section "Validating static registry metadata"
node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const packument = JSON.parse(fs.readFileSync(path.join(root, 'docs-site/static/registry/@eai-tools/cli'), 'utf-8'));
const version = pkg.version;
const tarballPath = path.join(root, `docs-site/static/registry/-/@eai-tools/cli-${version}.tgz`);

if (packument.name !== '@eai-tools/cli') {
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
EOF
echo "  ✓ packument latest matches package.json"
echo "  ✓ versioned tarball exists"

section "Verifying release metadata"
node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

if (!readme.includes('npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user')) {
  throw new Error('README install instructions are missing the scoped registry setup command');
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
if (!llmsIndex.includes('npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user')) {
  throw new Error('llms.txt is missing the scoped registry setup command');
}
if (!llmsFull.includes(currentVersion)) {
  throw new Error('llms-full.txt is missing the current package version');
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
EOF
echo "  ✓ README, package metadata, and release docs align with the static-registry release flow"

echo ""
echo "✓ Release preflight passed"
