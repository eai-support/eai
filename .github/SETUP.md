# Repository Setup

This document covers the one-time configuration steps required for CI/CD workflows.

## GitHub Pages

To enable documentation deployment:

1. Go to **Settings > Pages** in the repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. The docs workflow will automatically deploy when files in `docs/` change on `main`, or when triggered manually via **Actions > Deploy Docs > Run workflow**.

## NPM Publish Token

To enable automated npm publishing on release:

1. Generate an npm access token at [npmjs.com](https://www.npmjs.com/) under **Access Tokens**.
   - Use a **Granular Access Token** with read/write permissions for the package.
2. Go to **Settings > Secrets and variables > Actions** in the repository.
3. Click **New repository secret**.
4. Set the name to `NPM_TOKEN` and paste the token value.

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

Releases are triggered by pushing a version tag:

```bash
# Tag the release
git tag -a v0.1.0 -m "Release v0.1.0"

# Push the tag to trigger the release workflow
git push --tags
```

This will:

1. Run the full build and lint pipeline.
2. Publish the package to npm with provenance.
3. Create a GitHub Release with auto-generated release notes.

### Version Conventions

- Follow [Semantic Versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`
- Update the version in `package.json` before tagging:
  ```bash
  npm version 0.1.0 --no-git-tag-version
  ```
- Commit the version bump, then create and push the tag.
