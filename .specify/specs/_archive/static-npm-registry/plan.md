---
feature: Static npm Registry on GitHub Pages
spec: spec.md
research: research.md
status: ready
created: 2026-03-09
---

# Implementation Plan: Static npm Registry on GitHub Pages

## Technical Context

### Tech Stack

- **Scripts**: Node.js CommonJS (`scripts/generate-registry.cjs`)
- **CI/CD**: GitHub Actions YAML
- **Static hosting**: GitHub Pages via Astro build output
- **Hashing**: Node.js built-in `node:crypto` (SHA-1, SHA-512)
- **Docs**: Starlight/Astro MDX

### Architecture

```
Release Flow:
  release.sh / release.yml
    → npm pack (creates .tgz)
    → node scripts/generate-registry.cjs (reads existing packument, appends version, computes hashes)
    → copies tarball to docs/public/registry/-/@eai-tools/
    → writes packument to docs/public/registry/@eai-tools/cli
    → commits to main
    → push triggers docs.yml → deploys to GitHub Pages

Consumer Flow:
  .npmrc: @eai-tools:registry=https://eai-tools.github.io/eai-cli/registry
  npm install @eai-tools/cli
    → GET https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli
    → parses packument JSON (served as text/plain, npm doesn't validate)
    → resolves version via semver + dist-tags
    → GET https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-{ver}.tgz
    → verifies integrity hash
    → installs
```

### Integration Points

| Component | File | Integration Type |
|-----------|------|------------------|
| Release workflow | `.github/workflows/release.yml` | Modify: replace npm publish with registry generation |
| Docs workflow | `.github/workflows/docs.yml` | No change: already deploys docs/dist |
| Release script | `release.sh` | Modify: remove Homebrew refs, update install instructions |
| Installation docs | `docs/src/content/docs/getting-started/installation.mdx` | Rewrite: new install tabs |
| Package config | `package.json` | Modify: remove publishConfig |
| Static assets | `docs/public/registry/` (NEW) | Registry files served by Astro |
| Generator script | `scripts/generate-registry.cjs` (NEW) | Creates packument + copies tarball |

### Key Dependencies

- `node:crypto` — SHA-1 and SHA-512 hash computation (built-in)
- `node:fs` — File I/O for reading/writing registry files (built-in)
- `node:path` — Path resolution (built-in)
- No new npm dependencies required

## Implementation Phases

### Phase 1: Registry Generation Script

**Goal**: Create the script that generates npm registry metadata and manages
tarballs.

**Files**:
- `scripts/generate-registry.cjs` (NEW)

**Tasks**:

- [ ] Create `scripts/generate-registry.cjs` that:
  1. Reads `package.json` for name, version, description, bin, engines,
     dependencies
  2. Finds the `npm pack` tarball in the project root (glob `*.tgz`)
  3. Computes SHA-1 (shasum) and SHA-512 (integrity SRI) of the tarball
  4. Reads existing packument from
     `docs/public/registry/@eai-tools/cli` (if exists)
  5. Appends the new version entry to the packument
  6. Updates `dist-tags.latest` to the new version
  7. Writes the updated packument (extensionless file, JSON content)
  8. Creates directory `docs/public/registry/-/@eai-tools/` if needed
  9. Copies tarball to
     `docs/public/registry/-/@eai-tools/cli-{version}.tgz`
  10. Logs what was done (version added, files written)

**Packument structure**:
```json
{
  "name": "@eai-tools/cli",
  "dist-tags": { "latest": "0.1.0" },
  "versions": {
    "0.1.0": {
      "name": "@eai-tools/cli",
      "version": "0.1.0",
      "description": "...",
      "bin": { "eai": "./dist/index.js" },
      "engines": { "node": ">=20.0.0" },
      "dependencies": { ... },
      "dist": {
        "tarball": "https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-0.1.0.tgz",
        "shasum": "<sha1-hex-40-chars>",
        "integrity": "sha512-<base64>"
      }
    }
  },
  "modified": "2026-03-09T00:00:00.000Z"
}
```

**Verification**:
- [ ] Script runs without errors: `node scripts/generate-registry.cjs`
- [ ] Packument JSON is valid and contains expected fields
- [ ] Hashes match manual computation: `shasum *.tgz` and `openssl dgst -sha512 -binary *.tgz | base64`
- [ ] Running twice with the same version overwrites (idempotent)
- [ ] Running with a new version appends to existing packument

