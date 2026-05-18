# Quickstart: Static npm Registry

## Prerequisites

- Node.js 20+
- npm 7+
- Access to the eai repository

## Testing the Registry (After Implementation)

### 1. Generate Registry Locally

```bash
npm run build
npm pack
node scripts/generate-registry.cjs
```

Verify output:
```bash
# Packument exists and is valid JSON
cat docs/public/registry/@eai-tools/cli | python3 -m json.tool

# Tarball exists
ls -la docs/public/registry/-/@eai-tools/cli-*.tgz
```

### 2. Test with Astro Build

```bash
cd docs && npm run build
ls docs/dist/registry/@eai-tools/cli
ls docs/dist/registry/-/@eai-tools/cli-*.tgz
```

### 3. Test npm Install (After Deployment)

```bash
# Configure .npmrc
echo "@eai-tools:registry=https://eai-tools.github.io/eai/registry" >> ~/.npmrc

# Install
npm install -g @eai-tools/cli

# Verify
eai --version
```

### 4. Verify No Homebrew References

```bash
grep -ri "brew\|homebrew\|tap" \
  docs/src/content/docs/getting-started/installation.mdx \
  .github/workflows/release.yml \
  release.sh
# Should return no matches
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/generate-registry.cjs` | Generates packument + copies tarball |
| `docs/public/registry/@eai-tools/cli` | Packument metadata (extensionless JSON) |
| `docs/public/registry/-/@eai-tools/` | Tarball storage |
| `.github/workflows/release.yml` | Automated registry publishing |
| `docs/.../installation.mdx` | Consumer-facing install docs |

## Common Issues

### npm says "not found"

**Problem**: `npm install @eai-tools/cli` returns 404
**Solution**: Check `.npmrc` is configured with the registry URL:
```
@eai-tools:registry=https://eai-tools.github.io/eai/registry
```

### Integrity check failed

**Problem**: npm reports checksum mismatch
**Solution**: Registry was likely regenerated for the same version. Run:
```bash
npm cache clean --force
npm install -g @eai-tools/cli
```
