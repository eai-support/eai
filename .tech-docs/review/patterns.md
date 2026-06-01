---
generated: true
generated_at: "2026-05-23T18:05:52.673Z"
source_commit: "3f2653e8e0c12fcd8b9be770d495dbf8269079f1"
---
# EAI CLI — Patterns & Tech Debt

## Overview

This document identifies design patterns, anti-patterns, and technical debt in the EAI CLI codebase (v2.8.13). It includes alignment notes between `.specify/` specs and implementation.

---

## Design Patterns

### 1. Command Pattern ✅

**Location**: `src/commands/*.ts`

**Implementation**: Each command is a self-contained Commander.js `Command` instance exported from its own module.

**Example**:
```typescript
// src/commands/resources.ts
export const resourcesCommand = new Command('resources')
  .description('CRUD operations on platform resources');

resourcesCommand
  .command('list <type>')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (type, options) => {
    // Command implementation
  });
```

**Benefits**:
- Easy to add new commands (just create new file + register in `index.ts`)
- Clear separation of command logic
- Testable in isolation
- Self-documenting help text

**File References**:
- `src/commands/init.ts`, `login.ts`, `tenant.ts`, `types.ts`, `resources.ts`, `chat.ts`, `docs.ts`, `deploy.ts`, `verify.ts`, `gofer.ts`, `template.ts`, `blocks.ts`, `vertical.ts`, `workflow.ts`, `user.ts`, `provision.ts`, `whoami.ts`, `update.ts`, `env.ts`, `dev.ts`
- 20 command modules total

---

### 2. Facade Pattern ✅

**Location**: `src/lib/api.ts`

**Implementation**: `PlatformAPIClient` class wraps native `fetch()` with typed methods, hiding HTTP complexity from commands.

**Example**:
```typescript
class PlatformAPIClient {
  async get(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new APIError(response);
    return response.json();
  }
}
```

**Benefits**:
- Isolates HTTP concerns from command logic
- Centralized error handling
- Easy to mock for testing
- Single source of truth for API interactions

**File References**:
- `src/lib/api.ts:1-200+`

---

### 3. Strategy Pattern ✅

**Location**: `src/lib/output.ts`, `src/lib/config.ts`

**Implementation**:

1. **Output Formatting Strategy**: Different output strategies based on `--format` flag:
   ```typescript
   if (options.format === 'json') {
     console.log(JSON.stringify(data, null, 2));
   } else if (options.format === 'yaml') {
     console.log(yaml.stringify(data));
   } else {
     // Text format with colors and symbols
     success(`Found ${data.length} items`);
   }
   ```

2. **Project Discovery Strategy**: Multiple strategies to find project root:
   ```typescript
   // Strategy 1: Look for eai.config.ts
   // Strategy 2: Look for src/eai.config/object-types.ts
   // Strategy 3: Look for package.json with EAI deps
   ```

**Benefits**:
- Flexible output formatting for different consumers (humans, scripts, AI agents)
- Supports multiple project structures (Application Template, custom)

**File References**:
- `src/lib/output.ts:50-150`
- `src/lib/config.ts:30-80`

---

### 4. Builder Pattern ✅

**Location**: `src/lib/schema-builder.ts`

**Implementation**: Constructs JSON schema from Commander.js program structure for `--describe` flag.

**Example**:
```typescript
function describeProgram(program: Command): CommandSchema {
  return {
    name: program.name(),
    description: program.description(),
    commands: program.commands.map(describeCommand),
    options: program.options.map(describeOption),
  };
}
```

**Benefits**:
- AI agents can discover CLI capabilities at runtime
- Self-documenting API for automation tools
- Consistent schema format

**File References**:
- `src/lib/schema-builder.ts:1-300+`

---

### 5. Repository Pattern ✅

**Location**: `src/lib/auth.ts`, `src/lib/tenant-context.ts`

**Implementation**: Abstracts storage of tokens and tenant context behind typed interfaces.

