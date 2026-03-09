---
feature: Static npm Registry on GitHub Pages
created: 2026-03-09T19:15:00.000Z
spec: spec.md
status: draft
coverage:
  user_stories: 4/4
  acceptance_criteria: 11/11
---

# Test Cases: Static npm Registry on GitHub Pages

## Test Coverage Matrix

| User Story | Acceptance Criterion | Test Case(s) | Status |
|------------|---------------------|--------------|--------|
| US1: Install CLI via npm | AC1: npm install with .npmrc succeeds | TC001, TC002, TC003 | Defined |
| US1: Install CLI via npm | AC2: Specific version installs | TC004 | Defined |
| US1: Install CLI via npm | AC3: Semver range resolves | TC038 | Defined |
| US2: Release publishes to registry | AC1: release.sh generates registry | TC006, TC007, TC008 | Defined |
| US2: Release publishes to registry | AC2: Version accumulation | TC009, TC010 | Defined |
| US2: Release publishes to registry | AC3: npm view lists versions | TC039 | Defined |
| US3: Documentation guides consumers | AC1: Docs show .npmrc + npm install | TC012, TC013, TC014, TC015, TC016 | Defined |
| US3: Documentation guides consumers | AC2: No Homebrew in docs | TC017, TC018 | Defined |
| US3: Documentation guides consumers | AC3: Documented steps work | TC019 | Defined |
| US4: Semver resolution and updates | AC1: npm outdated detects updates | TC020 | Defined |
| US4: Semver resolution and updates | AC2: npm install @latest upgrades | TC021 | Defined |
| Edge Cases | Missing .npmrc | TC022 | Defined |
| Edge Cases | First-ever release (no packument) | TC023 | Defined |
| Edge Cases | Idempotent generation | TC024 | Defined |
| Edge Cases | Integrity hash verification | TC025 | Defined |
| Edge Cases | Re-tagged release changes hashes | TC040 | Defined |
| FR Compliance | FR-001 through FR-012 | TC026 through TC033 | Defined |

## Test Case Definitions

### Phase 1: Registry Generation Script (generate-registry.cjs)

#### TC001: Script Produces Valid Packument From Scratch

Traces to: US1-AC1, FR-001

```bash
# TC001: Script produces valid packument from first-ever run
# Traces to: US1-AC1, FR-001
#
# removeExistingRegistryFiles
# buildProject
# createNpmPackTarball
#
# runGenerateRegistryScript
#
# expectPackumentFileExists "docs/public/registry/@eai-tools/cli"
# expectPackumentIsValidJSON
# expectPackumentHasField "name" "@eai-tools/cli"
# expectPackumentHasField "dist-tags.latest"
# expectPackumentHasField "versions"
```

#### TC002: Packument Contains Required Version Fields

Traces to: US1-AC1, FR-006

```bash
# TC002: Packument version entry has all required npm metadata
# Traces to: US1-AC1, FR-006
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
#
# parsePackument
#
# expectVersionEntryHasField "name" "@eai-tools/cli"
# expectVersionEntryHasField "version" "0.1.0"
# expectVersionEntryHasField "description"
# expectVersionEntryHasField "bin.eai" "./dist/index.js"
# expectVersionEntryHasField "engines.node" ">=20.0.0"
# expectVersionEntryHasField "dependencies"
# expectVersionEntryHasField "dist.tarball"
# expectVersionEntryHasField "dist.shasum"
# expectVersionEntryHasField "dist.integrity"
```

#### TC003: Tarball Copied to Correct Registry Path

Traces to: US1-AC1, FR-005

```bash
# TC003: Tarball is placed at the correct registry path
# Traces to: US1-AC1, FR-005
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
#
# expectFileExists "docs/public/registry/-/@eai-tools/cli-0.1.0.tgz"
# expectFileIsNonEmpty "docs/public/registry/-/@eai-tools/cli-0.1.0.tgz"
```

#### TC004: Tarball URL Points to GitHub Pages

Traces to: US1-AC2, FR-005

```bash
# TC004: Tarball URL in packument points to GitHub Pages
# Traces to: US1-AC2, FR-005
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
#
# parsePackument
#
# expectDistTarballUrl "https://eai-tools.github.io/eai-cli/registry/-/@eai-tools/cli-0.1.0.tgz"
```