---

### Phase 2: Release Workflow Updates

**Goal**: Replace npm publish with registry generation and commit.

**Files**:
- `.github/workflows/release.yml` (MODIFY)

**Tasks**:

- [ ] Remove the `npm publish` step and `NODE_AUTH_TOKEN` env var
- [ ] Remove `registry-url: https://registry.npmjs.org` from node setup
- [ ] After `npm pack`, add step: `node scripts/generate-registry.cjs`
- [ ] Add step to commit and push registry files to main:
  ```yaml
  - name: Commit registry files
    run: |
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add docs/public/registry/
      git commit -m "chore: publish v${{ steps.version.outputs.version }} to registry"
      git push origin HEAD:main
  ```
- [ ] Update GitHub Release body: remove Homebrew instructions, update
  install instructions to reference `.npmrc` configuration
- [ ] Ensure `permissions: contents: write` is set (already is)

**Verification**:
- [ ] Workflow YAML is valid (lint with `actionlint` or manual review)
- [ ] No references to `npm publish` or `NPM_TOKEN`
- [ ] No Homebrew references in release body
- [ ] Registry commit step uses bot credentials

---

### Phase 3: Release Script Updates

**Goal**: Update `release.sh` to remove Homebrew references and update
install instructions.

**Files**:
- `release.sh` (MODIFY)

**Tasks**:

- [ ] Remove any Homebrew references from install instructions in the
  `gh release create` notes
- [ ] Update install instructions to show `.npmrc` setup + `npm install`
- [ ] Add registry generation step to local release flow:
  After `npm pack`, run `node scripts/generate-registry.cjs`
- [ ] Add `docs/public/registry/` to the `git add` step so registry files
  are committed with the release

**Verification**:
- [ ] No "brew" or "homebrew" in release.sh (case-insensitive grep)
- [ ] Install instructions reference `.npmrc` configuration
- [ ] Registry files are staged and committed

---

### Phase 4: Package.json Cleanup

**Goal**: Remove npm publish configuration since we're not publishing to
npmjs.com.

**Files**:
- `package.json` (MODIFY)

**Tasks**:

- [ ] Remove `publishConfig` section (`"access": "public"`)

**Verification**:
- [ ] `package.json` is valid JSON
- [ ] No `publishConfig` key exists
- [ ] `npm run build` still works

---

### Phase 5: Documentation Updates

**Goal**: Rewrite installation docs to use the static registry as primary
install method. Remove all Homebrew references.

**Files**:
- `docs/src/content/docs/getting-started/installation.mdx` (REWRITE)

**Tasks**:

- [ ] Replace install tabs with three methods:
  1. **npm registry (recommended)**: Configure `.npmrc`, then
     `npm install -g @eai-tools/cli`
  2. **npm from GitHub**: Direct `npm install -g github:eai-tools/eai-cli`
     (existing method, now secondary)
  3. **From source**: Clone, build, link (unchanged)
- [ ] Remove Homebrew tab entirely
- [ ] Add `.npmrc` configuration instructions with code block:
  ```
  @eai-tools:registry=https://eai-tools.github.io/eai-cli/registry
  ```
- [ ] Explain where to create `.npmrc` (project root or `~/.npmrc`)
- [ ] Update the "Update" section: remove Homebrew tab, add registry update
  method (`npm install -g @eai-tools/cli@latest`)
- [ ] Update the "Uninstall" section: remove Homebrew tab
- [ ] Keep "npm from GitHub" as the secondary/fallback install method

**Verification**:
- [ ] No "brew", "Homebrew", or "tap" in the file
- [ ] Docs build succeeds: `cd docs && npm run build`
- [ ] Installation instructions are accurate and complete

---

### Phase 6: Seed Initial Registry

**Goal**: Generate the initial registry files for the current version so the
registry is immediately usable after deployment.

**Files**:
- `docs/public/registry/@eai-tools/cli` (NEW, generated)
- `docs/public/registry/-/@eai-tools/cli-0.1.0.tgz` (NEW, generated)

**Tasks**:

