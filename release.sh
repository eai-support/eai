#!/usr/bin/env bash
set -euo pipefail

# ── EAI CLI Release Script ──
# Usage: ./release.sh <patch|minor|major> "Release message"

BUMP="${1:-}"
MESSAGE="${2:-}"

if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]] || [[ -z "$MESSAGE" ]]; then
  echo "Usage: ./release.sh <patch|minor|major> \"Release message\""
  echo ""
  echo "  patch  0.1.0 → 0.1.1  (bug fixes)"
  echo "  minor  0.1.0 → 0.2.0  (new features)"
  echo "  major  0.1.0 → 1.0.0  (breaking changes)"
  echo ""
  echo "Examples:"
  echo "  ./release.sh patch \"Fix auth token refresh bug\""
  echo "  ./release.sh minor \"Add bulk resource import command\""
  echo "  ./release.sh major \"New config format, breaking changes to types CLI\""
  exit 1
fi

# ── Preflight ──
echo "══════════════════════════════════════════"
echo "  EAI CLI Release — $BUMP"
echo "  $MESSAGE"
echo "══════════════════════════════════════════"
echo ""

# Must be on main
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "✗ Must be on main branch (currently on $BRANCH)"
  exit 1
fi

# Working tree must be clean
if [[ -n $(git status --porcelain) ]]; then
  echo "✗ Working tree is dirty — commit or stash changes first"
  exit 1
fi

# Pull latest
echo "▸ Pulling latest from origin..."
git pull --rebase origin main

# ── Node version check ──
echo "▸ Checking Node.js version..."
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VERSION < 20 )); then
  echo "✗ Node.js >= 20 required (found $(node -v))"
  exit 1
fi
echo "  ✓ Node $(node -v)"

# ── Install dependencies ──
echo "▸ Installing dependencies..."
npm ci --silent
echo "  ✓ Dependencies installed"

# ── Typecheck ──
echo "▸ Running typecheck..."
npm run typecheck
echo "  ✓ Typecheck passed"

# ── Lint ──
echo "▸ Running linter..."
npm run lint
echo "  ✓ Lint passed"

# ── Build ──
echo "▸ Building..."
npm run build
echo "  ✓ Build succeeded"

# ── Smoke test: CLI runs ──
echo "▸ Smoke testing CLI..."
CLI_VERSION=$(node dist/index.js --version 2>&1)
echo "  ✓ eai --version → $CLI_VERSION"

CLI_HELP=$(node dist/index.js --help 2>&1)
if ! echo "$CLI_HELP" | grep -q "Enterprise AI Platform CLI"; then
  echo "✗ --help output missing expected text"
  exit 1
fi
echo "  ✓ eai --help looks good"

# Verify key commands are registered
for CMD in init login dev types resources deploy env verify chat docs whoami doctor; do
  if ! echo "$CLI_HELP" | grep -q "$CMD"; then
    echo "✗ Missing command: $CMD"
    exit 1
  fi
done
echo "  ✓ All 12 command groups registered"

# ── Docs build ──
echo "▸ Building docs site..."
(cd docs && npm ci --silent && npm run build 2>&1 | tail -1)
echo "  ✓ Docs build succeeded"

# ── Generate registry ──
echo "▸ Generating registry..."
npm pack --silent
node scripts/generate-registry.cjs
echo "  ✓ Registry generated"

# ── IP scan ──
echo "▸ Scanning for IP leaks..."
IP_TERMS="Configurator|ResourceAPI|AICore|PayloadCMS|OPA|Rego|HyPE|OBO"
LEAKS=$(grep -rn --include='*.ts' --include='*.mdx' --include='*.md' \
  -E "$IP_TERMS" src/ docs/src/ 2>/dev/null \
  | grep -v node_modules || true)
if [[ -n "$LEAKS" ]]; then
  echo "✗ IP terms found in source:"
  echo "$LEAKS"
  exit 1
fi
echo "  ✓ No IP leaks"

# ── All checks passed ──
echo ""
echo "══════════════════════════════════════════"
echo "  All checks passed ✓"
echo "══════════════════════════════════════════"
echo ""

# ── Version bump ──
OLD_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_VERSION#v}"
echo "▸ Version: $OLD_VERSION → $NEW_VERSION"

# ── Commit, tag, push ──
git add package.json package-lock.json docs/public/registry/
git commit -m "chore: release v$NEW_VERSION — $MESSAGE"
git tag -a "v$NEW_VERSION" -m "$MESSAGE"
git push origin main --tags

echo "  ✓ Pushed v$NEW_VERSION"

# ── GitHub Release ──
echo "▸ Creating GitHub release..."
gh release create "v$NEW_VERSION" \
  --title "v$NEW_VERSION — $MESSAGE" \
  --notes "$(cat <<EOF
## $MESSAGE

**Install:**

Configure \`.npmrc\`:
\`\`\`
@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry
\`\`\`

Then:
\`\`\`bash
npm install -g @eai-tools/cli
\`\`\`

**Full changelog:** https://github.com/eai-tools/eai-cli/compare/v$OLD_VERSION...v$NEW_VERSION
EOF
)"

RELEASE_URL="https://github.com/eai-tools/eai-cli/releases/tag/v$NEW_VERSION"
echo "  ✓ Release created: $RELEASE_URL"

echo ""
echo "══════════════════════════════════════════"
echo "  Released v$NEW_VERSION — $MESSAGE"
echo "══════════════════════════════════════════"
echo ""
echo "Install:"
echo "  echo '@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry' >> ~/.npmrc"
echo "  npm install -g @eai-tools/cli"
echo ""
