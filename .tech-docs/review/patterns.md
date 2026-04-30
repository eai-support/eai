---
generated: "2026-04-30T17:57:12Z"
source_commit: "7c879a6c02a2f9b91aa534b4c59bb62cc35a107b"
---

# EAI CLI — Patterns & Tech Debt

## Overview

This document identifies design patterns, anti-patterns, and technical debt in the EAI CLI codebase (v2.6.0).

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
- 15 command files total

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

  async getCurrentUserMemberships(): Promise<Response> {
    return fetch(`${this.adminApiUrl}/api/admin/current-user/tenant-memberships`, ...);
  }
}
```

**Benefits**:
- Isolates HTTP concerns from command logic
- Easy to mock for testing (MSW)
- Single source of truth for API interactions
- Supports both PublicAPI and AdminAPI

**References**:
- `src/lib/api.ts:187-600+`

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
- `src/lib/config.ts:75-120`

---

### 4. Factory Pattern ✅

**Location**: `src/lib/context.ts`

**Implementation**: `resolveCommandContext()` creates command context with all dependencies.

**Example**:
```typescript
interface CommandContext {
  publicApiUrl: string;
  tenantId: string;
  tenantName: string;
  client: PlatformAPIClient;
}

async function resolveCommandContext(options: ResolveContextOptions): Promise<CommandContext> {
  const root = await findProjectRoot();
  const profile = getActiveProfile();
  const tokens = await getToken();
  const tenant = await loadActiveTenantContext();
  const client = new PlatformAPIClient(publicApiUrl, tenant.id);
  return { publicApiUrl, tenantId: tenant.id, tenantName: tenant.displayName, client };
}
```

**Benefits**:
- Centralizes context creation
- Reduces boilerplate in commands
- Consistent error handling

**References**:
- `src/lib/context.ts:35-120`
- Used by: `src/commands/resources.ts`, `src/commands/types.ts`, `src/commands/tenant.ts`

---

### 5. Singleton Pattern ✅

**Location**: `src/lib/auth.ts`

**Implementation**: Module-level cache for tokens to prevent multiple refreshes.

**Example**:
```typescript
// Module-level cache — keyed by profile name
const _cache: Map<string, StoredTokens> = new Map();

export async function getToken(): Promise<string> {
  const profile = getActiveProfile();
  if (_cache.has(profile)) {
    return _cache.get(profile)!.accessToken;
  }
  // Load from disk and cache
}
```

**Benefits**:
- Prevents race conditions on token refresh
- Reduces disk I/O for repeated token access

**References**:
- `src/lib/auth.ts:47`

---

### 6. Template Method Pattern ✅

**Location**: `release.sh`

**Implementation**: Release script defines a template for releases with validation steps.

**Example**:
```bash
# Template:
# 1. Preflight checks
# 2. Dependency install
# 3. Type check
# 4. Lint
# 5. Build
# 6. Test
# 7. Smoke test
# 8. Docs build
# 9. Pack + registry
# 10. Bump version
# 11. Commit + tag
# 12. Push + release
```

**Benefits**:
- Consistent release process
- No manual steps skipped
- Reproducible releases

**References**:
- `release.sh:1-200`

---

### 7. Observer Pattern ✅

**Location**: `src/lib/update-check.ts`

**Implementation**: Background update check notifies user after command execution.

**Example**:
```typescript
// Fire-and-forget background check
checkForUpdate(currentVersion);

