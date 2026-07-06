#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="eai-tools/eai"
NPM_PACKAGE="@enterpriseai/cli"
NPM_ALIAS_PACKAGE="eai-cli"
NPM_REGISTRY_URL="https://registry.npmjs.org/"
STATIC_REGISTRY_URL="https://eai-tools.github.io/eai/registry/"
STATIC_PACKUMENT_URL="https://eai-tools.github.io/eai/registry/@enterpriseai/cli"

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

verify_static_registry_latest() {
  local expected_version="$1"
  local packument_url="$2"
  local label="$3"
  local actual_version=""

  for _attempt in $(seq 1 24); do
    actual_version="$(
      curl -fsSL "$packument_url" \
        | node -e 'let raw="";process.stdin.on("data",(chunk)=>raw+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(raw);process.stdout.write(parsed["dist-tags"]?.latest ?? "");});' \
        2>/dev/null || true
    )"
    if [[ "$actual_version" == "$expected_version" ]]; then
      echo "  ✓ $label latest is $actual_version"
      return 0
    fi
    sleep 5
  done

  echo "✗ $label latest did not converge to $expected_version (saw: ${actual_version:-unavailable})"
  return 1
}

verify_npmjs_latest() {
  local package_name="$1"
  local expected_version="$2"
  local actual_version=""
  local package_label="$package_name"

  for _attempt in $(seq 1 36); do
    if [[ "$package_name" == @enterpriseai/* ]]; then
      actual_version="$(npm view "$package_name" version --registry="$NPM_REGISTRY_URL" --@enterpriseai:registry="$NPM_REGISTRY_URL" 2>/dev/null || true)"
    else
      actual_version="$(npm view "$package_name" version --registry="$NPM_REGISTRY_URL" 2>/dev/null || true)"
    fi

    if [[ "$actual_version" == "$expected_version" ]]; then
      echo "  ✓ npmjs $package_label latest is $actual_version"
      return 0
    fi
    sleep 5
  done

  echo "✗ npmjs $package_label latest did not converge to $expected_version (saw: ${actual_version:-unavailable})"
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
rm -f "enterpriseai-cli-${OLD_VERSION}.tgz" "enterpriseai-cli-${NEW_VERSION}.tgz"
rm -f "eai-cli-${OLD_VERSION}.tgz" "eai-cli-${NEW_VERSION}.tgz"
node scripts/update-release-doc-metadata.cjs "$NEW_VERSION" "$MESSAGE" >/dev/null
TARBALL="$(npm pack --silent)"
node scripts/build-npm-alias-package.cjs >/dev/null
ALIAS_TARBALL="$(npm pack --silent .release/eai-cli-package)"
node scripts/generate-registry.cjs >/dev/null
node scripts/generate-error-guidance-docs.cjs >/dev/null
node scripts/generate-release-docs.cjs >/dev/null
echo "  ✓ npm pack -> $TARBALL"
echo "  ✓ eai-cli alias pack -> $ALIAS_TARBALL"
echo "  ✓ static registry metadata refreshed"
echo "  ✓ release-facing docs refreshed"

section "Committing release"
git add package.json package-lock.json .tech-docs/ docs-site/static/registry/ docs-site/static/llms.txt docs-site/static/llms-full.txt docs-site/static/cli-help.txt docs-site/static/error-guidance.json
git commit -m "chore: release v$NEW_VERSION — $MESSAGE"
git tag -a "v$NEW_VERSION" -m "$MESSAGE"
RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
echo "  ✓ commit created at $RELEASE_COMMIT_SHA"
echo "  ✓ tag created: v$NEW_VERSION"

section "Pushing main and tag"
git push origin main
git push origin "v$NEW_VERSION"
echo "  ✓ pushed main"
echo "  ✓ pushed v$NEW_VERSION"

section "Waiting for GitHub release workflow"
wait_for_release_run "v$NEW_VERSION"
echo "  ✓ Release workflow completed"

section "Waiting for docs/static-registry deployment"
wait_for_docs_run "$RELEASE_COMMIT_SHA"
echo "  ✓ Deploy Docs workflow completed"

section "Verifying public release channels"
verify_npmjs_latest "$NPM_PACKAGE" "$NEW_VERSION"
verify_npmjs_latest "$NPM_ALIAS_PACKAGE" "$NEW_VERSION"
verify_static_registry_latest "$NEW_VERSION" "$STATIC_PACKUMENT_URL" "canonical static registry"

echo ""
echo "══════════════════════════════════════════"
echo "  Released v$NEW_VERSION — $MESSAGE"
echo "══════════════════════════════════════════"
echo ""
echo "Recommended install or update:"
echo "  npm install -g eai-cli"
echo ""
echo "Canonical package install:"
echo "  npm install -g @enterpriseai/cli"
echo ""
echo "Static fallback if npmjs is unavailable:"
echo "  npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-tools.github.io/eai/registry/"
