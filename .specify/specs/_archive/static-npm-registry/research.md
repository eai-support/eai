---
date: 2026-03-09T07:45:00Z
researcher: Claude
feature: 'Static npm Registry on GitHub Pages'
status: complete
---

# Research: Static npm Registry on GitHub Pages

## Feature Summary

Distribute `@eai-tools/cli` via a static npm registry hosted on GitHub Pages at
`https://eai-tools.github.io/eai-cli/registry`. Consumers set a single `.npmrc`
line and use standard `npm install @eai-tools/cli` with full semver support. The
GitHub repo remains private; the Pages site is public. Homebrew distribution is
being removed.

Additional requirement: update the docs site installation page to reflect the
new registry-based install flow and remove Homebrew references.

## Codebase Analysis

### Where to Implement

| Component                | Location                                            | Purpose                                            |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------- |
| Registry generator       | `scripts/generate-registry.cjs` (NEW)               | Generate registry metadata JSON + copy tarballs    |
| Release workflow         | `.github/workflows/release.yml`                     | Build tarball, generate registry, deploy to Pages  |
| Docs workflow            | `.github/workflows/docs.yml`                        | Deploy docs + registry artifacts together          |
| Registry static files    | `docs/public/registry/` (NEW)                       | Extensionless metadata files served by Pages       |
| Installation docs        | `docs/src/content/docs/getting-started/installation.mdx` | Update install instructions                   |
| Release script           | `release.sh`                                        | Update install instructions in release notes       |
| Astro config             | `docs/astro.config.mjs`                             | No changes needed — `base: '/eai-cli'` works       |
| Package config           | `package.json`                                      | Remove `publishConfig` (no longer publishing to npm) |

### Existing Patterns to Follow

#### Pattern 1: Static File Generation Script

Found in: `scripts/generate-llms-full.cjs`

```javascript
const fs = require('fs');
const path = require('path');
const DOCS_DIR = path.join(__dirname, '../docs/src/content/docs');
const OUTPUT_FILE = path.join(__dirname, '../docs/public/llms-full.txt');
// ... reads source files, generates output, writes to docs/public/
```

Why relevant: Same pattern — a Node.js script that generates files into
`docs/public/` for static serving on GitHub Pages.

#### Pattern 2: Release Workflow with npm pack

Found in: `.github/workflows/release.yml:53-54`

```yaml
- name: Create npm tarball
  run: npm pack
```

Why relevant: `npm pack` already creates tarballs. We need to copy these into
the registry directory structure.

#### Pattern 3: Docs Deployment Pipeline

Found in: `.github/workflows/docs.yml:44-51`

```yaml
- name: Upload Pages artifact
  uses: actions/upload-pages-artifact@v3
  with:
    path: docs/dist

- name: Deploy to GitHub Pages
  uses: actions/deploy-pages@v4
```

Why relevant: Everything in `docs/dist/` gets deployed. Files in `docs/public/`
are copied to `docs/dist/` during Astro build. So placing registry files in
`docs/public/registry/` makes them available at
`https://eai-tools.github.io/eai-cli/registry/`.

#### Pattern 4: Tabbed Installation Instructions

Found in: `docs/src/content/docs/getting-started/installation.mdx:33-78`

Uses Starlight `<Tabs>` and `<TabItem>` components for multiple install methods.
Currently has: npm from GitHub (recommended), Homebrew, From source.

### Integration Points

1. **Release workflow → Registry**: On tag push, the release workflow must run
   `npm pack`, generate registry metadata JSON, copy tarball and metadata into
   `docs/public/registry/`, then trigger a docs deployment.

2. **Docs build → Static files**: Astro copies `docs/public/` to `docs/dist/`
   during build. Registry files placed in `docs/public/registry/` will be
   available at `/eai-cli/registry/` on the deployed site.