// Later: notify if update available
await notifyIfUpdateAvailable(currentVersion);
```

**Benefits**:
- Non-blocking update checks
- User notified without disrupting workflow

**References**:
- `src/lib/update-check.ts:50-120`
- `src/index.ts:161-163`

---

### 8. Builder Pattern ✅

**Location**: `src/lib/schema-builder.ts`

**Implementation**: Builds JSON schema representation of CLI for AI agents.

**Example**:
```typescript
export function describeProgram(program: Command): CommandSchema {
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
- Enables `eai --describe` for automation

**References**:
- `src/lib/schema-builder.ts:10-80`
- Used by: `src/index.ts:159`

---

## Anti-Patterns

### 1. God Object ⚠️

**Location**: `src/lib/api.ts`

**Issue**: `PlatformAPIClient` handles both PublicAPI and AdminAPI with 30+ methods.

**Example**:
```typescript
class PlatformAPIClient {
  // PublicAPI methods
  async listResources() { }
  async getResource() { }
  async createResource() { }
  async sendChat() { }
  async streamChat() { }
  async classifyDocument() { }
  
  // AdminAPI methods
  async getCurrentUserMemberships() { }
  async provisionUserToTenant() { }
  async bootstrapChildTenantAdmin() { }
  async createTenant() { }
  async lookupUserByEmail() { }
  async provisionEntraApp() { }
  
  // ... 20 more methods
}
```

**Impact**: Medium
- Class is large but methods are cohesive (all API calls)
- Easy to find API methods in one place

**Recommendation**:
- Consider splitting into `PublicAPIClient` and `AdminAPIClient`
- Or extract domain-specific clients (e.g., `TenantAPIClient`, `UserAPIClient`)

**Priority**: Low (works well in practice)

---

### 2. Magic Strings ⚠️

**Location**: `src/lib/api.ts`, command files

**Issue**: API paths hardcoded as strings.

**Example**:
```typescript
// Current
fetch(`${baseUrl}/v3/resources/${tenant}/${type}`)

// Better
const paths = {
  resources: (tenant: string, type: string) => `/v3/resources/${tenant}/${type}`,
  chat: (tenant: string, workflow: string, stage: string) => `/v3/chat/${tenant}/${workflow}/${stage}`,
};
fetch(`${baseUrl}${paths.resources(tenant, type)}`)
```

**Impact**: Low
- Paths are stable and unlikely to change frequently
- Easy to find with search

**Recommendation**: Extract to path builder functions

**Priority**: Low

---

### 3. Callback Hell (Avoided) ✅

**Location**: All command files

**Note**: CLI properly uses `async/await` everywhere. No callback nesting.

**Example**:
```typescript
// Good: async/await
const token = await getToken();
const client = new PlatformAPIClient(url, tenant);
const res = await client.listResources(type);

// Not found in codebase: callback hell
getToken((err, token) => {
  if (err) return console.error(err);
  createClient(token, (err, client) => {
    if (err) return console.error(err);
    // ...
  });
});
```

**Status**: Not present in codebase

---

## Technical Debt

### 1. TypeScript Stripping via Temp File 💰

**Location**: `src/lib/config.ts`

**Issue**: Object Type loading writes temp file to disk, imports, then deletes.

**Current Flow**:
1. Read `object-types.ts`
2. Strip TypeScript types via regex
3. Write to `/tmp/eai-*.mjs`
4. `import()` the temp file
5. Delete temp file

**Trade-offs**:
- ✅ Avoids `ts-node` or `tsx` dependency (keeps bundle small)
- ⚠️ Disk I/O overhead
- ⚠️ Race condition risk if multiple CLI processes run concurrently

**Recommendation**:
- Evaluate in-memory eval with `vm` module
- Or accept trade-off (works well in practice)

**Priority**: Low

**References**:
- `src/lib/config.ts:150-200`

---

### 2. Sequential Type Seeding 💰💰

**Location**: `src/commands/types.ts`

**Issue**: Object Types are seeded one at a time, not in parallel.

**Current**:
```typescript
for (const type of objectTypes) {
  await seedType(type);
}
```

**Impact**: 10 types take 10x single-type time

**Recommendation**:
```typescript
await Promise.all(objectTypes.map(type => seedType(type)));
// Or rate-limited:
await pLimit(5).map(objectTypes, type => seedType(type));
```

**Priority**: Medium (impacts developer workflow)

**References**:
- `src/commands/types.ts:120-180`

---

### 3. Encryption Key Derivation 💰

**Location**: `src/lib/auth.ts`

**Issue**: Encryption key derived from `sha256(eai-cli-${homedir}-token-store)`, not OS keychain.

**Trade-offs**:
- ✅ Portable across machines (no native dependency)
- ⚠️ Less secure than OS keychain (macOS Keychain, Windows Credential Manager)
- ⚠️ Same key for all users on same machine (unlikely scenario)

**Recommendation**:
- Add optional `keytar` dependency for OS keychain
- Fallback to current method if keychain unavailable

**Priority**: Medium (security improvement)

**References**:
- `src/lib/auth.ts:72-74`

---

### 4. Test Coverage Gaps 💰💰

**Location**: `tests/`

**Issue**: Not all commands have unit tests.

**Current Coverage** (estimated):
- Library modules: ~60%
- Commands: ~20%

**Recommendation**:
- Target 80%+ coverage on `src/lib/*.ts`
- Add command tests using MSW for API mocking

**Priority**: High (improves confidence in refactoring)

**References**:
- `tests/**/*.test.ts`
- `vitest.config.ts`

---

### 5. Profile Config File Format 💰

**Location**: `~/.eai/config.json`

**Issue**: Profile config is JSON, not type-checked.

**Current**:
```json
{
  "profiles": {
    "dev": {
      "publicApiUrl": "...",
      "authTenantName": "...",
      "authTenantId": "...",
      "authClientId": "..."
    }
  }
}
```

**Recommendation**:
- Add JSON schema for validation
- Or use TypeScript config (e.g., `eai.profiles.ts`)

**Priority**: Low (works well in practice)

**References**:
- `src/lib/profile.ts:50-100`

---

## Spec vs Implementation Alignment

### Fully Aligned Specs ✅

1. **011-Install Gofer** (100/100)
   - No tech debt identified
   - All acceptance criteria met

2. **901-CLI Platform Alignment** (100/100)
   - No tech debt identified
   - Membership-driven tenant context fully implemented

3. **902-Provision Entra Diagnostics** (100/100)
   - No tech debt identified
   - Sanitized error handling complete

4. **903-Provision Entra CIAM Routing** (100/100)
   - No tech debt identified
   - Profile-based routing complete

**Discrepancies**: None

---

## Tech Debt Summary

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| Sequential Type Seeding | Medium | Small | Medium (developer workflow) |
| Test Coverage Gaps | High | Large | High (confidence in refactoring) |
| Encryption Key Derivation | Medium | Medium | Medium (security improvement) |
| TypeScript Stripping via Temp File | Low | Medium | Low (works well) |
| Profile Config File Format | Low | Small | Low (nice-to-have) |
| Magic Strings (API paths) | Low | Small | Low (readability) |
| God Object (PlatformAPIClient) | Low | Large | Low (works well) |

**Total Debt**: 7 items (2 high/medium priority, 5 low priority)

**Recommendation**: Prioritize test coverage and parallel type seeding. Other items are low-impact and can be deferred.

---

## Architecture Evolution

### v0.1.4 → v2.6.0 Changes

1. **Added Profile System**:
   - Pattern: Strategy (different profiles for different environments)
   - Files: `src/lib/profile.ts`, `~/.eai/config.json`

2. **Added Tenant Context Management**:
   - Pattern: Repository (AdminAPI client for memberships)
   - Files: `src/lib/tenant-context.ts`, `~/.eai/tenant-context.json`

3. **Added Error Code Catalog**:
   - Pattern: Enum + Catalog (structured error handling)
   - Files: `src/lib/error-codes.ts`

4. **Added Context Resolution**:
   - Pattern: Factory (centralized context creation)
   - Files: `src/lib/context.ts`

5. **Added Schema Builder**:
   - Pattern: Builder (JSON schema generation)
   - Files: `src/lib/schema-builder.ts`

**Architectural Improvements**:
- Centralized context resolution (less boilerplate)
- Structured error handling (consistent user experience)
- Profile isolation (security improvement)
- Spec-driven development (intentional design)

---

## Recommendations

### Immediate Actions

1. **Parallelize Type Seeding** (Medium priority, Small effort)
   - File: `src/commands/types.ts`
   - Use `Promise.all()` for parallel API calls

2. **Expand Test Coverage** (High priority, Large effort)
   - Target: 80%+ coverage on `src/lib/*.ts`
   - Use MSW for API mocking

### Long-Term Improvements

3. **OS Keychain Integration** (Medium priority, Medium effort)
   - File: `src/lib/auth.ts`
   - Add optional `keytar` dependency

4. **Extract API Path Builders** (Low priority, Small effort)
   - File: `src/lib/api.ts`
   - Create `paths` object with builder functions

### Deferred (Low Priority)

5. **Split PlatformAPIClient** (Low priority, Large effort)
   - Current design works well
   - Consider only if class exceeds 1000 lines

6. **TypeScript Config for Profiles** (Low priority, Medium effort)
   - JSON works fine for now
   - Add JSON schema validation first

---

## Conclusion

The EAI CLI demonstrates strong architectural patterns with minimal anti-patterns and manageable technical debt. The codebase is production-ready with clear opportunities for incremental improvement.

**Key Strengths**:
- Consistent use of design patterns (Command, Repository, Factory)
- Spec-driven development ensures intentional design
- Clear separation of concerns across modules

**Key Opportunities**:
- Expand test coverage (highest priority)
- Parallelize type seeding (quick win for developer experience)
- OS keychain integration (security improvement)

All tech debt items are low-to-medium priority and do not block production use. The architecture is sound and extensible.
