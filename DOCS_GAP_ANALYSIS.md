# Documentation Gap Analysis for CLI Help Enhancement

## Summary

The CLI Help Enhancement feature implementation is **100% complete** but documentation on GitHub Pages is **NOT updated**.

**Docs Build Status:** ✅ PASS (98 pages, 4839 words indexed)
**Docs Deployment:** ✅ Live at https://eai-tools.github.io/eai/
**Feature Documentation:** ❌ **MISSING**

---

## Missing Documentation

### 1. Global CLI Options (NEW PAGE NEEDED)

**File to create:** `docs/src/content/docs/reference/global-options.mdx`

**Content needed:**

```markdown
---
title: Global Options
description: Global flags available on all eai commands
---

## Synopsis

All `eai` commands support these global options:

```
eai [global-options] <command> [command-options]
```

## Global Options

### `--describe`

Output a complete JSON schema of the CLI structure for programmatic consumption.

```bash
eai --describe
```

**Output:** JSON object with:
- `command`: CLI name
- `version`: CLI version
- `description`: CLI description
- `globalOptions`: Array of global option definitions
- `commands`: Array of all commands with their options and subcommands

**Use cases:**
- AI coding agents parsing CLI capabilities
- Automated tooling generation
- CLI structure validation

---

### `--format <format>`

Control output format for data-returning commands.

```bash
eai resources list User --format json
eai tenant list --format json | jq '.tenants[] | .slug'
```

**Valid formats:**
- `text` (default) — Human-readable formatted output
- `json` — Machine-readable JSON
- `yaml` — YAML format (planned, not yet implemented)

**Supported commands:** `resources list`, `resources get`, `tenant list`, `deploy status`, and all commands returning data

---

### `--simple`

Plain text output without colors or symbols for screen readers and accessibility.

```bash
eai --simple resources list User
```

**Output changes:**
- No ANSI color codes
- Symbols replaced with text (SUCCESS:, ERROR:, WARNING:, INFO:)
- Compatible with screen readers

---

### `--no-color`

Disable colored output (respects NO_COLOR environment variable).

```bash
eai --no-color resources list User
```

**Alternative:** Set `NO_COLOR=1` environment variable

---

### `--color`

Force colored output even when stdout is not a TTY.

```bash
eai --color resources list User | less -R
```

**Alternative:** Set `FORCE_COLOR=1` environment variable

---

## Environment Variables

- `NO_COLOR=1` — Disable colors globally
- `FORCE_COLOR=1` — Enable colors globally

Global flags override environment variables.
```

---

### 2. Structured CLI Error Codes (ADD TO EXISTING FILE)

**File to update:** `docs/src/content/docs/reference/error-codes.mdx`

**Add after line 118 (current CLI-Specific Errors section):**

```markdown
### Structured Error Codes

The CLI uses structured error codes (E001-E399) for programmatic error handling. Each error includes:
- **Code**: Machine-readable error code
- **Message**: Human-readable error description (with context interpolation)
- **Suggestion**: Actionable resolution steps
- **Exit Code**: Always `1` for errors

#### Error Code Categories

| Range | Category | Description |
|-------|----------|-------------|
| E001-E099 | Project Errors | Configuration, project structure, file not found |
| E100-E199 | Authentication Errors | Login, token expiry, credentials |
| E200-E299 | Platform Errors | API connectivity, resources, permissions |
| E300-E399 | Validation Errors | Schema validation, required fields, format errors |

#### Project Errors (E001-E099)

| Code | Message | Suggestion |
|------|---------|------------|
| E001 | Not in an EAI project | Run `eai init` to create a new project or navigate to an existing EAI project directory |
| E002 | `{var}` environment variable not set | Run `eai env pull` to sync configuration from the platform, or set `{var}` manually in .env.local |
| E003 | Configuration file not found: `{file}` | Ensure `{file}` exists in your project. Run `eai init` if this is a new project |
| E004 | Object Types file not found or invalid | Create src/eai.config/object-types.ts with your type definitions |
| E005 | Invalid project structure | Run `eai verify` to check your project setup |
| E006 | Failed to load configuration: `{details}` | Check your .env.local and eai.config.ts files for syntax errors |

#### Authentication Errors (E100-E199)

| Code | Message | Suggestion |
|------|---------|------------|
| E101 | Not logged in | Run `eai login` to authenticate with the platform |
| E102 | Access token expired | Run `eai login` to refresh your authentication |
| E103 | Invalid credentials | Verify your credentials and try `eai login` again |
| E104 | Authentication failed: `{details}` | Contact your administrator or try `eai login` again |

#### Platform Errors (E200-E299)

| Code | Message | Suggestion |
|------|---------|------------|
| E201 | Platform API unreachable: `{url}` | Check your network connection and verify BASE_URL_PUBLIC_API is correct |
| E202 | `{resource}` not found | Verify the `{resource}` ID or name and try again |
| E203 | Platform API error: `{details}` | Check the error details above. If the issue persists, contact support |
| E204 | Permission denied | You do not have permission to perform this action. Contact your administrator |
| E205 | Resource conflict: `{details}` | The resource already exists or conflicts with existing data |

#### Validation Errors (E300-E399)

| Code | Message | Suggestion |
|------|---------|------------|
| E301 | Invalid schema: `{details}` | Fix the schema errors listed above |
| E302 | Validation failed: `{details}` | Correct the validation errors and try again |
| E303 | Required field missing: `{field}` | Provide a value for `{field}` |
| E304 | Invalid format: `{details}` | Valid formats are: `{validFormats}` |
| E305 | Invalid input: `{details}` | Check your input and try again |

#### JSON Error Format

When using `--format json`, errors are returned in structured format:

```json
{
  "error": {
    "code": "E302",
    "message": "Validation failed: name must be PascalCase",
    "suggestion": "Correct the validation errors and try again",
    "exitCode": 1
  }
}
```

This format enables programmatic error handling in scripts and automation tools.
```

