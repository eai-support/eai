---
id: static-npm-registry
title: Static npm Registry on GitHub Pages
status: draft
created: 2026-03-09
updated: 2026-03-09
author: Claude
---

# Static npm Registry on GitHub Pages

## Overview

Distribute `@eai-tools/cli` through a static npm registry hosted on the
existing GitHub Pages documentation site at
`https://eai-tools.github.io/eai/registry`. This enables consumers to
install the CLI using standard `npm install @eai-tools/cli` with full semver
range support, without publishing to npmjs.com or any public registry.

The GitHub repository is private. The GitHub Pages site is public. Consumers
configure a single `.npmrc` line pointing to the Pages-hosted registry and
thereafter interact with the CLI package exactly as they would with any npm
registry package.

Homebrew distribution is being removed entirely — it will not be a supported
installation method.

**Research Reference**: See `research.md` for codebase analysis and integration
points.

## User Scenarios & Testing

### US1: Install CLI via npm Registry (P1)

A new team member wants to install the EAI CLI on their machine. They follow the
installation guide, configure their `.npmrc`, and run `npm install`.

**Why this priority**: This is the core value — standard npm install experience
for a privately-hosted package.

**Independent Test**: Can be fully tested by configuring `.npmrc` and running
`npm install -g @eai-tools/cli` against the Pages-hosted registry, then
verifying `eai --version` outputs the expected version.

**Acceptance Scenarios**:

1. **Given** a consumer has added
   `@eai-tools:registry=https://eai-tools.github.io/eai/registry` to their
   `.npmrc`, **When** they run `npm install -g @eai-tools/cli`, **Then** the CLI
   is installed and `eai --version` outputs the current version.

2. **Given** a consumer has the registry configured, **When** they run
   `npm install -g @eai-tools/cli@0.1.0`, **Then** that specific version is
   installed.

3. **Given** a consumer has `"@eai-tools/cli": "^0.1.0"` in their
   `package.json`, **When** they run `npm install`, **Then** the latest matching
   version is resolved and installed.

---

### US2: Release Publishes to Static Registry (P1)

A maintainer releases a new version of the CLI. The release process
automatically builds the tarball, generates registry metadata, and deploys to
GitHub Pages.

**Why this priority**: Without automated publishing, the registry has no content.
This is co-equal with US1.

**Independent Test**: Can be tested by running the release script, then
verifying the registry metadata file and tarball are accessible at the expected
URLs on GitHub Pages.

**Acceptance Scenarios**:

1. **Given** a maintainer runs `./release.sh patch "Fix auth bug"`, **When** the
   release workflow completes, **Then** the new version's tarball and updated
   registry metadata are deployed to GitHub Pages.

2. **Given** version 0.1.0 already exists in the registry, **When** version
   0.2.0 is released, **Then** the registry metadata lists both versions and
   `dist-tags.latest` points to 0.2.0.

3. **Given** a release workflow runs, **When** a consumer runs
   `npm view @eai-tools/cli versions --registry=https://eai-tools.github.io/eai/registry`,
   **Then** all released versions are listed.

---

### US3: Installation Documentation Guides Consumers (P2)

A new user visits the documentation site and finds clear instructions for
installing the CLI via the npm registry, including `.npmrc` configuration.

**Why this priority**: Without clear docs, consumers won't know how to configure
their `.npmrc`.

**Independent Test**: Can be tested by visiting the installation page and
following the documented steps to install the CLI.

**Acceptance Scenarios**:

1. **Given** a user visits the installation page, **When** they read the
   recommended install method, **Then** they see instructions for configuring
   `.npmrc` and running `npm install -g @eai-tools/cli`.

2. **Given** a user visits the installation page, **When** they look for
   Homebrew instructions, **Then** Homebrew is not listed as an installation
   method.

3. **Given** a user follows the documented steps, **When** they complete all
   steps, **Then** `eai --version` works.

---

### US4: Semver Resolution and Updates (P2)

A consumer who previously installed the CLI wants to check for updates and
upgrade.

