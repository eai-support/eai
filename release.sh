#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="eai-support/eai"
NPM_PACKAGE="@enterpriseai/cli"
NPM_ALIAS_PACKAGE="eai-cli"
NPM_REGISTRY_URL="https://registry.npmjs.org/"
STATIC_REGISTRY_URL="https://eai-support.github.io/eai/registry/"
STATIC_PACKUMENT_URL="https://eai-support.github.io/eai/registry/@enterpriseai/cli"

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

latest_release_tag() {
  git ls-remote --tags --refs origin 'v*' \
    | awk '{print $2}' \
    | sed 's#refs/tags/##' \
    | sort -V \
    | tail -n 1
}

version_gt() {
  local left="${1:-0.0.0}"
  local right="${2:-0.0.0}"

  LEFT="$left" RIGHT="$right" node <<'EOF'
const left = (process.env.LEFT || '0.0.0').replace(/^v/, '');
const right = (process.env.RIGHT || '0.0.0').replace(/^v/, '');
const parse = (value) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
const [la, lb, lc] = parse(left);
const [ra, rb, rc] = parse(right);
if (la !== ra) process.exit(la > ra ? 0 : 1);
if (lb !== rb) process.exit(lb > rb ? 0 : 1);
if (lc !== rc) process.exit(lc > rc ? 0 : 1);
process.exit(1);
EOF
}

remote_tag_exists() {
  local tag_name="$1"
  git ls-remote --tags origin "refs/tags/${tag_name}" | grep -q .
}

local_tag_exists() {
  local tag_name="$1"
  git rev-parse "$tag_name" >/dev/null 2>&1
}

ensure_no_stale_local_tag() {
  local tag_name="$1"
  if local_tag_exists "$tag_name" && ! remote_tag_exists "$tag_name"; then
    echo "✗ Local tag $tag_name exists but has not been pushed"
    echo "  Delete or move the stale local tag before publishing this release."
    exit 1
  fi
}

ensure_no_existing_release_pr() {
  local branch_name="$1"
  local existing_pr
  existing_pr="$(gh pr list --repo "$REPO" --head "$branch_name" --state all --json url --jq '.[0].url // ""')"
  if [[ -n "$existing_pr" ]]; then
    echo "✗ Release branch $branch_name already has a PR: $existing_pr"
    exit 1
  fi
}

wait_for_main_docs_run() {
  local commit_sha="$1"
  wait_for_docs_run "$commit_sha"
}

create_release_pr() {
  local branch_name="$1"
  local version="$2"
  local notes="$3"

  local body
  body=$(cat <<EOF
## Release Prep

- bumps CLI version to \`$version\`
- refreshes static registry and release-facing docs
- prepares the repo so a follow-up \`./release.sh\` on merged \`main\` can publish tag \`v$version\`

## Release Notes

$notes
EOF
)

  gh pr create \
    --repo "$REPO" \
    --base main \
    --head "$branch_name" \
    --title "chore: release v$version — $notes" \
    --body "$body"
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
LATEST_TAG="$(latest_release_tag)"
LATEST_TAG_VERSION="${LATEST_TAG#v}"

if version_gt "$OLD_VERSION" "${LATEST_TAG_VERSION:-0.0.0}"; then
  RELEASE_PHASE="publish"
else
  RELEASE_PHASE="prepare"
fi

section "Release mode"
if [[ "$RELEASE_PHASE" == "publish" ]]; then
  echo "  Mode: publish merged main"
  echo "  package.json version: $OLD_VERSION"
  echo "  latest tag: ${LATEST_TAG:-none}"
else
  echo "  Mode: prepare release PR"
  echo "  package.json version: $OLD_VERSION"
  echo "  latest tag: ${LATEST_TAG:-none}"
fi

if [[ "$RELEASE_PHASE" == "publish" ]]; then
  TAG_NAME="v$OLD_VERSION"

  section "Waiting for docs/static-registry deployment from main"
  wait_for_main_docs_run "$(git rev-parse HEAD)"
  echo "  ✓ Deploy Docs workflow completed"

  section "Creating and pushing release tag"
  if remote_tag_exists "$TAG_NAME"; then
    echo "✗ Remote tag $TAG_NAME already exists"
    exit 1
  fi
  ensure_no_stale_local_tag "$TAG_NAME"
  git tag -a "$TAG_NAME" -m "$MESSAGE"
  git push origin "$TAG_NAME"
  echo "  ✓ pushed $TAG_NAME"

  section "Waiting for GitHub release workflow"
  wait_for_release_run "$TAG_NAME"
  echo "  ✓ Release workflow completed"

  section "Verifying public release channels"
  verify_npmjs_latest "$NPM_PACKAGE" "$OLD_VERSION"
  verify_npmjs_latest "$NPM_ALIAS_PACKAGE" "$OLD_VERSION"
  verify_static_registry_latest "$OLD_VERSION" "$STATIC_PACKUMENT_URL" "canonical static registry"

  echo ""
  echo "══════════════════════════════════════════"
  echo "  Released $TAG_NAME — $MESSAGE"
  echo "══════════════════════════════════════════"
  echo ""
  exit 0
fi

section "Bumping version"
NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
NEW_VERSION="${NEW_VERSION#v}"
echo "  ✓ version: $OLD_VERSION -> $NEW_VERSION"

RELEASE_BRANCH="release/v$NEW_VERSION"
if git show-ref --verify --quiet "refs/heads/$RELEASE_BRANCH"; then
  echo "✗ Local branch $RELEASE_BRANCH already exists"
  exit 1
fi
if git ls-remote --heads origin "$RELEASE_BRANCH" | grep -q .; then
  echo "✗ Remote branch $RELEASE_BRANCH already exists"
  exit 1
fi
ensure_no_existing_release_pr "$RELEASE_BRANCH"

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

section "Creating release branch"
git checkout -b "$RELEASE_BRANCH"
echo "  ✓ branch created: $RELEASE_BRANCH"

section "Committing release prep"
git add package.json package-lock.json .tech-docs/ docs-site/static/registry/ docs-site/static/llms.txt docs-site/static/llms-full.txt docs-site/static/cli-help.txt docs-site/static/error-guidance.json
git commit -m "chore: release v$NEW_VERSION — $MESSAGE"
git push -u origin "$RELEASE_BRANCH"
PR_URL="$(create_release_pr "$RELEASE_BRANCH" "$NEW_VERSION" "$MESSAGE")"
echo "  ✓ release prep PR: $PR_URL"

echo ""
echo "══════════════════════════════════════════"
echo "  Prepared release PR for v$NEW_VERSION — $MESSAGE"
echo "══════════════════════════════════════════"
echo ""
echo "Next step:"
echo "  1. Merge $PR_URL"
echo "  2. Switch back to main and fast-forward"
echo "  3. Run ./release.sh $BUMP \"$MESSAGE\" again to publish tag v$NEW_VERSION from merged main"
