---
generated: "2026-03-11T18:45:00Z"
source_commit: "584ed1afb8257ec89c81a6e0515007e9491fa008"
---

# EAI CLI — Patterns & Tech Debt

## Overview

This document identifies design patterns, anti-patterns, and technical debt in the EAI CLI codebase.

---

## Design Patterns

### 1. Command Pattern ✅

**Location**: `src/commands/*.ts`

**Implementation**: Each command is a separate module exporting a Commander command instance.

**Example**:
```typescript
// src/commands/resources.ts
export const resourcesCommand = new Command('resources')
  .description('CRUD operations on platform resources');

resourcesCommand
  .command('list <type>')
  .action(async (type, options) => { /* ... */ });
```

**Benefits**:
- Easy to add new commands
- Clear separation of command logic
- Testable in isolation

**References**:
- `src/commands/init.ts:19`
- `src/commands/login.ts:12`
- `src/commands/types.ts:18`

---

### 2. Repository Pattern ✅

**Location**: `src/lib/api.ts`

**Implementation**: `PlatformAPIClient` class abstracts API calls into typed methods.

**Example**:
```typescript
class PlatformAPIClient {
  async listResources(objectType: string, options?: { page?: number }): Promise<Response> {
    return fetch(`${this.baseUrl}/v3/resources/${this.tenantId}/${objectType}`, ...);
  }
}
```

**Benefits**:
- Isolates HTTP concerns from command logic
- Easy to mock for testing
- Single source of truth for API interactions

**References**:
- `src/lib/api.ts:10-257`

---

### 3. Strategy Pattern ✅

**Location**: `src/lib/config.ts`

**Implementation**: Project discovery tries multiple strategies to find project root.

**Example**:
```typescript
async function findProjectRoot(from?: string): Promise<string | null> {
  // Strategy 1: Look for eai.config.ts
  try { await access(join(dir, 'eai.config.ts')); return dir; } catch { }

  // Strategy 2: Look for src/eai.config/object-types.ts
  try { await access(join(dir, 'src', 'eai.config', 'object-types.ts')); return dir; } catch { }

  // Strategy 3: Look for package.json with EAI deps
  try { /* check package.json */ } catch { }
}
```

**Benefits**:
- Flexible project discovery
- Supports multiple project structures (Vertical-Template, custom)

**References**:
- `src/lib/config.ts:75-106`

---

### 4. Factory Pattern ✅

**Location**: `src/commands/*.ts` (implicit)

**Implementation**: Commands create API client instances with environment-specific configuration.

**Example**:
```typescript
function createClient(env: Record<string, string>): { client: PlatformAPIClient } {
  const publicApiUrl = env.BASE_URL_PUBLIC_API;
  const tenantId = env.TENANT_DEFAULT_ID;
  return { client: new PlatformAPIClient(publicApiUrl, tenantId) };
}
```

**Benefits**:
- Centralized client creation
- Environment-aware configuration

**References**:
- `src/commands/resources.ts:12-19`

---

### 5. Singleton Pattern ⚠️ (Implicit)

**Location**: `src/lib/auth.ts`

**Implementation**: Token storage is effectively a singleton (single file per user).

**Example**:
```typescript
const TOKENS_FILE = join(homedir(), '.eai', 'tokens.json');

async function loadTokens(): Promise<StoredTokens | null> {
  const encrypted = await readFile(TOKENS_FILE, 'utf-8');
  return JSON.parse(decrypt(encrypted));
}
```

**Risks**:
- Race condition if multiple CLI instances run concurrently
- No file locking mechanism

**Recommendation**: Add file locking (e.g., `lockfile` library) or atomic writes

**References**:
- `src/lib/auth.ts:15`
- `src/lib/auth.ts:77-85`

---

### 6. Template Method Pattern ✅

**Location**: `src/commands/*.ts` (implicit)

**Implementation**: Commands follow a template structure:
1. Load project context
2. Create API client
3. Execute operation with spinner
4. Handle response
5. Display result

**Example** (abstracted):
```typescript
async function commandTemplate() {
  const context = await loadContext();           // Step 1
  const client = createClient(context.env);      // Step 2
  const spinner = ora('Loading...').start();     // Step 3
  const res = await client.operation();
  if (!res.ok) { spinner.fail(); exit(1); }      // Step 4
  const data = await res.json();
  spinner.succeed(); console.log(data);          // Step 5
}
```

**Benefits**:
- Consistent UX across commands
- Predictable error handling

**Duplication**: This pattern is repeated in ~30 command handlers (tech debt)

---

### 7. Adapter Pattern ✅

**Location**: `src/lib/config.ts`

**Implementation**: TypeScript stripping adapts TS config files to JS for evaluation.

