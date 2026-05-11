---
generated: true
generated_at: "2026-05-11T07:00:55.723Z"
source_commit: "9f23ff016bd3bf8d5a11f3bb3c2821f39d11a6ca"
---
# EAI CLI — Architecture

## System Context

The EAI CLI serves as the developer-facing gateway to the EAI Platform, abstracting away platform complexity behind simple command-line operations.

```mermaid
flowchart TB
    subgraph "Developer Environment"
        Dev[Developer]
        CLI[EAI CLI<br/>@eai-tools/cli]
        Browser[Web Browser]
        LocalFS[~/.eai/<br/>tokens.json<br/>config.json]
        ProjectFS[Project<br/>eai.config.ts<br/>.env.local]
    end
    
    subgraph "EAI Platform"
        Entra[Entra CIAM<br/>Authentication]
        PublicAPI[PublicAPI v3<br/>Resources, Types, Chat]
        AdminAPI[AdminAPI<br/>Tenant Bootstrap<br/>Entra Provisioning]
        ResourceAPI[ResourceAPI MID<br/>Multi-Tenant Queries]
    end
    
    subgraph "Azure Services"
        AppConfig[Azure App Config<br/>Environment Variables]
        KeyVault[Azure Key Vault<br/>Secrets]
        AppService[Azure App Service<br/>Deployment Target]
    end
    
    subgraph "GitHub"
        GHActions[GitHub Actions<br/>CI/CD Workflows]
        GHReleases[GitHub Releases<br/>Version Check]
        GHPages[GitHub Pages<br/>Static Registry]
    end
    
    Dev -->|eai commands| CLI
    CLI -->|PKCE Flow| Browser
    Browser -->|OAuth Callback| Entra
    Entra -->|Access Token| CLI
    CLI -->|Store Tokens| LocalFS
    CLI -->|Load Config| ProjectFS
    CLI -->|Bearer Token| PublicAPI
    CLI -->|Bearer Token| AdminAPI
    CLI -->|Bearer Token| ResourceAPI
    CLI -->|Pull Config| AppConfig
    CLI -->|Fetch Secrets| KeyVault
    CLI -->|Trigger Deploy| GHActions
    GHActions -->|Deploy| AppService
    CLI -->|Check Updates| GHReleases
    Dev -->|npm install| GHPages
```

## Runtime Flow: Typical User Session

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant CLI as EAI CLI
    participant Browser as Web Browser
    participant Entra as Entra CIAM
    participant Local as ~/.eai/
    participant API as Platform API
    participant Azure as Azure Services
    
    Dev->>CLI: eai login
    CLI->>Browser: Launch PKCE auth flow
    Browser->>Entra: Authorization request
    Entra->>Browser: Consent & authenticate
    Browser->>CLI: Callback with auth code
    CLI->>Entra: Exchange code for token
    Entra->>CLI: Access token + refresh token
    CLI->>Local: Store encrypted tokens
    
    Dev->>CLI: eai tenant select
    CLI->>API: GET /v3/tenants/memberships
    API->>CLI: Tenant list (tenant-admin only)
    CLI->>Local: Save active tenant ID
    
    Dev->>CLI: eai env pull --include-secrets
    CLI->>Azure: Fetch App Config + Key Vault
    Azure->>CLI: Environment variables & secrets
    CLI->>CLI: Write .env.local
    
    Dev->>CLI: eai types seed
    CLI->>CLI: Load src/eai.config/object-types.ts
    CLI->>API: POST /v3/object-types/validate
    API->>CLI: Validation results
    CLI->>API: POST /v3/object-types/seed
    API->>CLI: Seed confirmation
    
    Dev->>CLI: eai resources list User
    CLI->>API: GET /v3/resources?type=User
    API->>CLI: Resource list
    CLI->>Dev: Display formatted output
