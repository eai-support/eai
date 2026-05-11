#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="eai-tools/eai-cli"
NPM_PACKAGE="@eai-tools/cli"
NPM_PACKUMENT_URL="https://registry.npmjs.org/@eai-tools%2fcli"
NPM_REGISTRY_URL="https://registry.npmjs.org/"
STATIC_PACKUMENT_URL="https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli"

BUMP="${1:-}"
MESSAGE="${2:-}"

usage() {
  cat <<'EOF'
Usage: ./release.sh <patch|minor|major> "Release message"

  patch  2.8.4 -> 2.8.5  (bug fixes)
  minor  2.8.4 -> 2.9.0  (new features)
  major  2.8.4 -> 3.0.0  (breaking changes)

Examples:
  ./release.sh patch "Fix auth token refresh bug"
  ./release.sh minor "Add bulk resource import command"
  ./release.sh major "Replace config schema with v3 format"
EOF
}

section() {
  echo ""
  echo "▸ $1"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "✗ Required command not found: $command_name"
    exit 1
  fi
}

wait_for_release_run() {
  local tag_name="$1"
  local run_id=""

  for _attempt in $(seq 1 30); do
    run_id="$(gh run list \
      --repo "$REPO" \
      --workflow release.yml \
      --limit 20 \
      --json databaseId,headBranch \
      --jq ".[] | select(.headBranch == \"$tag_name\") | .databaseId" \
      | head -n 1)"

    if [[ -n "$run_id" ]]; then
      break
    fi

    sleep 3
  done

  if [[ -z "$run_id" ]]; then
    echo "✗ Could not find the Release workflow run for $tag_name"
    exit 1
  fi

  gh run watch "$run_id" --repo "$REPO" --exit-status
}

wait_for_docs_run() {
  local commit_sha="$1"
  local run_id=""

  for _attempt in $(seq 1 30); do
    run_id="$(gh run list \
      --repo "$REPO" \
      --workflow docs.yml \
      --branch main \
      --limit 30 \
      --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$commit_sha\") | .databaseId" \
      | head -n 1)"

    if [[ -n "$run_id" ]]; then
      break
    fi

    sleep 3
  done

  if [[ -z "$run_id" ]]; then
    echo "✗ Could not find the Deploy Docs workflow run for commit $commit_sha"
    exit 1
  fi

  gh run watch "$run_id" --repo "$REPO" --exit-status
}

verify_npm_latest() {
  local expected_version="$1"
  local actual_version=""

  for _attempt in $(seq 1 24); do
    actual_version="$(
      curl -fsSL "$NPM_PACKUMENT_URL" \
        | node -e 'let raw="";process.stdin.on("data",(chunk)=>raw+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(raw);process.stdout.write(parsed["dist-tags"]?.latest ?? "");});' \
        2>/dev/null || true
    )"
    if [[ "$actual_version" == "$expected_version" ]]; then
      echo "  ✓ npm latest is $actual_version"
      return 0
    fi
    sleep 5
  done

  echo "✗ npm latest did not converge to $expected_version (saw: ${actual_version:-unavailable})"
  return 1
}

verify_static_registry_latest() {
  local expected_version="$1"
  local actual_version=""

  for _attempt in $(seq 1 24); do
    actual_version="$(
      curl -fsSL "$STATIC_PACKUMENT_URL" \
        | node -e 'let raw="";process.stdin.on("data",(chunk)=>raw+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(raw);process.stdout.write(parsed["dist-tags"]?.latest ?? "");});' \
        2>/dev/null || true
    )"
    if [[ "$actual_version" == "$expected_version" ]]; then
      echo "  ✓ static registry latest is $actual_version"
      return 0
    fi
    sleep 5
  done

  echo "✗ static registry latest did not converge to $expected_version (saw: ${actual_version:-unavailable})"
  return 1
}

if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]] || [[ -z "$MESSAGE" ]]; then
  usage
  exit 1
fi

section "Release configuration"
echo "  Package: $NPM_PACKAGE"
echo "  Bump:    $BUMP"
echo "  Message: $MESSAGE"

require_command git
require_command node
require_command npm
require_command gh
require_command curl

cd "$ROOT"

section "Checking git state"
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "✗ Must be on main (currently on $BRANCH)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "✗ Working tree is dirty — commit or stash changes first"
  exit 1
fi

gh auth status >/dev/null
echo "  ✓ git working tree is clean"
echo "  ✓ gh is authenticated"

section "Syncing with origin/main"
git pull --rebase origin main
echo "  ✓ up to date with origin/main"

section "Running release preflight"
npm run release:check
echo "  ✓ release preflight"

OLD_VERSION="$(node -p "require('./package.json').version")"

section "Bumping version"
NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
NEW_VERSION="${NEW_VERSION#v}"
echo "  ✓ version: $OLD_VERSION -> $NEW_VERSION"

section "Regenerating release artifacts"
rm -f "eai-tools-cli-${OLD_VERSION}.tgz" "eai-tools-cli-${NEW_VERSION}.tgz"
TARBALL="$(npm pack --silent)"
node scripts/generate-registry.cjs >/dev/null
npm publish \
  --dry-run \
  --access public \
  "--registry=${NPM_REGISTRY_URL}" \
  "--@eai-tools:registry=${NPM_REGISTRY_URL}" \
  >/dev/null
echo "  ✓ npm pack -> $TARBALL"
echo "  ✓ static registry metadata refreshed"
echo "  ✓ npm publish dry-run for $NEW_VERSION"

section "Committing release"
git add package.json package-lock.json docs-site/static/registry/
git commit -m "chore: release v$NEW_VERSION — $MESSAGE"
git tag -a "v$NEW_VERSION" -m "$MESSAGE"
RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
echo "  ✓ commit created at $RELEASE_COMMIT_SHA"
echo "  ✓ tag created: v$NEW_VERSION"

section "Pushing main and tag"
git push origin main --follow-tags
echo "  ✓ pushed main and v$NEW_VERSION"

section "Waiting for GitHub release workflow"
wait_for_release_run "v$NEW_VERSION"
echo "  ✓ Release workflow completed"

section "Waiting for docs/static-registry deployment"
wait_for_docs_run "$RELEASE_COMMIT_SHA"
echo "  ✓ Deploy Docs workflow completed"

section "Verifying public release channels"
verify_npm_latest "$NEW_VERSION"
verify_static_registry_latest "$NEW_VERSION"

echo ""
echo "══════════════════════════════════════════"
echo "  Released v$NEW_VERSION — $MESSAGE"
echo "══════════════════════════════════════════"
echo ""
echo "Install from npm after the release workflow publishes successfully:"
echo "  npm install -g @eai-tools/cli"
echo ""
echo "Fallback static registry:"
echo "  echo '@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry' >> ~/.npmrc"
echo "  npm install -g @eai-tools/cli"