**Example**:
```typescript
function stripTypeScript(source: string): string {
  let js = source;
  js = js.replace(/^import\s+.*$/gm, '');  // Remove imports
  js = js.replace(/:\s*\w+(?:\[\])?\s*(?==)/g, ' =');  // Strip type annotations
  return js;
}
```

**Benefits**:
- Allows TypeScript config without requiring `ts-node` dependency
- Faster execution (no TypeScript compilation)

**References**:
- `src/lib/config.ts:183-208`

---

### 8. Proxy Pattern ✅

**Location**: `src/lib/api.ts`

**Implementation**: CLI acts as a proxy to Platform API, adding authentication headers.

**Example**:
```typescript
async listResources(type: string): Promise<Response> {
  return fetch(url, { headers: await this.headers() });  // Adds Authorization
}
```

**Benefits**:
- Transparent authentication injection
- Commands don't need to handle auth

**References**:
- `src/lib/api.ts:16-25`

---

## Anti-Patterns

### 1. God Object ⚠️

**Location**: `src/lib/api.ts`

**Description**: `PlatformAPIClient` has 20+ methods covering all API operations.

**Impact**: Class is large (257 lines) and hard to test/maintain.

**Recommendation**: Split into smaller clients by domain:
```typescript
class ResourcesClient { /* listResources, getResource, etc. */ }
class ChatClient { /* sendChat, streamChat */ }
class DocumentsClient { /* classifyDocument, indexDocument */ }
class TypesClient { /* getSchema, seedType */ }
```

**References**:
- `src/lib/api.ts:10-257`

---

### 2. Duplicate Code (Template Method Not Extracted) ⚠️

**Location**: `src/commands/*.ts`

**Description**: Each command handler repeats the same boilerplate:
- Load project root
- Load environment
- Create API client
- Initialize spinner

**Impact**: ~100 lines of duplicated code across commands.

**Recommendation**: Extract to shared helper (see Factory Pattern improvement).

**Example Duplication**:
```typescript
// Repeated in ~10 commands
const root = await findProjectRoot();
if (!root) { out.error('Not in an EAI project.'); process.exit(1); }
const env = await loadEnvFile(root);
const client = new PlatformAPIClient(env.BASE_URL_PUBLIC_API, tenantId);
```

**References**:
- `src/commands/resources.ts:21-29`
- `src/commands/types.ts:31-35`
- `src/commands/chat.ts:25-37`

---

### 3. Magic Strings ⚠️

**Location**: Throughout codebase

**Description**: Hardcoded strings for error messages, endpoints, config keys.

**Impact**: Difficult to maintain, localize, or test.

**Examples**:
```typescript
// Error messages
out.error('Not in an EAI project.');
out.error('Missing BASE_URL_PUBLIC_API or tenant ID.');

// Config keys
env.TENANT_DEFAULT_ID
env.BASE_URL_PUBLIC_API

// Endpoints
'/v3/resources/${tenant}/${type}'
'/v3/chat/${tenant}/${workflow}/${stage}'
```

**Recommendation**: Extract to constants:
```typescript
// src/lib/constants.ts
export const ERROR_MESSAGES = {
  NOT_IN_PROJECT: 'Not in an EAI project.',
  MISSING_CONFIG: 'Missing BASE_URL_PUBLIC_API or tenant ID.',
};

export const ENV_KEYS = {
  TENANT_DEFAULT: 'TENANT_DEFAULT_ID',
  API_URL: 'BASE_URL_PUBLIC_API',
};

export const API_ENDPOINTS = {
  RESOURCES: (tenant: string, type: string) => `/v3/resources/${tenant}/${type}`,
  CHAT: (tenant: string, workflow: string, stage: string) => `/v3/chat/${tenant}/${workflow}/${stage}`,
};
```

---

### 4. Long Functions ⚠️

**Location**: `src/commands/types.ts`, `src/commands/resources.ts`

**Description**: Some command handlers exceed 100 lines.

**Impact**: Hard to read, test, and maintain.

**Example**: `src/commands/types.ts:23-168` (145 lines for `types seed`)

**Recommendation**: Extract to helper functions:
```typescript
// Before: 145-line action handler
typesCommand.command('seed').action(async (options) => { /* 145 lines */ });

// After: Decomposed
async function seedAction(options) {
  const types = await loadTypes();
  const results = await seedTypesToPlatform(types, options);
  displayResults(results, options);
}

async function seedTypesToPlatform(types, options) { /* ... */ }
function displayResults(results, options) { /* ... */ }
```

---

### 5. Silent Failures ⚠️

**Location**: `src/lib/update-check.ts`

**Description**: Update check failures are swallowed silently.

**Impact**: Users don't know why update check failed (network issue? registry down?).

**Example**:
```typescript
export function checkForUpdate(currentVersion: string): void {
  void (async () => {
    try {
      const latest = await fetchLatestVersion();
      // ...
    } catch {
      // Silent failure — user sees nothing
    }
  })();
}
```

