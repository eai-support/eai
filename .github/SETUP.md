# Repository Setup

This document covers the one-time configuration steps required for CI/CD workflows.

## GitHub Pages

To enable documentation deployment:

1. Go to **Settings > Pages** in the repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. The docs workflow will automatically deploy when files in `docs/` change on `main`, or when triggered manually via **Actions > Deploy Docs > Run workflow**.

## Package Registry

This project publishes the CLI through the **static scoped registry** on GitHub Pages.

Release channel responsibilities:

- **GitHub Pages static registry** is available at `https://eai-tools.github.io/eai-cli/registry/`
- Users should configure it once with `npm config set @eai-tools:registry https://eai-tools.github.io/eai-cli/registry/ --location=user`
- Install or update with `npm install -g @eai-tools/cli`
- The release workflow creates the GitHub release from the pushed release tag
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
2. Bump the version, refresh `.tech-docs/` release metadata plus `docs-site/static/registry/`, `docs-site/static/llms.txt`, `docs-site/static/llms-full.txt`, and `docs-site/static/cli-help.txt`, then commit and tag.
3. Push `main` and the annotated `vX.Y.Z` tag.
4. Wait for the GitHub `Release` workflow to create the GitHub release.
5. Wait for `Deploy Docs` to push the matching static registry update to GitHub Pages.
6. Verify the public static registry reports the new version.

The release path also verifies that the committed AI-facing docs and CLI help snapshots are current before the GitHub release is created.

### Version Conventions

- Follow [Semantic Versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`
- Let `release.sh` manage the version bump and tag creation.