3. **Cross-workflow coordination**: The release workflow creates tarballs, but
   the docs workflow deploys Pages. Options:
   - (A) Release workflow commits registry files to `docs/public/registry/`
     on main, which triggers docs workflow
   - (B) Release workflow does both: generates registry + deploys Pages directly
   - (C) Release workflow uses `workflow_dispatch` to trigger docs workflow

   **Recommendation**: Option A — simplest, uses existing pipeline.

### Related Code

- `package.json:2-3` — Name: `@eai-tools/cli`, Version: `0.1.0`
- `package.json:18-20` — Files: `["dist"]` (what goes in tarball)
- `package.json:41-43` — publishConfig: `access: public` (to remove)
- `.npmignore` — Excludes src/, docs/, .specify/ etc. from tarball
- `release.sh:139-151` — Creates GitHub release with install instructions
- `release.sh:88-90` — References Homebrew (to remove)
- `docs/astro.config.mjs:5-6` — `site` + `base` configuration

## Technology Decisions

### Decision 1: Extensionless Files on GitHub Pages

- **Choice**: Create extensionless files (no `.json` extension) directly in
  the registry directory
- **Rationale**: npm requests `GET /@eai-tools/cli` (no extension). GitHub
  Pages serves extensionless files as `text/plain`. **Confirmed**: npm does NOT
  validate Content-Type headers — `npm-registry-fetch` calls `res.json()`
  directly without checking Content-Type. The `check-response.js` module only
  validates HTTP status codes, not MIME types.
- **Evidence**: npm-registry-fetch source code at
  `github.com/npm/npm-registry-fetch/blob/main/lib/index.js` shows
  `regFetch(uri, opts).then(res => res.json())` with no content-type check.
  `check-response.js` uses `JSON.parse(body.toString('utf8'))` in a try-catch
  with no MIME validation.
- **Risk**: Future npm versions could add Content-Type validation. Low
  probability — the npm client has operated this way since at least npm 7.

### Decision 2: Registry URL Structure

- **Choice**: `https://eai-tools.github.io/eai-cli/registry`
- **Rationale**: Sits alongside the docs site under the same base path.
  Consumer `.npmrc`: `@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry`
- **URL mapping**: npm requests
  `https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli` →
  GitHub Pages serves file at `docs/public/registry/@eai-tools/cli` (note: `cli`
  is a file, not a directory)

### Decision 3: Tarball Location

- **Choice**: Store tarballs in `registry/-/@eai-tools/` directory on Pages
- **Rationale**: Follows the npm registry convention. The `dist.tarball` URL
  in the metadata points to
  `https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-{version}.tgz`
- **Alternative considered**: GitHub Releases download URLs — rejected because
  the repo is private, so release download URLs require authentication.

### Decision 4: Registry Generation Script

- **Choice**: Node.js script (`scripts/generate-registry.cjs`) using only
  built-in `node:crypto` and `node:fs` — no additional dependencies
- **Rationale**: Follows the pattern of `scripts/generate-llms-full.cjs`. Uses
  CommonJS for script simplicity. Generates SHA-1 (`shasum`) and SHA-512
  (`integrity`) hashes from the tarball.
- **Alternative considered**: Shell script with `shasum`/`openssl` — rejected
  because Node.js crypto produces the exact formats npm expects (hex for SHA-1,
  base64 for SHA-512 SRI).

### Decision 5: Version Accumulation Strategy

- **Choice**: The generate script reads existing registry metadata (if present)
  and appends the new version, preserving history
- **Rationale**: npm needs all versions listed in the packument for semver
  resolution. Each release appends to the existing metadata rather than
  replacing it. The metadata file is committed to the repo in
  `docs/public/registry/`.

### Decision 6: Remove Homebrew Distribution

- **Choice**: Remove all Homebrew references from docs, release workflow,
  and release script
- **Rationale**: User confirmed Homebrew is not a distribution channel for
  this CLI. The `homebrew-tap/` directory can remain as a template but won't
  be referenced in user-facing docs.

## npm Registry API Format

### Packument (Package Metadata)

The file at `registry/@eai-tools/cli` must contain:

