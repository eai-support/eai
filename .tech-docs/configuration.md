---
generated: "2026-03-11T18:45:00Z"
source_commit: "584ed1afb8257ec89c81a6e0515007e9491fa008"
---

# EAI CLI — Configuration

## Overview

The EAI CLI uses environment variables for configuration, primarily loaded from `.env.local` in the project root. Configuration is required for:

1. **Platform API connection**
2. **Entra CIAM authentication**
3. **Tenant and workflow identification**
4. **Feature flags and overrides**

---

## Environment Variables

### Core Configuration

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `BASE_URL_PUBLIC_API` | Platform API base URL | Yes | — | `https://api.eai.example.com` |
| `NEXT_PUBLIC_APP_NAME` | Application name | Yes | — | `my-vertical` |
| `EAI_ENV` | Environment name | No | `dev` | `dev`, `staging`, `prod` |

### Tenant Configuration

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `TENANT_DEFAULT_ID` | Default tenant ID | Yes* | — | `12345678-1234-1234-1234-123456789abc` |
| `TENANT_{APP}_ID` | App-specific tenant ID | Yes* | — | `TENANT_MYVERTICAL_ID=tenant-123` |

*One tenant ID is required (either default or app-specific)

**Tenant ID Resolution**:
1. Check `TENANT_{APP_NAME}_ID` (normalized to uppercase)
2. Fallback to `TENANT_DEFAULT_ID`
3. Error if neither is set

### Workflow Configuration

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `WORKFLOW_DEFAULT_ID` | Default workflow ID | No | — | `wf-12345` |
| `WORKFLOW_{APP}_ID` | App-specific workflow ID | No | — | `WORKFLOW_MYVERTICAL_ID=wf-67890` |

### Entra CIAM Authentication

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `ENTRA_TENANT_NAME` | Entra tenant subdomain | Yes | — | `eaiplatform` |
| `ENTRA_TENANT_ID` | Entra tenant ID (GUID) | Yes | — | `87654321-4321-4321-4321-abcdef123456` |
| `ENTRA_CLIENT_ID` | Entra application client ID | Yes | — | `abcdef12-3456-7890-abcd-ef1234567890` |

**Authority URL**: Constructed as `https://{ENTRA_TENANT_NAME}.ciamlogin.com/{ENTRA_TENANT_ID}`

### Azure App Config & Key Vault (for `eai env pull`)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `AZURE_APP_CONFIG_CONNECTION_STRING` | Azure App Config connection | Yes (for env commands) | — | `Endpoint=https://...` |
| `AZURE_KEY_VAULT_NAME` | Key Vault name | Yes (for secrets) | — | `my-key-vault` |

### Optional Overrides

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `EAI_ACCESS_TOKEN` | Override stored token (for CI/headless) | No | — | `eyJ0eXAiOiJKV1Qi...` |
| `NO_UPDATE_NOTIFIER` | Disable update checks | No | — | `1` |
| `CI` | Detected CI environment (auto-disables update check) | No | — | `true` |

---

## Configuration Files

### 1. Project Config (`eai.config.ts` or `src/eai.config/object-types.ts`)

**Purpose**: Defines Object Types for the project.

**Location**:
- `src/eai.config/object-types.ts` (Vertical-Template convention)
- `eai.config/object-types.ts` (alternative)
- `eai.config.ts` (project root)

**Format**: TypeScript module exporting `objectTypes` object

**Example**:
```typescript
import type { ObjectTypeDefinition } from '@eai-tools/core';

export const objectTypes: Record<string, ObjectTypeDefinition[]> = {
  'default': [
    {
      name: 'Task',
      displayName: 'Task',
      description: 'A work item to be completed',
      properties: [
        {
          name: 'title',
          type: 'text',
          required: true,
          indexed: true,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: [
            { label: 'Todo', value: 'todo' },
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
          ],
          defaultValue: 'todo',
        },
      ],
      linkTypes: [],
      actions: [],
      status: 'published',
    },
  ],
};
```

**Loading**:
- CLI walks up directory tree to find project root
- Reads TypeScript file
- Strips type annotations (interfaces, type aliases, etc.)
- Evaluates as JavaScript via Node's `import()`
- Extracts `objectTypes` export

### 2. Environment File (`.env.local`)

**Purpose**: Store environment-specific configuration and secrets.

**Location**: Project root (`.env.local`)

**Format**: Dotenv syntax (key=value)