#### TC005: SHA-1 and SHA-512 Hashes Are Correct

Traces to: US1-AC1, FR-002

```bash
# TC005: Integrity hashes match actual tarball content
# Traces to: US1-AC1, FR-002
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
#
# computeActualSHA1 "docs/public/registry/-/@eai-tools/cli-0.1.0.tgz"
# computeActualSHA512 "docs/public/registry/-/@eai-tools/cli-0.1.0.tgz"
# parsePackument
#
# expectShasumMatchesActual
# expectIntegrityStartsWith "sha512-"
# expectIntegrityMatchesActual
```

### Phase 1 Edge Cases

#### TC023: First-Ever Run Creates Packument From Scratch

Traces to: Edge Case: no existing packument

```bash
# TC023: First-ever run creates new packument (no prior file)
# Traces to: Edge Case
#
# removeExistingRegistryFiles
# buildProject
# createNpmPackTarball
#
# runGenerateRegistryScript
#
# expectExitCodeZero
# expectPackumentFileExists
# expectPackumentHasOneVersion
```

#### TC024: Idempotent Generation — Same Version Twice

Traces to: Edge Case: re-run same version

```bash
# TC024: Running script twice with same version overwrites, not duplicates
# Traces to: Edge Case
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
#
# runGenerateRegistryScript  # second run
#
# expectPackumentHasExactlyOneVersionEntry "0.1.0"
# expectNoErrors
```

#### TC009: Version Accumulation — Multiple Versions

Traces to: US2-AC2, FR-003

```bash
# TC009: New version appends to existing packument
# Traces to: US2-AC2, FR-003
#
# seedPackumentWithVersion "0.1.0"
# bumpVersionInPackageJson "0.2.0"
# buildProject
# createNpmPackTarball
#
# runGenerateRegistryScript
#
# expectPackumentHasVersionEntry "0.1.0"
# expectPackumentHasVersionEntry "0.2.0"
# expectDistTagLatest "0.2.0"
```

#### TC010: Version Accumulation Preserves Prior Entries

Traces to: US2-AC2, FR-003

```bash
# TC010: Existing versions are preserved when new version is added
# Traces to: US2-AC2, FR-003
#
# seedPackumentWithVersion "0.1.0"
# recordExistingVersionHashes "0.1.0"
# bumpVersionInPackageJson "0.2.0"
# buildProject
# createNpmPackTarball
#
# runGenerateRegistryScript
#
# expectVersion010HashesUnchanged
# expectVersion020HasCorrectHashes
```

#### TC025: Tarball Integrity — File Not Corrupted During Copy

Traces to: Edge Case: integrity verification

```bash
# TC025: Tarball in registry matches original npm pack output
# Traces to: Edge Case
#
# buildProject
# createNpmPackTarball
# recordSourceTarballChecksum
#
# runGenerateRegistryScript
#
# expectRegistryTarballChecksumMatchesSource
```

### Phase 2: Release Workflow (release.yml)

#### TC006: No npm Publish in Release Workflow

Traces to: US2-AC1, FR-010

```bash
# TC006: release.yml does not publish to npmjs.com
# Traces to: US2-AC1, FR-010
#
# readFile ".github/workflows/release.yml"
#
# expectNoMatch "npm publish"
# expectNoMatch "NPM_TOKEN"
# expectNoMatch "registry.npmjs.org"
# expectNoMatch "NODE_AUTH_TOKEN"
```

#### TC007: Registry Generation Step Exists in Workflow

Traces to: US2-AC1, FR-007

```bash
# TC007: release.yml includes registry generation and commit steps
# Traces to: US2-AC1, FR-007
#
# readFile ".github/workflows/release.yml"
#
# expectMatch "node scripts/generate-registry.cjs"
# expectMatch "git add docs/public/registry/"
# expectMatch "git push origin HEAD:main"
```

#### TC008: GitHub Release Body Has Correct Install Instructions

Traces to: US2-AC1, FR-012

```bash
# TC008: GitHub Release body references .npmrc, not Homebrew
# Traces to: US2-AC1, FR-012
#
# readFile ".github/workflows/release.yml"
#
# expectMatch "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
# expectMatch "npm install -g @eai-tools/cli"
# expectNoMatch "brew"
# expectNoMatch "homebrew"
# expectNoMatch "tap"
```