**Example**:
```typescript
// Token repository
export async function saveToken(tokens: StoredTokens): Promise<void> {
  // Abstract file storage
  await fs.writeFile(getTokenPath(), JSON.stringify(tokens), { mode: 0o600 });
}

export async function getToken(): Promise<StoredTokens | null> {
  // Abstract file retrieval
  const data = await fs.readFile(getTokenPath(), 'utf-8');
  return JSON.parse(data);
}
```

**Benefits**:
- Separates storage mechanism from business logic
- Easy to swap storage (e.g., keychain, encrypted store)
- Testable with mock storage

**File References**:
- `src/lib/auth.ts:100-200`
- `src/lib/tenant-context.ts:50-150`

---

### 6. Template Method Pattern ✅

**Location**: All command handlers

**Implementation**: Every command follows the same execution template:

```typescript
async function commandAction(options) {
  // Step 1: Parse and validate options
  validateOptions(options);
  
  // Step 2: Load configuration and context
  const config = await loadConfig();
  const token = await getToken();
  
  // Step 3: Authenticate if needed
  if (!token) exitWithError(ErrorCode.E101);
  
  // Step 4: Execute operation
  const result = await performOperation(token, config, options);
  
  // Step 5: Format and output result
  formatOutput(result, options.format);
}
```

**Benefits**:
- Consistent command structure
- Predictable error handling
- Easy to reason about control flow

**File References**:
- All `src/commands/*.ts` files

---

### 7. Singleton Pattern ✅ (Implicit)

**Location**: `src/lib/config.ts`, `src/lib/context.ts`

**Implementation**: Configuration and context loaded once per command execution and cached in module scope.

**Example**:
```typescript
let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await loadFromDisk();
  return cachedConfig;
}
```

**Benefits**:
- Avoids redundant file reads
- Consistent config across command execution

**File References**:
- `src/lib/config.ts:20-50`
- `src/lib/context.ts:15-40`

---

## Anti-Patterns

### 1. God Module ⚠️

**Location**: `src/lib/api.ts`

**Issue**: `PlatformAPIClient` has grown to ~600 lines with methods for every API endpoint.

**Recommendation**: Split into domain-specific clients:
```typescript
// src/lib/api/resources-client.ts
export class ResourcesClient { /* resource methods */ }

// src/lib/api/tenants-client.ts
export class TenantsClient { /* tenant methods */ }

// src/lib/api/ai-client.ts
export class AIClient { /* AI workflow methods */ }

// src/lib/api/index.ts
export function createAPIClients(token: string) {
  return {
    resources: new ResourcesClient(token),
    tenants: new TenantsClient(token),
    ai: new AIClient(token),
  };
}
```

**Impact**: Medium — Reduces maintainability as API surface grows

---

### 2. Feature Envy ⚠️

**Location**: `src/commands/tenant.ts` (tenant create)

**Issue**: `tenant create` command handler reaches into tenant context internals to validate membership.

**Current**:
```typescript
// tenant.ts reaching into context internals
const memberships = await loadMemberships();
const isMember = memberships.some(m => m.roles.includes('tenant-admin'));
```

**Better**:
```typescript
// Delegate to tenant-context module
const hasAccess = await tenantContext.hasRole(tenantId, 'tenant-admin');
```

**Impact**: Low — Minor coupling issue

---

### 3. Magic Strings 🔴

**Location**: Throughout codebase

**Issue**: String literals repeated across files:

```typescript
// Repeated in multiple files
'~/.eai/tokens.json'
'~/.eai/context.json'
'.eai-manifest.json'
'BASE_URL_PUBLIC_API'
'tenant-admin'
'E101'
```

**Recommendation**: Centralize in constants:
```typescript
// src/lib/constants.ts
export const EAI_HOME = path.join(os.homedir(), '.eai');
export const TOKENS_FILE = path.join(EAI_HOME, 'tokens.json');
export const CONTEXT_FILE = path.join(EAI_HOME, 'context.json');
export const MANIFEST_FILE = '.eai-manifest.json';
export const ROLE_TENANT_ADMIN = 'tenant-admin';
```

