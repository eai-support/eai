# Repository Setup

This document covers the one-time configuration steps required for CI/CD workflows.

## GitHub Pages

To enable documentation deployment:

1. Go to **Settings > Pages** in the repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. The docs workflow will automatically deploy when files in `docs/` change on `main`, or when triggered manually via **Actions > Deploy Docs > Run workflow**.

## Package Registry

This project publishes the CLI to **npm** and also maintains a **static fallback registry** on GitHub Pages.

Required one-time secret:

1. Go to **Settings > Secrets and variables > Actions**.
2. Add a repository secret named `NPM_TOKEN`.
3. Use an npm access token that has publish rights for `@eai-tools/cli`.

Release channel responsibilities:

- **npm** is the primary install/update target after the release workflow succeeds: `npm install -g @eai-tools/cli`
- **GitHub Pages static registry** remains available at `https://eai-tools.github.io/eai-cli/registry`
- The release workflow publishes to npm from the pushed release tag
- The docs workflow deploys the matching static registry metadata from `main`

## Branch Protection Rules

Recommended branch protection for `main`:

1. Go to **Settings > Branches > Add branch protection rule**.
2. Set **Branch name pattern** to `main`.
3. Enable:
   - **Require a pull request before merging**
   - **Require status checks to pass before merging** — add the `Build, Lint & Typecheck` check.
   - **Require branches to be up to date before merging**
   - **Do not allow bypassing the above settings** (optional, for stricter enforcement).

## Creating a Release

Use the repo root release script from a clean `main` checkout:

```bash
./release.sh patch "Release message"
```

This will:

1. Run the local release preflight (`npm run release:check`).
2. Bump the version, regenerate `docs-site/static/registry/`, commit, and tag.
3. Push `main` and the annotated `vX.Y.Z` tag.
4. Wait for the GitHub `Release` workflow to publish to npm and create the GitHub release.
5. Wait for `Deploy Docs` to push the matching static registry update to GitHub Pages.
6. Verify both public channels report the new version.
7. If npm still returns `404`, treat the release as incomplete and keep using the static registry until the publish issue is fixed.

### Version Conventions

- Follow [Semantic Versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`
- Let `release.sh` manage the version bump and tag creation.