---

### 3. Command Reference Pages (UPDATE EACH)

**Files to update:** All 13 command files in `docs/src/content/docs/reference/commands/*.mdx`

**For EACH command, add Global Options section:**

```markdown
## Global Options

This command supports all [global CLI options](/reference/global-options/):
- `--describe` — Output CLI schema
- `--format <format>` — Control output format (text, json, yaml)
- `--simple` — Accessible plain text output
- `--no-color` — Disable colors
- `--color` — Force colors

See [Global Options](/reference/global-options/) for details.
```

**Commands to update:**
1. init.mdx
2. login.mdx
3. env.mdx
4. types.mdx
5. resources.mdx
6. tenant.mdx
7. chat.mdx
8. docs.mdx
9. deploy.mdx
10. verify.mdx
11. whoami.mdx
12. update.mdx
13. dev.mdx

---

### 4. Enhanced Help Documentation

**File to update:** `docs/src/content/docs/getting-started/quickstart.mdx`

**Add section showing enhanced help:**

```markdown
## CLI Help System

The EAI CLI provides comprehensive help at multiple levels:

### Top-Level Help

```bash
eai --help
```

Shows all available commands with examples grouped by workflow:
- Getting Started workflow
- Development Workflows
- Deployment workflow
- Machine-Readable Output examples
- Accessibility options

### Command Help

```bash
eai resources --help
eai resources list --help
```

Shows command-specific options and examples.

### Programmatic Help

For AI coding agents and automation:

```bash
eai --describe > cli-schema.json
```

Outputs complete JSON schema of CLI structure.
```

---

## Documentation Status by Feature

| Feature | Implementation | Documentation | Gap |
|---------|---------------|---------------|-----|
| `--format json` option | ✅ All 13 commands | ⚠️ Mentioned in resources.mdx only | Need to update all 13 command docs |
| `--describe` flag | ✅ Working | ❌ Not documented | **CREATE global-options.mdx** |
| `--simple` flag | ✅ Working | ❌ Not documented | **CREATE global-options.mdx** |
| `--no-color` / `--color` | ✅ Working | ❌ Not documented | **CREATE global-options.mdx** |
| Structured error codes | ✅ E001-E305 (19 codes) | ❌ Not documented | **UPDATE error-codes.mdx** |
| Enhanced help footer | ✅ Working | ⚠️ Partially mentioned | **UPDATE quickstart.mdx** |
| `eai update` command | ✅ Working | ✅ Documented | ✅ COMPLETE |

---

## Recommended Actions

### Priority 1 (Blocking for release)
1. **Create** `docs/src/content/docs/reference/global-options.mdx`
2. **Update** `docs/src/content/docs/reference/error-codes.mdx` with structured error code tables

### Priority 2 (Should have)
3. **Update** all 13 command reference pages to link to global-options
4. **Update** `docs/src/content/docs/getting-started/quickstart.mdx` with CLI help system section

### Priority 3 (Nice to have)
5. Add examples showing `--format json` in example pages (typescript.mdx, python.mdx, shell.mdx)
6. Add error handling examples using structured error codes

---

## Build and Deploy

After updating documentation:

```bash
# Build docs locally
cd docs
npm run build

# Preview locally
npm run preview

# Deploy (automatic via GitHub Actions on push to main)
git add docs/
git commit -m "docs: add CLI Help Enhancement documentation"
git push origin main
```

The docs workflow (`.github/workflows/docs.yml`) will automatically build and deploy to GitHub Pages.

---

## Current State

- **Implementation**: 186/186 tasks complete (100%)
- **Documentation**: 0/6 documentation tasks complete (0%)
- **GitHub Pages**: Live but missing new features
- **Last docs commit**: 21 hours ago (Phase 1-2, before feature completion)