- [ ] Run `npm run build && npm pack` to create the tarball
- [ ] Run `node scripts/generate-registry.cjs` to generate initial registry
- [ ] Verify the generated files are correct
- [ ] The files will be committed with the rest of the changes

**Verification**:
- [ ] `docs/public/registry/@eai-tools/cli` exists and is valid JSON
- [ ] `docs/public/registry/-/@eai-tools/cli-0.1.0.tgz` exists
- [ ] Hashes in packument match actual tarball
- [ ] Astro build includes registry files: `cd docs && npm run build` then
  check `docs/dist/registry/` exists

---

## File Structure

```
scripts/
  generate-registry.cjs              ← NEW: registry metadata generator

docs/public/registry/
  @eai-tools/
    cli                              ← NEW: extensionless packument JSON
  -/
    @eai-tools/
      cli-0.1.0.tgz                 ← NEW: tarball (npm pack output)

.github/workflows/
  release.yml                        ← MODIFIED: no npm publish, adds registry gen
  docs.yml                           ← UNCHANGED

docs/src/content/docs/getting-started/
  installation.mdx                   ← MODIFIED: new install tabs

package.json                         ← MODIFIED: remove publishConfig
release.sh                           ← MODIFIED: remove Homebrew, add registry
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| npm starts validating Content-Type | High — registry breaks | Low probability. If it happens, switch to Cloudflare Pages or add a redirect layer. Monitor npm changelogs. |
| GitHub Pages rate limiting | Medium — install failures during spikes | GitHub Pages has generous limits. Only an issue if hundreds of concurrent installs. |
| Release workflow fails to push to main | High — registry not updated | Use bot credentials with write permission. Test with a dry run first. |
| Tarball size grows over time | Low — disk usage | ~50KB per version. At 100 versions = 5MB. Well within Pages limits. |
| Consumer doesn't configure .npmrc | Medium — confusing error | Docs prominently explain .npmrc setup. Error message from npm will say "not found" which is generic. |

## Notes

- **No new npm dependencies**: The registry generator uses only Node.js built-ins
  (`node:crypto`, `node:fs`, `node:path`).
- **Idempotent generation**: Running the script twice with the same version
  overwrites rather than duplicating.
- **Backward compatible**: The `npm install -g github:eai-tools/eai-cli` method
  still works as a fallback.
- **Docs workflow unchanged**: Registry files in `docs/public/` are automatically
  included in the Astro build and deployed by the existing `docs.yml` workflow.

## Spec Traceability

### User Story Coverage

| Story | Priority | Plan Phase(s) | Components |
|-------|----------|---------------|------------|
| US1: Install via npm | P1 | Phase 1, 6 | generate-registry.cjs, registry files |
| US2: Release publishes to registry | P1 | Phase 1, 2, 3, 6 | generate-registry.cjs, release.yml, release.sh |
| US3: Documentation guides consumers | P2 | Phase 5 | installation.mdx |
| US4: Semver resolution and updates | P2 | Phase 1 | generate-registry.cjs (packument format) |

### Requirement Coverage

| Requirement | Status | Plan Reference |
|-------------|--------|----------------|
| FR-001: Valid packument | COVERED | Phase 1: packument structure |
| FR-002: SHA-1 and SHA-512 hashes | COVERED | Phase 1: hash computation |
| FR-003: Accumulate versions | COVERED | Phase 1: read existing + append |
| FR-004: Extensionless file at correct path | COVERED | Phase 1: file output path |
| FR-005: Tarballs at correct path | COVERED | Phase 1: tarball copy |
| FR-006: Package metadata in versions | COVERED | Phase 1: extract from package.json |
| FR-007: Commit to main + push | COVERED | Phase 2: git commit step, Phase 3: release.sh |
| FR-008: Docs describe .npmrc + npm install | COVERED | Phase 5: installation.mdx rewrite |
| FR-009: No Homebrew in docs | COVERED | Phase 5: remove Homebrew tab |
| FR-010: No npm publish | COVERED | Phase 2: remove npm publish step |
| FR-011: No Homebrew in release.sh | COVERED | Phase 3: remove Homebrew refs |
| FR-012: No Homebrew in GitHub Release | COVERED | Phase 2: update release body |

**Coverage: 100% of user stories (4/4), 100% of functional requirements (12/12)**
