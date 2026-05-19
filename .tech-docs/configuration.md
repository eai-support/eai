---
generated: true
generated_at: "2026-05-19T18:18:09.974Z"
source_commit: "0efc50cec82087eead261426a4146d5ba45b902d"
---
# EAI CLI — Configuration

## Overview

The EAI CLI uses a **profile-based configuration system** for switching between platform environments (dev, test, prod) plus project configuration via environment variables. The CLI handles:

1. **Authentication** — Entra CIAM browser-based PKCE flow, stored per-profile in `~/.eai/tokens.json` or `~/.eai/tokens/{profile}.json`
2. **Profile selection** — `--profile` flag, `EAI_PROFILE` env var, or persisted active profile
3. **Tenant context** — Active tenant stored in `~/.eai/tenant-context.json`, selected via `eai tenant select`
4. **Project configuration** — Environment variables from `.env.local` for API endpoints and app identification
5. **Structured error codes** — E001-E399 error catalog for consistent error handling

---

## Profile System

### What are Profiles?

Profiles let developers switch between dev, test, and prod platform environments without changing configuration files. Each profile has its own API endpoint, Entra CIAM credentials, and token storage.

**Default behavior** (no `--profile` flag):
- Uses production (hardcoded in source)
- Tokens stored at `~/.eai/tokens.json`
- No config file needed

**Named profiles** (`--profile dev` or `--profile test`):
- Reads platform config from `~/.eai/config.json`
- Stores tokens at `~/.eai/tokens/{profile}.json`
- Completely isolated from other profiles

### Profile Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `publicApiUrl` | Yes | Platform API gateway URL (e.g., `https://dev-api.ae.myenterprise.ai/public`) |
| `authTenantName` | Yes | Entra CIAM tenant subdomain (before `.ciamlogin.com`) |
| `authTenantId` | Yes | Entra CIAM tenant GUID |
| `authClientId` | Yes | OAuth client ID for the CLI app registration (public client) |
| `authScope` | No | OAuth scope (default: `openid profile email offline_access`) |

### Profile Precedence

1. **`--profile <name>` flag** — Highest priority
2. **`EAI_PROFILE` environment variable**
3. **`activeProfile` in `~/.eai/config.json`** — Set automatically on login
4. **`default`** (production) — Lowest priority, no config file needed

---

## Token Storage

### Per-Profile Token Files

Tokens are encrypted and stored per-profile:

| Profile | Location | Format |
|---------|----------|--------|
| `default` (prod) | `~/.eai/tokens.json` | AES-256-CBC encrypted JSON |
| Named (e.g., `dev`) | `~/.eai/tokens/{profile}.json` | AES-256-CBC encrypted JSON |

### Security

- **Encryption**: AES-256-CBC with key derived from `sha256(eai-${homedir}-token-store)`
- **File mode**: `0o600` (owner read/write only)
- **Token lifecycle**: Auto-refreshed 5 minutes before expiry; manual refresh via `eai login`
- **Headless bypass**: `EAI_ACCESS_TOKEN` env var bypasses file storage for CI/CD pipelines

---

## Tenant Context

### Active Tenant Storage

The active tenant is stored in `~/.eai/tenant-context.json`:

```json
{
  "activeTenant": {
    "id": "tenant-123",
    "displayName": "Team A",
    "slug": "team-a",
    "isActive": true,
    "roles": ["tenant-admin", "tenant-staff"]
  },
  "membershipsCachedAt": 1683043200000
}
```

### Tenant Selection

```bash
# List available tenant-admin memberships
eai tenant list

# Select a tenant interactively
eai tenant select

# Or create a new tenant
eai tenant create --name "New Team" --parent <parent-tenant-id>
```

---

## Global Flags

| Flag | Purpose | Default |
|------|---------|---------|
| `--profile <name>` | Use named environment profile (dev, test) | Production (default) |
| `--simple` | Plain text output without colors/symbols (for screen readers) | Off |
| `--no-color` | Disable colored output | Auto-detect |
| `--color` | Force colored output | Auto-detect |
| `--describe` | Output JSON schema of all commands | Off |

---

## Environment Variables