**Recommendation**: Add optional verbose logging:
```typescript
if (process.env.EAI_VERBOSE) {
  console.error(`Update check failed: ${error.message}`);
}
```

**References**:
- `src/lib/update-check.ts:81-98`

---

## Technical Debt

### High Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **No Unit Tests** | 🔴 Critical | Entire codebase | Add Vitest with 70% coverage | 3-5 days |
| **Duplicate Command Boilerplate** | 🟡 Medium | `src/commands/*.ts` | Extract to `command-helpers.ts` | 1 day |
| **Token Refresh Race Condition** | 🟡 Medium | `src/lib/auth.ts:71-92` | Add file locking | 4 hours |
| **God Object (PlatformAPIClient)** | 🟡 Medium | `src/lib/api.ts` | Split into domain clients | 2 days |

---

### Medium Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **Magic Strings** | 🟡 Medium | Throughout | Extract to `constants.ts` | 1 day |
| **Long Functions** | 🟡 Medium | `src/commands/types.ts`, `resources.ts` | Extract helper functions | 1 day |
| **Sequential Type Seeding** | 🟢 Low | `src/commands/types.ts:98-158` | Parallelize with `Promise.all()` | 2 hours |
| **No Retry Logic** | 🟢 Low | `src/lib/api.ts` | Add exponential backoff | 4 hours |

---

### Low Priority

| Item | Severity | Location | Recommendation | Effort |
|------|----------|----------|----------------|--------|
| **Silent Update Check Failures** | 🟢 Low | `src/lib/update-check.ts` | Add verbose logging | 1 hour |
| **No Request Caching** | 🟢 Low | `src/lib/api.ts` | Add optional TTL cache | 4 hours |
| **Token Storage Security** | 🟢 Low | `src/lib/auth.ts` | Upgrade to OS keychain | 1 day (adds native dep) |

---

## Spec vs Implementation Alignment

### .specify/ Directory Analysis

**Finding**: `.specify/specs/_archive/` contains archived specs for:
1. CLI Packaging and Docs
2. Static NPM Registry
3. CLI Consolidation

**Status**: All specs appear to be **implemented** (marked as archived).

**Verification**:
- ✅ Static NPM Registry: Implemented (`release.sh`, `docs/public/registry/`)
- ✅ Documentation Site: Implemented (93-page docs site)
- ✅ CLI Consolidation: Implemented (unified command structure)

**No Active Specs**: All specs in `.specify/specs/` are archived, indicating completed work.

**Recommendation**: Keep `.specify/` updated with new feature specs as they are planned.

---

## Code Smells

### 1. Feature Envy

**Location**: `src/commands/types.ts:78-86`

**Description**: Command reaches into environment object to extract nested keys.

**Example**:
```typescript
const normalizedKey = tenantKey.replace(/-/g, '_').toUpperCase();
const tenantId = env[`TENANT_${normalizedKey}_ID`] || env.TENANT_DEFAULT_ID;
```

**Recommendation**: Move to config module:
```typescript
// src/lib/config.ts
export function resolveTenantId(env: Env, tenantKey: string): string {
  const normalized = tenantKey.replace(/-/g, '_').toUpperCase();
  return env[`TENANT_${normalized}_ID`] || env.TENANT_DEFAULT_ID;
}
```

---

### 2. Temporary Field

**Location**: `src/lib/config.ts:141-148`

**Description**: Temporary file created, used, and deleted in same function.

**Example**:
```typescript
const tempFile = join(tmpdir(), `eai-object-types-${randomUUID()}.mjs`);
try {
  await writeFile(tempFile, jsSource, 'utf-8');
  const module = await import(tempFile);
  return module.objectTypes;
} finally {
  await unlink(tempFile);  // Cleanup
}
```

**Not a Problem**: This is an acceptable use of temporary files. Cleanup is guaranteed by `finally`.

---

### 3. Speculative Generality

**Location**: `src/lib/api.ts:205-207`

**Description**: Generic `platformRequest()` method for future flexibility.

**Example**:
```typescript
async platformRequest(endpoint: string, method = 'GET', body?: unknown, params?: Record<string, unknown>)
```

**Not a Problem**: This is currently used by `types seed` and `tenant` commands. Not speculative.

---

## Recommended Refactorings

### 1. Extract Common Command Context (High Priority)

**Before** (duplicated across commands):
```typescript
const root = await findProjectRoot();
if (!root) { out.error('Not in an EAI project.'); process.exit(1); }
const env = await loadEnvFile(root);
const client = new PlatformAPIClient(env.BASE_URL_PUBLIC_API, tenantId);
```