```

## Component Architecture

### Core Components

```mermaid
graph TB
    subgraph "Entry Point"
        Index[src/index.ts<br/>Commander Program]
    end
    
    subgraph "Command Layer (16 modules)"
        Init[init.ts<br/>Scaffold Projects]
        Auth[login.ts<br/>Authentication]
        Types[types.ts<br/>Object Type Management]
        Resources[resources.ts<br/>CRUD Operations]
        Tenant[tenant.ts<br/>Tenant Context]
        Deploy[deploy.ts<br/>Deployment]
        Chat[chat.ts<br/>AI Workflows]
        Docs[docs.ts<br/>Document Processing]
        Other[+ 8 more commands]
    end
    
    subgraph "Library Layer (16 modules)"
        API[api.ts<br/>HTTP Client]
        AuthLib[auth.ts<br/>Token Storage]
        Config[config.ts<br/>Config Loader]
        TenantCtx[tenant-context.ts<br/>Membership Lookup]
        Profile[profile.ts<br/>Environment Profiles]
        Errors[error-codes.ts<br/>Error Catalog]
        Output[output.ts<br/>UI Utilities]
        Utils[utils.ts<br/>Helpers]
    end
    
    subgraph "External Systems"
        Platform[EAI Platform API]
        FS[File System<br/>~/.eai/<br/>project/]
        Browser[Web Browser<br/>PKCE Flow]
    end
    
    Index --> Init
    Index --> Auth
    Index --> Types
    Index --> Resources
    Index --> Tenant
    Index --> Deploy
    Index --> Chat
    Index --> Docs
    Index --> Other
    
    Init --> API
    Auth --> AuthLib
    Types --> API
    Types --> Config
    Resources --> API
    Resources --> TenantCtx
    Tenant --> API
    Tenant --> TenantCtx
    Deploy --> API
    Chat --> API
    Docs --> API
    
    API --> Platform
    AuthLib --> FS
    AuthLib --> Browser
    Config --> FS
    TenantCtx --> API
    Profile --> FS
    Errors --> Output
```

### Command Layer (src/commands/)

| Module | Commands | Purpose |
|--------|----------|---------|
| **init.ts** | `init` | Scaffolds new vertical from template; installs Gofer AI assets |
| **dev.ts** | `dev` | Starts local dev server with connectivity checks |
| **login.ts** | `login`, `logout` | Entra CIAM authentication via browser PKCE flow |
| **whoami.ts** | `whoami` | Displays auth status, active tenant, profile |
| **user.ts** | `user invite`, `user provision-me` | User management (invite to tenant, self-provision) |
| **provision.ts** | `provision entra` | Creates/confirms Entra app registration in CIAM |
| **env.ts** | `env pull`, `env list`, `env push` | Azure App Config + Key Vault sync |
| **types.ts** | `types validate`, `types seed`, `types diff`, `types pull` | Object Type management |
| **resources.ts** | `resources list/get/create/update/delete`, `resources query`, `resources schema` | Resource CRUD operations |
| **tenant.ts** | `tenant list`, `tenant select`, `tenant info`, `tenant create` | Tenant context management |
| **vertical.ts** | `vertical info`, `vertical enroll`, `vertical unenroll` | Vertical enrollment operations |
| **chat.ts** | `chat send`, `chat stream` | AI chat workflows (sync/streaming) |
| **docs.ts** | `docs upload`, `docs classify`, `docs index` | Document operations (upload, classify, RAG indexing) |
| **deploy.ts** | `deploy setup`, `deploy trigger`, `deploy status` | GitHub Actions deployment orchestration |
| **verify.ts** | `verify`, `verify calls`, `doctor` | Platform connectivity checks and diagnostics |
| **update.ts** | `update` | CLI self-update from GitHub registry |

### Library Layer (src/lib/)

| Module | Exports | Purpose |
|--------|---------|---------|
| **api.ts** | `PlatformAPIClient` | HTTP client for PublicAPI, AdminAPI, ResourceAPI with Bearer token auth |
| **auth.ts** | `getToken`, `saveToken`, `clearToken`, `startAuthFlow` | Entra CIAM authentication and token storage in `~/.eai/tokens.json` |
| **config.ts** | `loadConfig` | Loads `.env.local`, evaluates `eai.config.ts` as JS, merges env vars |
| **tenant-context.ts** | `getActiveTenant`, `setActiveTenant`, `getTenantMemberships` | Tenant membership lookup and active tenant persistence |
| **profile.ts** | `setActiveProfile`, `getActiveProfile`, `loadProfile` | Environment profile management (dev, test, prod) |
| **context.ts** | `resolveCommandContext` | Command context resolver (project root, token, tenant, profile) |
| **error-codes.ts** | `ErrorCode`, `exitWithError`, `formatError` | Structured error catalog (E001-E399) with suggestions |
| **output.ts** | `success`, `error`, `warn`, `info`, `symbols` | Colored output utilities with TTY detection and simple mode |
| **utils.ts** | `toObjectTypeSlug`, `isRecord`, `sleep` | Helper functions for string manipulation, type guards, delays |
| **schema-builder.ts** | `describeProgram` | JSON schema generator for `--describe` flag (AI agent introspection) |
| **update-check.ts** | `checkForUpdate`, `notifyIfUpdateAvailable` | Static EAI registry integration for version checks |
| **gofer-installer.ts** | `installGoferAssets` | Copies Gofer AI terminal assets to new vertical projects |
| **object-type-defaults.ts** | `getObjectTypeDefaults` | Default field definitions for Object Type scaffolding |
| **cloud-env.ts** | `pullCloudEnv`, `pushCloudEnv` | Azure App Config + Key Vault integration |
| **azure-cli.ts** | `execAzureCLI` | Azure CLI command wrapper for cloud operations |
| **npm.ts** | `installDependencies`, `checkNpmVersion` | npm integration for package installation |

## Data Flow

### Authentication Flow

1. **User Initiates**: `eai login`
2. **CLI Generates**: PKCE code verifier + challenge
3. **CLI Launches**: Browser to Entra CIAM authorize endpoint
4. **User Authenticates**: In browser via CIAM
5. **Browser Redirects**: To `http://localhost:3000/callback` with auth code
6. **CLI Exchanges**: Auth code + verifier for tokens
7. **CLI Stores**: Encrypted tokens in `~/.eai/tokens.json`
8. **CLI Fetches**: User memberships from `/v3/tenants/memberships`
9. **CLI Persists**: Active tenant in `~/.eai/config.json`