### Core Configuration

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `BASE_URL_PUBLIC_API` | Yes | — | `https://api.eai.example.com` |
| `NEXT_PUBLIC_APP_NAME` | Yes | — | `my-vertical` |
| `EAI_ENV` | No | `dev` | `dev`, `staging`, `prod` |

### Optional Overrides

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `EAI_PROFILE` | No | — | `dev`, `test` |
| `EAI_ACCESS_TOKEN` | No | — | `eyJ0eXAiOiJKV1Qi...` |
| `NO_UPDATE_NOTIFIER` | No | — | `1` |
| `CI` | No (auto-detected) | — | `true` |

---

## Configuration Files

### 1. Project Config (`eai.config.ts` or `src/eai.config/object-types.ts`)

**Purpose**: Defines Object Types for the project.

**Location**:
- `src/eai.config/object-types.ts` (Vertical-Template convention)
- `eai.config/object-types.ts` (alternative)
- `eai.config.ts` (project root)

### 2. Environment File (`.env.local`)

**Purpose**: Store environment-specific configuration and secrets.

**Location**: Project root (`.env.local`)

**Format**: Dotenv syntax (key=value)

### 3. Profile Config (`~/.eai/config.json`)

**Purpose**: Store named profile configurations (dev, test) and active profile selection.

**Location**: `~/.eai/config.json`

### 4. Tenant Context Cache (`~/.eai/tenant-context.json`)

**Purpose**: Cache active tenant selection.

**Location**: `~/.eai/tenant-context.json`

### 5. Token Storage (`~/.eai/tokens.json` or `~/.eai/tokens/{profile}.json`)

**Purpose**: Encrypted authentication tokens per profile.

**Location**:
- Default profile: `~/.eai/tokens.json`
- Named profiles: `~/.eai/tokens/{profile}.json`

---

## Error Codes

The CLI uses structured error codes (E001-E399) for consistent error handling:

### E001-E099: Project Errors

| Code | Message | Suggestion |
|------|---------|-----------|
| E001 | Not in an EAI project | Run `eai init` or navigate to an EAI project |
| E002 | Environment variable not set | Set the missing variable in `.env.local` or environment |
| E003 | Configuration file not found | Ensure config file exists or run `eai init` |
| E004 | Object Types file not found | Create `src/eai.config/object-types.ts` |
| E005 | Invalid project structure | Run `eai verify` to check setup |
| E006 | Failed to load configuration | Check `.env.local` and `eai.config.ts` for syntax errors |

### E100-E199: Authentication Errors

| Code | Message | Suggestion |
|------|---------|-----------|
| E101 | Not logged in | Run `eai login` to authenticate |
| E102 | Access token expired | Run `eai login` to refresh |
| E103 | Invalid credentials | Verify credentials and try `eai login` again |
| E104 | Authentication failed | Contact administrator or try `eai login` again |

### E200-E299: Platform API Errors

| Code | Message | Suggestion |
|------|---------|-----------|
| E201 | Platform API unreachable | Check network and verify `BASE_URL_PUBLIC_API` |
| E202 | Resource not found | Verify resource ID and try again |
| E203 | Platform API error | Check error details; contact support if issue persists |
| E204 | Permission denied | Contact administrator for access |
| E205 | Resource conflict | Resource already exists or conflicts with existing data |

### E300-E399: Validation Errors

| Code | Message | Suggestion |
|------|---------|-----------|
| E301 | Invalid schema | Fix schema errors listed in output |
| E302 | Validation failed | Correct validation errors and try again |
| E303 | Required field missing | Provide a value for the missing field |
| E304 | Invalid format | Use one of the valid formats listed |
| E305 | Invalid input | Check input and try again |

---

## File Layout

### macOS / Linux

```
~/.eai/
  config.json              # Profile configurations (only if profiles are set up)
  tokens.json              # Default (prod) tokens
  tokens/
    dev.json               # Dev profile tokens
    test.json              # Test profile tokens
  tenant-context.json      # Active tenant selection
  update-check.json        # Update cache (not profile-scoped)
```

### Windows

```
%USERPROFILE%\.eai\
  config.json              # Profile configurations (only if profiles are set up)
  tokens.json              # Default (prod) tokens
  tokens\
    dev.json               # Dev profile tokens
    test.json              # Test profile tokens
  tenant-context.json      # Active tenant selection
  update-check.json        # Update cache (not profile-scoped)
```