### Phase 3: Release Script (release.sh)

#### TC026: Release Script Has Registry Generation Step

Traces to: US2-AC1, FR-007

```bash
# TC026: release.sh runs registry generation after npm pack
# Traces to: US2-AC1, FR-007
#
# readFile "release.sh"
#
# expectMatch "node scripts/generate-registry.cjs"
# expectMatchBefore "npm pack" "node scripts/generate-registry.cjs"
```

#### TC027: Release Script Stages Registry Files

Traces to: US2-AC1, FR-007

```bash
# TC027: release.sh includes registry files in git add
# Traces to: US2-AC1, FR-007
#
# readFile "release.sh"
#
# expectMatch "git add.*docs/public/registry/"
```

#### TC028: Release Script Install Instructions Use .npmrc

Traces to: FR-011

```bash
# TC028: release.sh install instructions reference .npmrc
# Traces to: FR-011
#
# readFile "release.sh"
#
# expectMatch "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
# expectMatch "npm install -g @eai-tools/cli"
# expectNoMatchCaseInsensitive "brew"
# expectNoMatchCaseInsensitive "homebrew"
```

### Phase 4: Package.json Cleanup

#### TC029: No publishConfig in package.json

Traces to: FR-010

```bash
# TC029: package.json does not contain publishConfig
# Traces to: FR-010
#
# readFile "package.json"
# parseJSON
#
# expectNoKey "publishConfig"
# expectValidJSON
```

#### TC030: Build Still Works After publishConfig Removal

Traces to: FR-010

```bash
# TC030: npm run build succeeds without publishConfig
# Traces to: FR-010
#
# runCommand "npm run build"
#
# expectExitCodeZero
```

### Phase 5: Documentation Updates

#### TC012: Installation Page Has .npmrc Configuration

Traces to: US3-AC1, FR-008

```bash
# TC012: Installation docs show .npmrc configuration as first step
# Traces to: US3-AC1, FR-008
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectMatch "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
# expectMatch 'echo "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry" >> ~/.npmrc'
```

#### TC013: Installation Page Has npm Install as Primary Method

Traces to: US3-AC1, FR-008

```bash
# TC013: npm (recommended) is the primary install tab
# Traces to: US3-AC1, FR-008
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectMatch 'label="npm (recommended)"'
# expectMatch "npm install -g @eai-tools/cli"
```

#### TC014: Installation Page Has Three Install Tabs

Traces to: US3-AC1

```bash
# TC014: Three install methods are presented as tabs
# Traces to: US3-AC1
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectMatch 'label="npm (recommended)"'
# expectMatch 'label="npm from GitHub"'
# expectMatch 'label="From source"'
# expectMatchCount "TabItem" 3  # in the Install section
```

#### TC015: Installation Page Has Version Pinning

Traces to: US1-AC2

```bash
# TC015: Installation docs show how to pin specific version
# Traces to: US1-AC2
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectMatch "npm install -g @eai-tools/cli@0.1.0"
```

#### TC016: Installation Page Has Update Instructions

Traces to: US4-AC2

```bash
# TC016: Update section shows npm install @latest
# Traces to: US4-AC2
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectMatch "npm install -g @eai-tools/cli@latest"
```

#### TC017: No Homebrew in Installation Docs

Traces to: US3-AC2, FR-009

```bash
# TC017: installation.mdx has zero Homebrew references
# Traces to: US3-AC2, FR-009
#
# readFile "docs/src/content/docs/getting-started/installation.mdx"
#
# expectNoMatchCaseInsensitive "homebrew"
# expectNoMatchCaseInsensitive "brew install"
# expectNoMatchCaseInsensitive "brew tap"
# expectNoMatch 'label="Homebrew"'
```

#### TC018: No Homebrew in Any Modified Documentation

Traces to: US3-AC2, FR-009

```bash
# TC018: Zero Homebrew refs in README, SETUP.md, index.mdx, glossary.mdx
# Traces to: US3-AC2, FR-009
#
# grepCaseInsensitive "brew" "README.md"
# grepCaseInsensitive "brew" ".github/SETUP.md"
# grepCaseInsensitive "brew" "docs/src/content/docs/index.mdx"
# grepCaseInsensitive "brew" "docs/src/content/docs/reference/glossary.mdx"
#
# expectZeroMatches
```

