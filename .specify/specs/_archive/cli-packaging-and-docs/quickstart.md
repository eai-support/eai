# Quickstart: CLI Packaging & Documentation

## Prerequisites

- Node.js 20+
- npm 9+
- Git
- GitHub account with access to `eai-tools` org

## Phase 1 Quick Test (IP Sanitization)

After completing Phase 1 IP sanitization:

```bash
# Verify no internal terms in user-facing code
grep -r "Configurator\|ResourceAPI\|AICore\|PayloadCMS" src/ --include="*.ts" | grep -v "// internal"
# Expected: empty (no matches)

grep -r "enterpriseaigroup" src/
# Expected: empty (no matches)

grep -r "JSONB\|OBO\|OPA\|HyPE\|RLS" src/ --include="*.ts"
# Expected: empty in user-facing strings

# Test build
npm run build && npm run lint

# Test generated content
node dist/index.js init test-project --skip-prompts
grep -r "Configurator\|ResourceAPI\|AICore\|JSONB\|OPA" test-project/CLAUDE.md
# Expected: empty
rm -rf test-project
```

## Phase 2 Quick Test (Packaging)

```bash
# Check npm pack contents
npm pack --dry-run
# Expected: only dist/, package.json, README.md, LICENSE

# Verify version
node dist/index.js --version
# Expected: matches package.json version
```

## Phase 4 Quick Test (Documentation Site)

```bash
cd docs
npm install
npm run dev
# Visit http://localhost:4321/eai-cli/
# Check: search works, dark mode toggles, navigation functions
# Check: /llms.txt is accessible
```

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Package metadata, scripts, dependencies |
| `src/index.ts` | CLI entry point with dynamic version |
| `.npmignore` | Files excluded from npm package |
| `.github/workflows/ci.yml` | CI on pull requests |
| `.github/workflows/release.yml` | npm publish on tag |
| `.github/workflows/docs.yml` | Docs deploy on push |
| `docs/astro.config.mjs` | Starlight configuration |
| `docs/src/content/docs/` | Documentation content |

## Common Issues

### npm publish fails with 403

**Problem**: Package scope requires public access
**Solution**: Ensure `publishConfig.access` is `"public"` in package.json

### GitHub Pages 404

**Problem**: Pages not enabled or wrong source
**Solution**: Repository Settings → Pages → Source: GitHub Actions

### Version mismatch

**Problem**: `eai --version` shows wrong version
**Solution**: Ensure index.ts reads from package.json, not hardcoded