**Example**:
```bash
# Platform API
BASE_URL_PUBLIC_API=https://api.eai.example.com

# App Identity
NEXT_PUBLIC_APP_NAME=my-vertical
EAI_ENV=dev

# Tenant
TENANT_DEFAULT_ID=12345678-1234-1234-1234-123456789abc
TENANT_MYVERTICAL_ID=tenant-123

# Workflow
WORKFLOW_DEFAULT_ID=wf-12345

# Entra CIAM
ENTRA_TENANT_NAME=eaiplatform
ENTRA_TENANT_ID=87654321-4321-4321-4321-abcdef123456
ENTRA_CLIENT_ID=abcdef12-3456-7890-abcd-ef1234567890

# Azure Services
AZURE_APP_CONFIG_CONNECTION_STRING=Endpoint=https://myappconfig.azconfig.io;Id=xxx;Secret=yyy
AZURE_KEY_VAULT_NAME=my-key-vault

# Optional
NO_UPDATE_NOTIFIER=0
```

**Loading**:
- Parsed by `loadEnvFile()` in `src/lib/config.ts`
- Supports `#` comments
- Strips quotes from values (`"value"` → `value`)
- Merged with `process.env` (process.env takes precedence)

**Commands**:
- `eai env pull` — Syncs from Azure App Config + Key Vault to `.env.local`
- `eai env list` — Displays current environment variables
- `eai env push` — Pushes local overrides to cloud (admin only)

### 3. Token Storage (`~/.eai/tokens.json`)

**Purpose**: Encrypted authentication tokens.

**Location**: `~/.eai/tokens.json`

**Format**: AES-256-CBC encrypted JSON

**Managed By**: `src/lib/auth.ts`

**Commands**:
- `eai login` — Creates token file
- `eai logout` — Deletes token file
- `eai whoami` — Displays token info (UPN, tenant, expiry)

### 4. Update Cache (`~/.eai/update-check.json`)

**Purpose**: Cache latest version to avoid excessive registry checks.

**Location**: `~/.eai/update-check.json`

**Format**: Plaintext JSON

**Managed By**: `src/lib/update-check.ts`

**TTL**: 24 hours

---

## Configuration Resolution Order

### Environment Variable Precedence

1. **Process environment** (`process.env`) — Highest priority
2. **`.env.local` file** — Project-specific overrides
3. **Default values** — Built-in defaults (e.g., `EAI_ENV=dev`)

### Example

Given:
- `.env.local`: `BASE_URL_PUBLIC_API=https://dev-api.example.com`
- `process.env`: `BASE_URL_PUBLIC_API=https://prod-api.example.com`

Result: `https://prod-api.example.com` (process.env wins)

### Tenant ID Resolution

Given:
- `NEXT_PUBLIC_APP_NAME=my-vertical`
- `.env.local`:
  ```
  TENANT_DEFAULT_ID=default-tenant-123
  TENANT_MYVERTICAL_ID=myvertical-tenant-456
  ```

Resolution:
1. Normalize app name: `my-vertical` → `MYVERTICAL`
2. Check `TENANT_MYVERTICAL_ID`: ✅ Found → `myvertical-tenant-456`

---

## Feature Flags

### Update Notifications

**Controlled By**:
- `NO_UPDATE_NOTIFIER=1` — Disable update checks
- `CI=true` — Auto-detected in CI environments

**Behavior**:
- When enabled: Background check on CLI start, banner after command execution
- When disabled: No network calls to registry

### Headless Authentication

**Controlled By**: `EAI_ACCESS_TOKEN`

**Use Case**: CI/CD pipelines, server environments

**Example**:
```bash
export EAI_ACCESS_TOKEN="eyJ0eXAiOiJKV1Qi..."
eai types seed
eai resources list Task
```

**Behavior**:
- Bypasses `~/.eai/tokens.json` storage
- No token refresh (assumes long-lived token or external refresh)
- Skips device code flow

---

## Project Discovery

The CLI discovers the project root by walking up the directory tree from `cwd`, looking for:

1. `eai.config.ts` at project root
2. `src/eai.config/object-types.ts` (Vertical-Template convention)
3. `package.json` with `@eai-tools/platform-sdk` or `@eai-tools/core` dependency

**Commands Requiring Project Context**:
- `eai types validate/seed/diff/pull`
- `eai resources *`
- `eai env pull/list/push`
- `eai dev`
- `eai deploy *`

**Commands NOT Requiring Project**:
- `eai login/logout/whoami`
- `eai init <name>` (creates new project)
- `eai update`
- `eai --version`, `eai --help`

---

## Required Secrets

The CLI itself does not manage secrets. Secrets are expected to be stored in:

1. **Azure Key Vault** — Fetched via `eai env pull --include-secrets`
2. **GitHub Secrets** — For deployment workflows (configured via `eai deploy setup`)

### GitHub Secrets (for Deployment)