#### TC019: Documented Steps Lead to Working Install

Traces to: US3-AC3

```bash
# TC019: Following documented install steps produces working CLI
# Traces to: US3-AC3
# Note: Requires deployed GitHub Pages. Manual post-deployment test.
#
# configureNpmrc "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
#
# runCommand "npm install -g @eai-tools/cli"
#
# expectCommandSucceeds "eai --version"
# expectOutputMatches "0.1.0"
```

### Docs Site Homepage (index.mdx)

#### TC031: Homepage Install Section Has .npmrc

Traces to: US3-AC1, FR-008

```bash
# TC031: Docs homepage shows .npmrc configuration in install section
# Traces to: US3-AC1, FR-008
#
# readFile "docs/src/content/docs/index.mdx"
#
# expectMatch "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
# expectMatch "npm install -g @eai-tools/cli"
# expectNoMatch "npx @eai-tools/cli"  # npx won't work without .npmrc
```

### Glossary (glossary.mdx)

#### TC032: Glossary CLI Entry Mentions .npmrc

Traces to: US3-AC1

```bash
# TC032: Glossary CLI definition mentions .npmrc configuration
# Traces to: US3-AC1
#
# readFile "docs/src/content/docs/reference/glossary.mdx"
#
# expectMatch "configuring the EAI registry in .npmrc"
# expectMatch "npm install -g @eai-tools/cli"
```

### README.md

#### TC033: README Install Section Uses .npmrc Method

Traces to: US3-AC1, FR-008

```bash
# TC033: README primary install uses .npmrc + npm install
# Traces to: US3-AC1, FR-008
#
# readFile "README.md"
#
# expectMatch "@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry"
# expectMatch "npm install -g @eai-tools/cli"
# expectNoMatch "github:eai-tools/eai-cli"  # old method removed as primary
# expectMatch "Registry generation"  # in releasing section
```

### SETUP.md

#### TC011: SETUP.md Describes Static Registry

Traces to: US2-AC3

```bash
# TC011: SETUP.md describes static registry instead of NPM_TOKEN
# Traces to: US2-AC3
#
# readFile ".github/SETUP.md"
#
# expectMatch "static npm registry"
# expectMatch "GitHub Pages"
# expectNoMatch "Set the name to.*NPM_TOKEN"  # old setup instructions
# expectNoMatch "npmjs.com/.*Access Tokens"
# expectMatch "Generate static registry metadata"
```

### Phase 6: Seed Registry & End-to-End

#### TC020: npm outdated Detects Available Update

Traces to: US4-AC1

```bash
# TC020: npm outdated shows @eai-tools/cli as outdated when newer version exists
# Traces to: US4-AC1
# Note: Requires deployed Pages with multiple versions. Manual test.
#
# installSpecificVersion "0.1.0"
# publishVersion "0.2.0"
#
# runCommand "npm outdated -g"
#
# expectOutputContains "@eai-tools/cli"
```

#### TC021: npm install @latest Upgrades

Traces to: US4-AC2

```bash
# TC021: npm install -g @eai-tools/cli@latest installs the newest version
# Traces to: US4-AC2
# Note: Requires deployed Pages with multiple versions. Manual test.
#
# installSpecificVersion "0.1.0"
# publishVersion "0.2.0"
#
# runCommand "npm install -g @eai-tools/cli@latest"
#
# expectCommandOutput "eai --version" "0.2.0"
```

#### TC022: Missing .npmrc Produces Clear Failure

Traces to: Edge Case: no .npmrc

```bash
# TC022: Install without .npmrc fails (package not found)
# Traces to: Edge Case
# Note: Requires clean environment without .npmrc. Manual test.
#
# removeNpmrcRegistryLine
#
# runCommand "npm install -g @eai-tools/cli"
#
# expectExitCodeNonZero
# expectErrorContains "404"  # or "not found"
```

### Build & Integration

#### TC034: TypeScript Build Succeeds

Traces to: Regression

```bash
# TC034: npm run build completes without errors
# Traces to: Regression
#
# runCommand "npm run build"
#
# expectExitCodeZero
```

#### TC035: ESLint Passes

Traces to: Regression