### Object Type Seeding Flow

1. **CLI Loads**: `src/eai.config/object-types.ts` (TypeScript)
2. **CLI Strips**: Type annotations via regex
3. **CLI Evaluates**: As JavaScript to extract type definitions
4. **CLI Calls**: `POST /v3/object-types/validate` with payload
5. **Platform Validates**: Against schema rules
6. **CLI Calls**: `POST /v3/object-types/seed` if validation passes
7. **Platform Persists**: Types to registry
8. **CLI Polls**: `GET /v3/object-types/schema` until convergence

### Resource CRUD Flow

1. **CLI Resolves**: Active tenant from `~/.eai/config.json`
2. **CLI Validates**: Token from `~/.eai/tokens.json` (refreshes if expired)
3. **CLI Calls**: `GET /v3/resources?type=<Type>&tenant_id=<ID>`
4. **Platform Filters**: By tenant membership and RBAC
5. **CLI Formats**: Response as JSON, YAML, or colored text based on `--format`

## Trust Boundaries

### Authentication & Authorization

```mermaid
flowchart LR
    subgraph "Untrusted"
        Dev[Developer<br/>Local Machine]
    end
    
    subgraph "Trust Boundary 1: Entra CIAM"
        Entra[Entra CIAM<br/>OAuth 2.0 + PKCE]
    end
    
    subgraph "Trust Boundary 2: Platform API"
        API[Platform API<br/>Bearer Token Validation]
        RBAC[RBAC Engine<br/>Tenant Admin Check]
    end
    
    Dev -->|1. Browser PKCE Flow| Entra
    Entra -->|2. JWT Access Token| Dev
    Dev -->|3. Bearer Token| API
    API -->|4. Validate Token| RBAC
    RBAC -->|5. Authorize Request| API
```

**Security Controls**:
- **Entra CIAM**: OAuth 2.0 Authorization Code + PKCE flow (no client secret)
- **Token Storage**: Encrypted at rest in `~/.eai/tokens.json` (OS-level file permissions)
- **Token Expiry**: Auto-refresh tokens before expiration
- **Tenant Isolation**: Platform enforces tenant membership via RBAC
- **HTTPS Only**: All platform API calls over TLS 1.2+

## Design Patterns

### Command Pattern (Commander.js)

Each command is a self-contained module that registers with the Commander program:

```typescript
// src/commands/resources.ts
export const resourcesCommand = new Command('resources')
  .description('CRUD operations on platform resources')
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(updateCommand)
  .addCommand(deleteCommand);
```

### Centralized Error Handling

All errors route through `error-codes.ts` for consistent formatting:

```typescript
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

if (!token) {
  exitWithError(ErrorCode.E101, undefined, options.format);
}
```

### Context Resolver Pattern

`resolveCommandContext` aggregates project state, auth, and tenant context:

```typescript
const ctx = await resolveCommandContext({
  requireProject: true,
  requireAuth: true,
  requireTenant: true,
});
// ctx: { projectRoot, token, tenantId, profile }
```

### Lazy Evaluation (TypeScript Config)

Object Types are loaded from TypeScript files by stripping types and evaluating as JS:

```typescript
const tsCode = fs.readFileSync('src/eai.config/object-types.ts', 'utf-8');
const jsCode = stripTypeAnnotations(tsCode);
const module = { exports: {} };
new Function('module', 'exports', jsCode)(module, module.exports);
const types = module.exports.objectTypes;
```

### API Client Factory

`PlatformAPIClient` encapsulates auth, base URL, and error handling:

```typescript
const client = new PlatformAPIClient(token, baseUrl);
const response = await client.get('/v3/resources');
// Throws PlatformAPIRequestError on non-2xx
```

## Configuration Hierarchy

The CLI resolves configuration from multiple sources in priority order:

```mermaid
flowchart TB
    CLI[CLI Invocation]
    
    subgraph "Priority Order (High → Low)"
        Flags[1. CLI Flags<br/>--profile dev<br/>--format json]
        Env[2. Environment Variables<br/>EAI_PROFILE=dev<br/>NO_COLOR=1]
        Local[3. .env.local<br/>BASE_URL_PUBLIC_API=...]
        TSConfig[4. eai.config.ts<br/>export const config = ...]
        Persisted[5. ~/.eai/config.json<br/>activeProfile: 'dev']
        Defaults[6. Built-in Defaults<br/>format: 'text'<br/>profile: 'default']
    end
    
    CLI --> Flags
    Flags --> Env
    Env --> Local
    Local --> TSConfig
    TSConfig --> Persisted
    Persisted --> Defaults
```

## Module Dependencies

```mermaid
graph LR
    subgraph "Commands"
        CMD[Command Modules]
    end
    
    subgraph "Core Libraries"
        API[api.ts]
        Auth[auth.ts]
        Config[config.ts]
        Context[context.ts]
    end
    
    subgraph "Support Libraries"
        Errors[error-codes.ts]
        Output[output.ts]
        Utils[utils.ts]
    end
    
    subgraph "External Dependencies"
        Commander[Commander.js]
        Chalk[Chalk]
        Inquirer[Inquirer]
        Fetch[Node Fetch]
    end
    
    CMD --> Context
    Context --> API
    Context --> Auth
    Context --> Config
    API --> Auth
    API --> Errors
    API --> Fetch
    Auth --> Output
    Auth --> Errors
    Config --> Utils
    Errors --> Output
    Output --> Chalk
    CMD --> Commander
    CMD --> Inquirer
```

## Performance Characteristics

| Operation | Typical Duration | Notes |
|-----------|-----------------|-------|
| `eai login` | 5-15s | Browser launch + user interaction |
| `eai tenant select` | 0.5-2s | API call to fetch memberships |
| `eai types validate` | 0.2-1s | Local TypeScript evaluation + API validation |
| `eai types seed` | 1-5s | API seed call + polling for convergence |
| `eai resources list` | 0.5-3s | API call with pagination |
| `eai resources create` | 0.3-1s | Single API POST |
| `eai env pull` | 2-10s | Azure App Config + Key Vault queries |
| `eai deploy trigger` | 0.5-2s | GitHub Actions workflow dispatch |

**Caching**: 
- Token refresh is avoided if token TTL > 5 minutes
- Update checks cached for 24 hours in `~/.eai/update-check.json`
- Tenant memberships are not cached (always fetched fresh)

## Scalability Considerations

- **Stateless Design**: CLI maintains no persistent connections; all state in local files
- **Token Auto-Refresh**: Prevents auth errors during long-running operations
- **Pagination Support**: `eai resources list` supports `--limit` and `--skip` for large datasets
- **Streaming Output**: `eai chat stream` uses Server-Sent Events (SSE) for real-time responses
- **Profile Isolation**: Multiple profiles (dev, test, prod) enable parallel workflows

## Extensibility

### Adding a New Command

1. Create `src/commands/my-command.ts`
2. Define Commander `Command` with options and action handler
3. Import and register in `src/index.ts`
4. Add error codes to `src/lib/error-codes.ts` if needed
5. Write tests in `tests/commands/my-command.test.ts`

### Adding a New Library Module

1. Create `src/lib/my-module.ts`
2. Export typed functions with JSDoc comments
3. Import in command modules as needed
4. Add unit tests in `tests/lib/my-module.test.ts`

### Adding a New Error Code

1. Add enum value to `ErrorCode` in `src/lib/error-codes.ts`
2. Add entry to `errorCatalog` with message and suggestion
3. Use `exitWithError(ErrorCode.EXXX, context, format)` in commands