**Why this priority**: Standard npm workflows (update, outdated) are a key
benefit over tarball-based distribution.

**Independent Test**: Can be tested by installing an older version, then running
`npm outdated -g` and `npm update -g @eai-tools/cli`.

**Acceptance Scenarios**:

1. **Given** a consumer has version 0.1.0 installed and 0.2.0 is published,
   **When** they run `npm outdated -g`, **Then** `@eai-tools/cli` shows as
   outdated.

2. **Given** a consumer has an older version installed, **When** they run
   `npm install -g @eai-tools/cli@latest`, **Then** the latest version is
   installed.

---

### Edge Cases

- What happens when the registry metadata file does not exist yet (first-ever
  release)? → The generation script creates it from scratch.
- What happens when a consumer tries to install without `.npmrc` configured?
  → npm falls back to npmjs.com, which will return "not found". The error
  message won't be clear — docs must emphasize `.npmrc` configuration.
- What happens if a release is re-tagged (same version, different content)?
  → The registry metadata and tarball are overwritten. Integrity hashes change.
  Consumers who cached the old version may get checksum errors. This should be
  avoided.
- What happens if GitHub Pages is down? → `npm install` fails. This is
  acceptable for a private distribution channel.
- What happens with `npm audit`? → npm audit runs against the default registry
  (npmjs.com), not the scoped registry. The package won't be found for audit
  purposes. This is acceptable.

## Requirements

### Functional Requirements

- **FR-001**: System MUST generate a valid npm registry packument (metadata
  JSON) containing `name`, `dist-tags`, and `versions` fields for each release.
- **FR-002**: System MUST compute SHA-1 (`shasum`) and SHA-512 (`integrity`)
  hashes for each tarball and include them in the packument's `dist` field.
- **FR-003**: System MUST accumulate versions across releases — each new release
  appends to existing metadata, preserving all prior versions.
- **FR-004**: System MUST store the packument as an extensionless file at
  `docs/public/registry/@eai-tools/cli` so GitHub Pages serves it at the
  correct URL path.
- **FR-005**: System MUST store tarballs at
  `docs/public/registry/-/@eai-tools/cli-{version}.tgz`.
- **FR-006**: System MUST include `dependencies`, `bin`, `engines`, `name`, and
  `version` fields in each version entry of the packument (extracted from
  `package.json`).
- **FR-007**: The release workflow MUST commit generated registry files to the
  `main` branch and push, triggering the existing docs deployment workflow.
- **FR-008**: The installation documentation MUST describe `.npmrc`
  configuration and `npm install` as the primary installation method.
- **FR-009**: The installation documentation MUST NOT include Homebrew as an
  installation method.
- **FR-010**: The release workflow MUST NOT publish to npmjs.com.
- **FR-011**: The release script (`release.sh`) MUST NOT reference Homebrew
  in install instructions.
- **FR-012**: The GitHub Release body MUST NOT reference Homebrew.

### Key Entities

- **Packument**: The npm registry metadata JSON document. Contains all versions,
  dist-tags, and per-version distribution info. One file per package.
- **Tarball**: The `.tgz` file produced by `npm pack`. Contains the built CLI
  (dist/) and package.json.

## Non-Functional Requirements

### Performance

- Registry metadata file size will grow linearly with versions (~200 bytes per
  version). At 100 versions, the file would be ~20KB — negligible.
- Tarballs are ~50KB each. At 100 versions, total storage is ~5MB — well within
  GitHub Pages' 1GB limit.

### Security

- Tarballs include SHA-1 and SHA-512 integrity hashes. npm verifies these after
  download.
- The GitHub Pages site is public — anyone with the URL can download the CLI.
  This is intentional for the distribution model.
- No secrets or credentials are included in tarballs (enforced by existing
  `.npmignore`).

### Compatibility

- Consumers need npm 7+ (supports scoped registries with path prefixes). npm 7
  ships with Node.js 16+; the CLI requires Node.js 20+ so this is already
  satisfied.
- Works with yarn, pnpm, and other package managers that support `.npmrc` scoped
  registry configuration.

### Reliability