```bash
# TC035: npm run lint completes without errors
# Traces to: Regression
#
# runCommand "npm run lint"
#
# expectExitCodeZero
```

#### TC036: Docs Site Builds Successfully

Traces to: Regression

```bash
# TC036: Docs Astro build succeeds and includes registry files
# Traces to: Regression
#
# runCommand "cd docs && npm run build"
#
# expectExitCodeZero
# expectFileExists "docs/dist/registry/@eai-tools/cli"
# expectFileExists "docs/dist/registry/-/@eai-tools/cli-0.1.0.tgz"
```

#### TC037: Packument Survives Astro Build

Traces to: US1-AC1

```bash
# TC037: Packument in docs/dist matches docs/public source
# Traces to: US1-AC1
#
# runCommand "cd docs && npm run build"
#
# diffFiles "docs/public/registry/@eai-tools/cli" "docs/dist/registry/@eai-tools/cli"
#
# expectFilesIdentical
```

### Review Fixes (Added Post-Review)

#### TC038: Packument Structure Supports Semver Range Resolution

Traces to: US1-AC3

```bash
# TC038: Packument structure enables semver range resolution
# Traces to: US1-AC3
#
# parsePackument
#
# expectAllVersionKeysAreValidSemver
# expectDistTagLatestPointsToValidVersion
# expectEachVersionHasFields "dependencies" "engines" "bin"
# expectMultipleVersionsCanCoexist  # append a second version, verify both resolve
```

#### TC039: Packument Lists All Published Versions

Traces to: US2-AC3

```bash
# TC039: All released versions appear in packument versions object
# Traces to: US2-AC3
# Note: Full npm view test requires deployed Pages. This validates the data structure.
#
# parsePackument
#
# expectVersionsObjectIsNotEmpty
# expectEveryVersionHasDistObject
# expectEveryVersionHasTarballUrl
```

#### TC040: Re-Tagged Release Updates Hashes

Traces to: Edge Case: re-tagged version

```bash
# TC040: Re-running generate with modified tarball updates hashes
# Traces to: Edge Case
#
# buildProject
# createNpmPackTarball
# runGenerateRegistryScript
# recordPackumentHashes "0.1.0"
#
# modifySourceAndRepack  # change something, re-pack with same version
# runGenerateRegistryScript
#
# expectHashesChangedFromRecorded "0.1.0"
# expectPackumentHasExactlyOneVersionEntry "0.1.0"
```

## DSL Functions Required

### Setup Functions (To Create)

| Function | Purpose | Exists? |
|----------|---------|---------|
| `removeExistingRegistryFiles` | Delete docs/public/registry/ for clean-slate test | No |
| `buildProject` | Run `npm run build` | No |
| `createNpmPackTarball` | Run `npm pack` | No |
| `seedPackumentWithVersion(v)` | Manually create a packument with a specific version | No |
| `bumpVersionInPackageJson(v)` | Change version in package.json | No |
| `recordSourceTarballChecksum` | SHA256 of the source .tgz for comparison | No |
| `recordExistingVersionHashes(v)` | Save hashes for later comparison | No |
| `configureNpmrc(line)` | Write registry line to .npmrc | No |
| `removeNpmrcRegistryLine` | Remove @eai-tools registry config | No |
| `installSpecificVersion(v)` | `npm install -g @eai-tools/cli@{v}` | No |
| `publishVersion(v)` | Build, pack, generate for a specific version | No |

### Action Functions (To Create)

| Function | Purpose | Exists? |
|----------|---------|---------|
| `runGenerateRegistryScript` | Run `node scripts/generate-registry.cjs` | No |
| `runCommand(cmd)` | Execute a shell command and capture output | No |
| `readFile(path)` | Read file contents for assertion | No |
| `parsePackument` | Parse docs/public/registry/@eai-tools/cli as JSON | No |
| `parseJSON` | Parse a file as JSON | No |
| `grepCaseInsensitive(pattern, file)` | Case-insensitive search in file | No |
| `diffFiles(a, b)` | Compare two files | No |
| `computeActualSHA1(file)` | `shasum {file}` | No |
| `computeActualSHA512(file)` | `openssl dgst -sha512 -binary {file} | base64` | No |

### Assertion Functions (To Create)