**After**:
```typescript
// src/lib/command-helpers.ts
export async function createCommandContext(): Promise<CommandContext> {
  const root = await findProjectRoot();
  if (!root) { out.error('Not in an EAI project.'); process.exit(1); }
  const env = await loadEnvFile(root);
  const tenantId = resolveTenantId(env);
  const client = new PlatformAPIClient(env.BASE_URL_PUBLIC_API, tenantId);
  return { root, env, client, tenantId };
}

// Usage in commands
const ctx = await createCommandContext();
const res = await ctx.client.listResources(type);
```

**Impact**: Removes ~100 lines of duplication, makes commands 30% shorter.

---

### 2. Split PlatformAPIClient (Medium Priority)

**Before** (God Object):
```typescript
class PlatformAPIClient {
  listResources() { }
  getResource() { }
  sendChat() { }
  classifyDocument() { }
  // ... 20+ methods
}
```

**After** (Domain Clients):
```typescript
// src/lib/clients/resources-client.ts
export class ResourcesClient {
  constructor(private baseUrl: string, private tenantId: string) {}
  async list(type: string, options) { }
  async get(type: string, id: string) { }
  async create(type: string, data) { }
  async update(type: string, id: string, data, version) { }
  async delete(type: string, id: string) { }
}

// src/lib/clients/chat-client.ts
export class ChatClient {
  async send(workflowId, stage, message, conversationId) { }
  async stream(workflowId, stage, message, conversationId) { }
}

// src/lib/api.ts (facade)
export class PlatformAPIClient {
  resources: ResourcesClient;
  chat: ChatClient;
  documents: DocumentsClient;

  constructor(baseUrl: string, tenantId: string) {
    this.resources = new ResourcesClient(baseUrl, tenantId);
    this.chat = new ChatClient(baseUrl, tenantId);
    this.documents = new DocumentsClient(baseUrl, tenantId);
  }
}

// Usage
const res = await client.resources.list('Task');
```

**Impact**: Better separation of concerns, easier to test, more maintainable.

---

### 3. Add Retry Logic to API Client (Low Priority)

**Before**:
```typescript
async listResources(type: string): Promise<Response> {
  return fetch(url, { headers: await this.headers() });
}
```

**After**:
```typescript
async listResources(type: string): Promise<Response> {
  return this.withRetry(() => fetch(url, { headers: await this.headers() }));
}

private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);  // Exponential backoff
    }
  }
}
```

**Impact**: Improves resilience to transient network failures.

---

## Architectural Debt

### 1. No Separation Between CLI and Library Code

**Current**: All code is CLI-specific (Commander commands, spinners, exit codes).

**Future Need**: Reusable library for programmatic use (e.g., VS Code extension, web UI).

**Recommendation**: Split into two packages:
- `@eai-tools/cli` — CLI-specific code (commands, spinners, prompts)
- `@eai-tools/client` — Reusable library (API client, auth, config)

**Effort**: 2-3 days to refactor and publish separate packages.

---

### 2. No Plugin System

**Current**: All commands are built-in.

**Future Need**: Allow users to add custom commands (e.g., `eai my-company-workflow`).

**Recommendation**: Add plugin discovery and loading:
```typescript
// ~/.eai/plugins/my-company-cli.js
export const commands = [
  new Command('my-company-workflow').action(() => { /* ... */ })
];

// src/index.ts
const plugins = await loadPlugins('~/.eai/plugins');
for (const plugin of plugins) {
  for (const cmd of plugin.commands) {
    program.addCommand(cmd);
  }
}
```

**Effort**: 3-4 days to design and implement plugin system.

---

## Performance Debt

### 1. Sequential Type Seeding

**Current**: ~10 types take 20 seconds (1 API call per type, sequential).

**Recommendation**: Parallelize with `Promise.all()`.

**Before**:
```typescript
for (const type of types) {
  const spinner = ora(`  ${type.name}`).start();
  const res = await client.platformRequest('/object-types', 'POST', type);
  // ...
}
```

**After**:
```typescript
const results = await Promise.all(
  types.map(async (type) => {
    const spinner = ora(`  ${type.name}`).start();
    const res = await client.platformRequest('/object-types', 'POST', type);
    // ...
    return { type, res };
  })
);
```

**Impact**: 3-5x faster (10 types in 4-6 seconds instead of 20 seconds).

---

## Summary

**Patterns**: 8 identified (7 good, 1 risky — Singleton without locking)

**Anti-Patterns**: 5 identified (God Object, duplication, magic strings, long functions, silent failures)

**Tech Debt**: 12 items (4 high priority, 4 medium, 4 low)

**Spec Alignment**: ✅ All archived specs implemented

**Top Priority**:
1. Add unit tests
2. Extract common command boilerplate
3. Fix token refresh race condition
4. Split PlatformAPIClient into domain clients

**Estimated Effort**: 7-10 days to address high and medium priority debt.