```json
{
  "name": "@eai-tools/cli",
  "dist-tags": {
    "latest": "0.1.0"
  },
  "versions": {
    "0.1.0": {
      "name": "@eai-tools/cli",
      "version": "0.1.0",
      "description": "EAI Platform CLI",
      "bin": {
        "eai": "./dist/index.js"
      },
      "engines": {
        "node": ">=20.0.0"
      },
      "dependencies": {
        "chalk": "^5.3.0",
        "commander": "^13.1.0",
        "dotenv": "^16.4.7",
        "inquirer": "^12.3.2",
        "ora": "^8.1.1"
      },
      "dist": {
        "tarball": "https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-0.1.0.tgz",
        "shasum": "<sha1-hex>",
        "integrity": "sha512-<base64>"
      }
    }
  },
  "modified": "2026-03-09T00:00:00.000Z"
}
```

### Required Hash Formats

- **shasum**: SHA-1 hex string (40 chars) — `crypto.createHash('sha1').update(data).digest('hex')`
- **integrity**: SHA-512 SRI format — `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`

### File System Layout on GitHub Pages

```
docs/public/registry/
  @eai-tools/
    cli                              ← extensionless file containing packument JSON
  -/
    @eai-tools/
      cli-0.1.0.tgz                 ← actual tarball (copied from npm pack output)
      cli-0.2.0.tgz                 ← future versions accumulate here
```

After Astro build, these appear at:
```
https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli       ← packument
https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-0.1.0.tgz  ← tarball
```

## Constraints & Considerations

- **Private repo, public Pages**: The GitHub repo is private but Pages is
  public. This means GitHub Release download URLs won't work for unauthenticated
  consumers — tarballs must be hosted on Pages.
- **Accumulating versions**: Each release must append to existing metadata,
  not replace it. The metadata file is committed to the repo.
- **Base path**: The Astro `base: '/eai-cli'` means all URLs are under
  `/eai-cli/`. The registry URL is `/eai-cli/registry/`.
- **Content-Type**: GitHub Pages serves extensionless files as `text/plain`.
  Confirmed npm doesn't validate this.
- **Tarball size**: CLI tarballs are small (~50KB). GitHub Pages has a 1GB
  soft limit — not a concern.
- **docs workflow trigger**: Adding files to `docs/public/registry/` and
  pushing to main will trigger the docs workflow (paths filter: `docs/**`).

## Brownfield Analysis

### Changes to Existing Files

| File | Change | Risk |
|------|--------|------|
| `.github/workflows/release.yml` | Replace npm publish with registry generation + commit | Medium — core release flow |
| `release.sh` | Remove Homebrew refs, update install instructions | Low |
| `docs/.../installation.mdx` | Rewrite install tabs (remove Homebrew, add registry) | Low |
| `package.json` | Remove `publishConfig` | Low |

### What Must NOT Change

- Astro config `site` and `base` values
- Docs workflow deployment mechanism (artifact upload)
- CLI build pipeline (tsc → dist/)
- Tag-based release trigger

## Open Questions

- [x] Does npm validate Content-Type? → **No**, confirmed via source code
- [x] Can GitHub Pages serve extensionless files? → **Yes**, as text/plain
- [ ] Should we keep the `npm publish` step alongside the static registry? (for
  future public npm distribution) — **Recommendation**: Remove it. The user
  explicitly said no public npm. Can be re-added later.

## Recommendations

1. **Create `scripts/generate-registry.cjs`** — reads existing metadata,
   appends new version, writes extensionless packument + copies tarball
2. **Modify `release.yml`** — replace `npm publish` with: `npm pack` →
   `node scripts/generate-registry.cjs` → commit to main → push (triggers
   docs deploy)
3. **Rewrite `installation.mdx`** — npm registry (recommended), npm from
   GitHub (alternative), from source. Remove Homebrew entirely.
4. **Update `release.sh`** — remove Homebrew references, update install
   instructions to use registry
5. **Update `release.yml`** — remove Homebrew from GitHub Release body
6. **Remove `publishConfig`** from `package.json` — no longer publishing to
   npmjs.org