**Impact**: Medium — Affects maintainability and refactoring safety

---

### 4. Boolean Trap ⚠️

**Location**: `src/lib/gofer-refresh.ts`

**Issue**: Boolean flags with unclear meaning:

```typescript
function applyRefresh(manifest, files, force, createBackups) {
  // What does force mean? What does createBackups do?
}
```

**Better**:
```typescript
interface RefreshOptions {
  overwriteModified: boolean;
  backupReplacedFiles: boolean;
}

function applyRefresh(manifest, files, options: RefreshOptions) { }
```

**Impact**: Low — Reduces API clarity

---

## Technical Debt

### High Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **Input path validation missing** | High | `src/commands/docs.ts`, `types.ts` | Validate user file paths are within project directory | Small |
| **Token refresh race condition** | High | `src/lib/auth.ts` | Add file locking or mutex to prevent concurrent refreshes | Medium |
| **Magic numbers throughout** | Medium | All files | Extract to named constants | Small |
| **God module in API client** | Medium | `src/lib/api.ts` | Split into domain-specific clients | Large |

### Medium Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **No retry logic for network errors** | Medium | `src/lib/api.ts` | Add exponential backoff for 5xx errors | Medium |
| **Long command handlers** | Medium | `src/commands/types.ts`, `tenant.ts`, `resources.ts` | Extract helper functions | Medium |
| **Magic strings** | Medium | All files | Centralize in constants file | Small |
| **Feature envy in tenant commands** | Low | `src/commands/tenant.ts` | Delegate to context modules | Small |

### Low Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **Boolean trap in gofer-refresh** | Low | `src/lib/gofer-refresh.ts` | Use options object instead of boolean flags | Small |
| **No parallel API calls** | Low | All commands | Use `Promise.all()` for independent requests | Medium |
| **No request deduplication** | Low | All commands | Add short-lived in-memory cache | Medium |

---

## Spec Alignment

Comparison of `.specify/specs/` against implementation:

### 901-cli-platform-alignment ✅

**Spec**: Align CLI with platform API v4  
**Status**: **Aligned**

**Evidence**:
- All commands use `/v4/` endpoints
- Bearer token authentication implemented
- Tenant-scoped operations via `--tenant-id` or active context
- Resource CRUD matches platform API contracts
- AI workflow status checks implemented

**Remaining Work**: None (spec complete)

---

### CLI Consolidation ✅ (Archived)

**Spec**: Consolidate scattered CLI utilities into single `eai` binary  
**Status**: **Complete** (archived)

**Evidence**:
- Single `eai` binary with 20 command groups
- No scattered scripts or separate executables
- Commander.js provides unified command structure

---

### Static npm Registry ✅ (Archived)

**Spec**: Self-hosted npm registry on GitHub Pages  
**Status**: **Complete** (archived)

**Evidence**:
- Registry live at `https://eai-tools.github.io/eai/registry`
- Packument and tarballs served correctly
- Installation works with scoped registry configuration
- `eai update` uses GitHub Releases API

---

## Code Smells Summary

| Smell | Count | Severity | Files Affected |
|-------|-------|----------|----------------|
| Magic Numbers | ~15 | Medium | api.ts, auth.ts, update-check.ts, login.ts |
| Magic Strings | ~30 | Medium | All command files, auth.ts, context.ts |
| Long Functions | ~8 | Low | types.ts, tenant.ts, resources.ts, gofer-refresh.ts |
| God Module | 1 | Medium | api.ts |
| Feature Envy | ~3 | Low | tenant.ts, resources.ts |
| Boolean Trap | ~2 | Low | gofer-refresh.ts, verify.ts |

---

## Refactoring Opportunities

### 1. Extract API Domain Clients (Medium Effort, High Value)

Split `src/lib/api.ts` into:
- `src/lib/api/base-client.ts` — Common fetch logic
- `src/lib/api/resources.ts` — Resource CRUD
- `src/lib/api/tenants.ts` — Tenant management
- `src/lib/api/ai.ts` — AI workflows
- `src/lib/api/documents.ts` — Document operations
- `src/lib/api/types.ts` — Object Type operations