- GitHub Pages has 99.9%+ uptime. Acceptable for a private distribution
  channel.
- If Pages is temporarily unavailable, `npm install` fails with a network error.
  Consumers retry later.

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| SC-001: Standard npm install works | `npm install -g @eai-tools/cli` succeeds | Manual test after first release |
| SC-002: Semver resolution works | `npm install @eai-tools/cli@^0.1.0` resolves correctly | Manual test with multiple versions |
| SC-003: Version accumulation | Registry lists all published versions | Check packument after 2+ releases |
| SC-004: Docs accuracy | Installation page instructions lead to successful install | Follow docs on clean machine |
| SC-005: No Homebrew references | Zero Homebrew mentions in docs, workflows, release script | Grep for "brew" in relevant files |
| SC-006: No npmjs.com publish | Release workflow does not call `npm publish` | Review workflow YAML |

## Assumptions

- GitHub Pages will continue to serve extensionless files (as `text/plain`).
  Confirmed: npm does not validate Content-Type headers.
- The `docs/public/` directory is copied verbatim to `docs/dist/` during Astro
  build. Confirmed by Astro's static asset handling.
- The existing docs deployment workflow (`docs.yml`) is triggered by pushes to
  `main` that modify files under `docs/**`. Registry files in
  `docs/public/registry/` match this path filter.
- The `release.yml` workflow has permission to push commits to `main` (or will
  be granted this permission).
- The user's other organization (`enterpriseaigroup`) validates this pattern
  works in production.

## Dependencies

- **Astro static asset pipeline**: Files in `docs/public/` are served at the
  site root (under `base` path). No config changes needed.
- **GitHub Actions `actions/deploy-pages@v4`**: Current docs deployment
  mechanism. No changes needed.
- **Node.js `crypto` module**: Used to compute SHA-1 and SHA-512 hashes. Built
  into Node.js, no new dependencies.
- **`npm pack` command**: Produces tarballs. Already used in `release.yml`.
- **Git push from CI**: Release workflow needs to commit and push registry
  files to `main`. Requires `contents: write` permission (already granted).

## Out of Scope

- Publishing to npmjs.com or any public registry
- Homebrew tap distribution
- Authentication or access control on the registry (Pages is public)
- Multiple packages (only `@eai-tools/cli` for now)
- Automated cleanup of old versions
- CDN or caching layer in front of GitHub Pages
- Windows-specific install instructions (PowerShell `.npmrc` path)
- npm audit integration

## Glossary

| Term | Definition |
|------|------------|
| Packument | npm registry metadata JSON for a package — lists all versions and their download URLs |
| Static registry | An npm-compatible registry served as static files (no server-side logic) |
| Scoped registry | npm feature where a scope (e.g., `@eai-tools`) resolves against a custom registry URL |
| SRI (Subresource Integrity) | Hash format (`sha512-...`) used by npm to verify downloaded tarballs |
| dist-tags | Named references to versions (e.g., `latest` → `0.2.0`) |

## Research Traceability

| Research Finding | Spec Section | Reference |
|-----------------|-------------|-----------|
| npm doesn't validate Content-Type | Assumptions | TD1 in research.md |
| Registry URL: eai-tools.github.io/eai/registry | FR-004, FR-005 | TD2 in research.md |
| Tarballs on Pages (not Releases, repo is private) | FR-005 | TD3 in research.md |
| generate-llms-full.cjs pattern for scripts | Dependencies | Pattern 1 in research.md |
| npm pack in release.yml | Dependencies | Pattern 2 in research.md |
| docs/public → docs/dist pipeline | Assumptions | Pattern 3 in research.md |
| Private repo = no Release download URLs | FR-005, Assumptions | Constraints in research.md |
| Version accumulation needed | FR-003 | TD5 in research.md |
| Remove Homebrew | FR-009, FR-011, FR-012 | TD6 in research.md |
| Tabbed install instructions pattern | FR-008 | Pattern 4 in research.md |
| Base path /eai | FR-004, FR-005 | Constraints in research.md |
| publishConfig removal | FR-010 | research.md recommendations |
