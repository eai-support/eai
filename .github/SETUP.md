# Repository Setup

This document covers the one-time configuration steps required for CI/CD workflows.

## GitHub Pages

To enable documentation deployment:

1. Go to **Settings > Pages** in the repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. The docs workflow will automatically deploy when files in `docs/` change on `main`, or when triggered manually via **Actions > Deploy Docs > Run workflow**.

## Package Registry

This project publishes the CLI through npmjs first, with the GitHub Pages static
registry kept as a fallback.

Release channel responsibilities:

- **npmjs primary package**: `eai-cli`
- **npmjs canonical package**: `@enterpriseai/cli`
- **GitHub Pages static registry fallback**: `https://eai-tools.github.io/eai/registry/`
- Recommended install: `npm install -g eai-cli`
- Canonical install: `npm install -g @enterpriseai/cli`
- Static fallback install: `npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-tools.github.io/eai/registry/`
- Persistent static fallback setup: `npm config set @enterpriseai:registry https://eai-tools.github.io/eai/registry/ --location=user`
- The release workflow publishes both npmjs packages using trusted publishing,
  then creates the GitHub release from the pushed release tag.
- The docs workflow deploys the matching static registry fallback metadata from `main`.

Configure npm Trusted Publishing for both `@enterpriseai/cli` and `eai-cli`:

1. Go to each package on npmjs.com.
2. Add a trusted publisher for GitHub Actions.
3. Use owner `eai-tools`, repository `eai`, workflow filename `release.yml`.
4. Allow `npm publish`.

Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` for normal releases. Trusted
publishing uses GitHub OIDC through the `id-token: write` workflow permission.
If either npmjs package has never existed before and npm does not expose package
settings yet, create it with a one-off owner-controlled public publish, then
enable trusted publishing before returning to the normal `release.sh` flow.
Do not configure or publish `@eai-tools/cli` on npmjs; that name is kept only as
a GitHub Pages static-registry compatibility bridge for older installed CLIs.

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
4. Wait for the GitHub `Release` workflow to publish both npmjs packages and create the GitHub release.
5. Wait for `Deploy Docs` to push the matching static registry fallback update to GitHub Pages.
6. Verify npmjs and the public static registry fallback report the new version.

The release path also verifies that the committed AI-facing docs and CLI help snapshots are current before the GitHub release is created.

### Version Conventions

- Follow [Semantic Versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`
- Let `release.sh` manage the version bump and tag creation.

## Public Repository Safety

Before switching repository visibility to public, verify:

1. `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`,
   `LICENSE`, and issue/PR templates are present.
2. Secret scanning and push protection are enabled in **Settings > Code security
   and analysis**.
3. Private vulnerability reporting is enabled.
4. Generated `.specify/specs/`, `.specify/memory/`, logs, checkpoints, local
   `.env` files, and customer/tenant data are not tracked.
5. Rewritten history has been checked for personal paths, obvious token shapes,
   private keys, and cloud account-key literals.
6. npmjs and the static registry fallback still report the latest version:

```bash
npm view eai-cli version --registry=https://registry.npmjs.org/
npm view @enterpriseai/cli version --registry=https://registry.npmjs.org/ --@enterpriseai:registry=https://registry.npmjs.org/
curl https://eai-tools.github.io/eai/registry/@enterpriseai/cli
```
