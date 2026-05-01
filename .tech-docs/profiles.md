---
generated: "2026-05-01T02:21:45Z"
source_commit: "999edb65571e8a03e2373b37ae3563843616a382"
---

# Environment Profiles

Profiles let you switch between dev, test, and prod environments without changing environment variables or `.env.local` files. This is an internal feature — customers use the default profile (production) and never see the profile system.

## How It Works

- **No `--profile` flag** = default profile = production. Same behavior as before profiles existed. No config file needed.
- **`--profile dev`** = reads the profile config file (`~/.eai/config.json` on macOS/Linux, `%USERPROFILE%\.eai\config.json` on Windows) for auth and API config, and stores tokens in the matching profile token file (`~/.eai/tokens/dev.json` or `%USERPROFILE%\.eai\tokens\dev.json`).

Profiles are completely isolated — logging into dev does not affect your prod session.

## Setup

Create the profile config file with one or more named profiles:

| OS            | Config file path                  |
| ------------- | --------------------------------- |
| macOS / Linux | `~/.eai/config.json`              |
| Windows       | `%USERPROFILE%\.eai\config.json`  |

Notes:

- On macOS, `~` usually expands to `/Users/<your-username>`.
- On Windows, `%USERPROFILE%` usually expands to `C:\Users\<your-username>`.
- Create the `.eai` directory first if it does not already exist.

Then add:

```json
{
  "profiles": {
    "dev": {
      "publicApiUrl": "https://dev-api.ae.myenterprise.ai/public",
      "authTenantName": "eaidevmyentepriseai",
      "authTenantId": "50808ce0-f31b-4fd0-9861-74b83b8c112a",
      "authClientId": "c3c10ee2-aeeb-4a64-8eea-5ca43a3252af",
      "authScope": "openid profile email offline_access"
    },
    "test": {
      "publicApiUrl": "https://test-api.ae.myenterprise.ai/public",
      "authTenantName": "enterpriseaitestplatform",
      "authTenantId": "dffacd2b-7705-43f2-86ae-75d1ef003a71",
      "authClientId": "861ad00a-aba1-47e4-baf2-3e3f6ef4a69e",
      "authScope": "openid profile email offline_access api://97f59e40-0d86-4c6d-8ac6-80659fea1a4e/access_token"
    }
  }
}
```

Production values are hardcoded in the CLI source (`src/commands/login.ts` and `src/lib/tenant-context.ts`).
No profile is needed for prod — `eai login` works out of the box.

`eai provision entra` follows the same model. Default/no profile routes to the production platform API and the production CIAM selected by that deployment. `--profile test` and `--profile dev` route to their configured platform APIs, and those services choose the matching test or dev CIAM from deployment configuration. Do not add a CLI request field for CIAM or environment selection.

### Required Fields

| Field            | Description                                                  | Where to find it                                                     |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `publicApiUrl`   | Platform API gateway URL for the environment                 | Azure Portal → App Service or API Management                         |
| `authTenantName` | Entra CIAM tenant subdomain (before `.ciamlogin.com`)        | Entra admin center → Tenant overview                                 |
| `authTenantId`   | Entra CIAM tenant GUID                                       | Entra admin center → Tenant overview → Tenant ID                     |
| `authClientId`   | OAuth client ID for the CLI app registration (public client) | Entra admin center → App registrations → "EAI CLI - Developer Tools" |

### Optional Fields

| Field       | Default                               |
| ----------- | ------------------------------------- |
| `authScope` | `openid profile email offline_access` |

For environments where the CLI calls PublicAPI directly, set `authScope` to include that environment's Public API scope. For the current test tenant:

```json
"authScope": "openid profile email offline_access api://97f59e40-0d86-4c6d-8ac6-80659fea1a4e/access_token"
```

## Usage

Logging in with a profile makes it the active profile for all subsequent commands:

```bash
# Login to dev — sets "dev" as the active profile
eai --profile dev login

# These now use dev automatically (no --profile needed)
eai whoami
eai resources list User
eai tenant list

# Switch to test — sets "test" as the active profile
eai --profile test login

# These now use test
eai whoami
eai resources list User

# Switch back to prod
eai login

# Back to prod (default)
eai whoami
```

You can also override the active profile for a single command without changing it:

```bash
# Active profile is dev, but run this one command against test
eai --profile test resources list User

# Still on dev for everything else
eai whoami    # → dev
```

## EAI_PROFILE Environment Variable

Set `EAI_PROFILE` in your shell to avoid typing `--profile` on every command:

```bash
# For a session
export EAI_PROFILE=dev
eai login
eai whoami
eai resources list User

# Or per-command
EAI_PROFILE=dev eai whoami
```

The `--profile` flag takes precedence over `EAI_PROFILE`.

## Precedence

Profile resolution order (highest to lowest):

1. `--profile <name>` flag
2. `EAI_PROFILE` environment variable
3. `activeProfile` in the profile config file (`~/.eai/config.json` on macOS/Linux, `%USERPROFILE%\.eai\config.json` on Windows), set automatically on login
4. `default` (production — no config file, uses the default token cache: `~/.eai/tokens.json` on macOS/Linux or `%USERPROFILE%\.eai\tokens.json` on Windows)

## File Layout

macOS / Linux:

```
~/.eai/
  config.json           # Profile configurations (only if profiles are set up)
  tokens.json           # Default (prod) tokens (unchanged from before)
  tokens/
    dev.json            # Dev profile tokens
    test.json           # Test profile tokens
  update-check.json     # Update cache (not profile-scoped)
```

Windows:

```
%USERPROFILE%\.eai\
  config.json           # Profile configurations (only if profiles are set up)
  tokens.json           # Default (prod) tokens (unchanged from before)
  tokens\
    dev.json            # Dev profile tokens
    test.json           # Test profile tokens
  update-check.json     # Update cache (not profile-scoped)
```

## Deprecated: EAI_CIAM_* Environment Variables

Previously, auth config was set via environment variables:

```bash
# DEPRECATED — use profiles instead
export EAI_CIAM_TENANT_NAME=myorg
export EAI_CIAM_TENANT_ID=12345678-...
export EAI_CIAM_CLIENT_ID=87654321-...
```

These still work as a fallback for the default profile but will show a deprecation warning. Move to profiles for a cleaner setup.

## CI/Headless Usage

The `EAI_ACCESS_TOKEN` environment variable bypass is unchanged. Profiles are for interactive developer use. CI pipelines should continue using `EAI_ACCESS_TOKEN`:

```bash
export EAI_ACCESS_TOKEN=<bearer-token>
eai resources list User   # Works without login, no profile needed
```