| Secret | Description | Set By |
|--------|-------------|--------|
| `AZUREAPPSERVICE_CLIENTID` | Azure AD app client ID | `gh secret set` or GitHub UI |
| `AZUREAPPSERVICE_TENANTID` | Azure AD tenant ID | `gh secret set` or GitHub UI |
| `AZUREAPPSERVICE_SUBSCRIPTIONID` | Azure subscription ID | `gh secret set` or GitHub UI |
| `AZURE_RESOURCE_GROUP` | Resource group name | `gh secret set` or GitHub UI |
| `AZURE_WEBAPP_NAME` | App Service name | `gh secret set` or GitHub UI |

**Command**: `eai deploy setup --repo org/name` provides instructions for setting these.

---

## Configuration Validation

### Type Validation (`eai types validate`)

Validates Object Types against platform schema rules:

- Name format: PascalCase (`^[A-Z][a-zA-Z0-9]*$`)
- Unique property names
- Valid property types (one of 8 supported)
- Select properties have options
- Link targets are valid Object Types
- Action roles are valid (`tenant-user`, `tenant-staff`, `tenant-admin`)
- Side effect types are valid (`set_field`, `set_timestamp`, `set_user`)

**Exit Codes**:
- `0` — All types valid
- `1` — Validation errors found

### Connectivity Validation (`eai verify`)

Checks platform connectivity:

- Platform API reachable
- Authentication valid
- Tenant accessible
- Required services available

### Comprehensive Diagnostics (`eai doctor`)

Runs full diagnostic suite with fix suggestions:

- Environment variables set
- Authentication status
- Platform API connectivity
- Project configuration valid
- Object Types loadable
- Azure services reachable (if configured)

---

## Example Configurations

### Development Environment

```bash
# .env.local
BASE_URL_PUBLIC_API=https://dev-api.eai.example.com
NEXT_PUBLIC_APP_NAME=my-vertical
EAI_ENV=dev
TENANT_DEFAULT_ID=dev-tenant-123
WORKFLOW_DEFAULT_ID=dev-workflow-456
ENTRA_TENANT_NAME=eaiplatform-dev
ENTRA_TENANT_ID=dev-entra-tenant-id
ENTRA_CLIENT_ID=dev-client-id
```

### Production Environment

```bash
# .env.local
BASE_URL_PUBLIC_API=https://api.eai.example.com
NEXT_PUBLIC_APP_NAME=my-vertical
EAI_ENV=prod
TENANT_DEFAULT_ID=prod-tenant-789
WORKFLOW_DEFAULT_ID=prod-workflow-abc
ENTRA_TENANT_NAME=eaiplatform
ENTRA_TENANT_ID=prod-entra-tenant-id
ENTRA_CLIENT_ID=prod-client-id
AZURE_APP_CONFIG_CONNECTION_STRING=Endpoint=https://prod-config.azconfig.io;...
AZURE_KEY_VAULT_NAME=prod-key-vault
```

### CI/CD Environment

```bash
# GitHub Actions / Azure DevOps
export EAI_ACCESS_TOKEN="${{ secrets.EAI_ACCESS_TOKEN }}"
export BASE_URL_PUBLIC_API="${{ secrets.PLATFORM_API_URL }}"
export TENANT_DEFAULT_ID="${{ secrets.TENANT_ID }}"
export NO_UPDATE_NOTIFIER=1
export CI=true

eai types validate
eai types seed --dry-run
```

---

## Troubleshooting

### "Not in an EAI project"

**Cause**: CLI cannot find project root (no `eai.config.ts` or `src/eai.config/object-types.ts`)

**Fix**:
1. Ensure you're in project directory
2. Check for config files: `ls src/eai.config/object-types.ts`
3. Or initialize new project: `eai init <name>`

### "Missing BASE_URL_PUBLIC_API or tenant ID"

**Cause**: Required environment variables not set

**Fix**:
1. Run `eai env pull` to sync from Azure
2. Or manually add to `.env.local`:
   ```bash
   BASE_URL_PUBLIC_API=https://api.eai.example.com
   TENANT_DEFAULT_ID=your-tenant-id
   ```

### "Unauthorized" (401)

**Cause**: Token expired or invalid

**Fix**:
1. Re-login: `eai logout && eai login`
2. Check token: `eai whoami`
3. Verify Entra config in `.env.local`

### "Failed to load Object Types"

**Cause**: TypeScript syntax error in `object-types.ts`

**Fix**:
1. Check for syntax errors (missing commas, brackets)
2. Run `eai types validate` for detailed error messages
3. Ensure `objectTypes` export is present:
   ```typescript
   export const objectTypes: Record<string, ObjectTypeDefinition[]> = { ... };
   ```