| Function | Purpose | Exists? |
|----------|---------|---------|
| `expectExitCodeZero` | Verify last command returned 0 | No |
| `expectExitCodeNonZero` | Verify last command returned non-zero | No |
| `expectNoErrors` | No error output | No |
| `expectPackumentFileExists` | docs/public/registry/@eai-tools/cli exists | No |
| `expectPackumentIsValidJSON` | Packument parses as JSON | No |
| `expectPackumentHasField(field, value?)` | JSON field exists with optional value | No |
| `expectVersionEntryHasField(field, value?)` | Version entry field check | No |
| `expectPackumentHasVersionEntry(v)` | versions[v] exists | No |
| `expectPackumentHasExactlyOneVersionEntry(v)` | No duplicate version entries | No |
| `expectPackumentHasOneVersion` | Only 1 version in packument | No |
| `expectDistTagLatest(v)` | dist-tags.latest === v | No |
| `expectDistTarballUrl(url)` | dist.tarball matches expected URL | No |
| `expectShasumMatchesActual` | packument shasum matches computed | No |
| `expectIntegrityStartsWith(prefix)` | integrity field starts with sha512- | No |
| `expectIntegrityMatchesActual` | packument integrity matches computed | No |
| `expectFileExists(path)` | File exists on disk | No |
| `expectFileIsNonEmpty(path)` | File has >0 bytes | No |
| `expectRegistryTarballChecksumMatchesSource` | Registry copy matches original | No |
| `expectFilesIdentical` | Two files have identical content | No |
| `expectMatch(pattern)` | File content matches pattern | No |
| `expectNoMatch(pattern)` | File content does NOT match pattern | No |
| `expectNoMatchCaseInsensitive(pattern)` | Case-insensitive no-match | No |
| `expectMatchCount(pattern, n)` | Exactly n matches | No |
| `expectMatchBefore(a, b)` | Pattern a appears before pattern b | No |
| `expectNoKey(key)` | JSON does not contain key | No |
| `expectValidJSON` | File is valid JSON | No |
| `expectZeroMatches` | grep returned 0 results | No |
| `expectCommandSucceeds(cmd)` | Command exits 0 | No |
| `expectCommandOutput(cmd, expected)` | Command output matches | No |
| `expectOutputContains(text)` | Output contains text | No |
| `expectOutputMatches(pattern)` | Output matches pattern | No |
| `expectErrorContains(text)` | stderr contains text | No |

## Implementation Notes

### Test Approach

This project does not have a test framework configured. Tests are currently
executed as:

1. **Shell-based verification** — `release.sh` contains smoke tests (CLI version,
   help output, command registration, IP leak scan)
2. **Manual grep validation** — searching files for expected/unexpected patterns
3. **Build verification** — `npm run build`, `npm run lint`, `cd docs && npm run build`

### Recommended Test Implementation

Given the project's current state (no test framework), these test cases should be
implemented as a **shell verification script** following the existing `release.sh`
pattern:

```bash
scripts/verify-registry.sh
```

This script would execute the automatable test cases (TC001-TC018, TC023-TC037)
as a series of shell assertions, matching the project's established testing
pattern.

**Manual test cases** (TC019-TC022) require a deployed GitHub Pages environment
and should be executed as post-deployment verification (documented in SC-001
through SC-004 in the spec).

### Test File Location

Based on project patterns: `scripts/verify-registry.sh`

### Test Categories

| Category | Test Cases | Automatable? |
|----------|-----------|-------------|
| Registry Script | TC001-TC005, TC009-TC010, TC023-TC025 | Yes — shell |
| Release Workflow YAML | TC006-TC008 | Yes — grep |
| Release Script | TC026-TC028 | Yes — grep |
| Package.json | TC029-TC030 | Yes — jq/node |
| Documentation Content | TC012-TC018, TC031-TC033 | Yes — grep |
| Build & Integration | TC034-TC037 | Yes — shell |
| Consumer E2E (deployed) | TC019-TC022 | No — manual |

## Next Steps

1. [ ] Create `scripts/verify-registry.sh` implementing automatable test cases
2. [ ] Run verification script to confirm all tests pass
3. [ ] Document manual test procedure for TC019-TC022
4. [ ] Run manual tests after first GitHub Pages deployment
5. [ ] Integrate verification into `release.sh` pipeline (optional)