**Benefits**:
- Reduces file size (600 lines → ~100 lines each)
- Easier to test domain clients independently
- Clearer separation of concerns

---

### 2. Centralize Constants (Small Effort, Medium Value)

Create `src/lib/constants.ts`:
```typescript
export const EAI_HOME = path.join(os.homedir(), '.eai');
export const TOKENS_FILE = path.join(EAI_HOME, 'tokens.json');
export const CONTEXT_FILE = path.join(EAI_HOME, 'context.json');
export const MANIFEST_FILE = '.eai-manifest.json';

export const TOKEN_REFRESH_BUFFER_MS = 300_000; // 5 minutes
export const UPDATE_CHECK_TIMEOUT_MS = 5000;
export const UPDATE_CHECK_INTERVAL_MS = 86_400_000; // 24 hours
export const OAUTH_CALLBACK_PORT = 3476;
export const MEMBERSHIP_CACHE_TTL_MS = 3_600_000; // 1 hour

export const ROLE_TENANT_ADMIN = 'tenant-admin';
export const ROLE_TENANT_MEMBER = 'tenant-member';
```

**Benefits**:
- Easier to update values
- Prevents typos
- Improves discoverability

---

### 3. Extract Command Handler Helpers (Medium Effort, Medium Value)

For long command handlers (100+ lines), extract helpers:

**Before**:
```typescript
typesCommand
  .command('seed')
  .action(async (options) => {
    // 150 lines of validation, API calls, verification
  });
```

**After**:
```typescript
typesCommand
  .command('seed')
  .action(async (options) => {
    const types = await loadAndValidateTypes();
    await seedTypesToPlatform(types, options);
    await verifyRemoteConvergence(types);
    outputSuccess(options.format);
  });
```

**Benefits**:
- Easier to test individual steps
- Clearer control flow
- Reusable helper functions

---

### 4. Add Input Validation Layer (Small Effort, High Value)

Create `src/lib/validators.ts`:
```typescript
export function validateFilePath(path: string, projectRoot: string): string {
  const resolved = path.resolve(projectRoot, path);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error('File path outside project directory');
  }
  return resolved;
}

export function validateTenantId(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error('Invalid tenant ID format');
  }
  return id;
}
```

**Benefits**:
- Prevents path traversal attacks
- Centralized validation logic
- Consistent error messages

---

## Architecture Evolution Recommendations

### Short Term (v2.9.0)

1. ✅ Extract constants to centralized file
2. ✅ Add input path validation
3. ✅ Implement token refresh mutex
4. ✅ Add retry logic for network errors

### Medium Term (v3.0.0)

1. ✅ Split API client into domain clients
2. ✅ Extract long command handlers into helpers
3. ✅ Add streaming support for large responses
4. ✅ Implement request deduplication

### Long Term (v3.1.0+)

1. ✅ Plugin system for custom commands
2. ✅ Workspace support (monorepo multi-app)
3. ✅ Built-in health monitoring dashboard
4. ✅ Advanced caching layer (Redis/Memcached)

---

## Conclusion

The EAI CLI codebase demonstrates **strong design patterns** with consistent application of Command, Facade, Strategy, and Repository patterns. The code follows SOLID principles and maintains good separation of concerns.

**Key Strengths**:
- Consistent command structure across 20 modules
- Well-defined separation between commands, API client, auth, and config
- Type-safe with TypeScript strict mode
- Self-documenting via JSDoc and help text

**Primary Tech Debt**:
- God module in API client (600+ lines)
- Magic numbers and strings scattered throughout
- Missing input validation for file paths
- Token refresh race condition

**Recommendation**: Address high-priority tech debt in v2.9.0, then incrementally refactor God module and extract helpers in v3.0.0. The codebase is in excellent shape for continued evolution.

**Overall Pattern Score: 8/10** — Strong design patterns with manageable technical debt.
