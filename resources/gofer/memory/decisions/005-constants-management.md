# ADR-005: Constants Management Strategy

**Status**: Accepted
**Date**: 2026-02-24
**Deciders**: Engineering Team
**Phase**: Phase 0 - Magic Number Elimination
**Related Tasks**: T001-T008 (Magic Number Replacement)

---

## Context

The codebase had **magic numbers** scattered throughout:

```typescript
// Anti-pattern: Magic numbers with no explanation
if (response.length > 100000) {
  // Why 100000? What does it represent?
}

setTimeout(callback, 300000); // Why 5 minutes?

if (cacheSize > 50) {
  // Why 50? Can this change?
}
```

**Problems**:

1. **Unclear intent**: What does the number represent? (bytes? tokens? count?)
2. **Difficult to change**: Must find all occurrences across codebase
3. **Inconsistency**: Same concept different values (200000 vs 200k tokens)
4. **No documentation**: Why this value? Can it be tuned?
5. **Hard to test**: Can't easily test boundary conditions

**Engineering Review Score**: Code Quality **7/10** (magic numbers primary
issue)

**Examples**:

- Context health thresholds: 100000, 140000, 180000 (50%, 70%, 90% of 200k)
- Cache limits: 50, 100, 20 (max entries for different caches)
- Timeouts: 300000, 30000, 60000 (5min, 30s, 1min in milliseconds)
- Retry delays: 1000, 5000, 10000 (1s, 5s, 10s exponential backoff)

---

## Decision

We will organize constants **hierarchically by domain** in config files:

1. **extension/src/config/**: Domain-specific constant modules
2. **Named exports**: Descriptive variable names (not just numbers)
3. **Documentation**: JSDoc explaining what, why, and tunability
4. **Centralized**: Single source of truth per domain
5. **Type-safe**: Use TypeScript `const` assertions and enums

**File Structure**:

```text
extension/src/config/
├── index.ts          # Re-exports all constants
├── context.ts        # Context window constants
├── cache.ts          # Cache configuration constants
├── timeouts.ts       # Timeout and retry constants
├── limits.ts         # General size/count limits
└── paths.ts          # Default file paths
```

**Example - context.ts**:

```typescript
/**
 * Context Window Configuration
 *
 * Gofer targets Claude models with 200k token context windows.
 * These thresholds define when to warn users about context pressure.
 */

/** Maximum context window size (tokens) - Claude Sonnet/Opus 4 */
export const MAX_CONTEXT_TOKENS = 200_000;

/** Healthy usage threshold (50% of max) - continue normally */
export const CONTEXT_HEALTHY_THRESHOLD = 100_000;

/** Warning usage threshold (70% of max) - recommend compaction */
export const CONTEXT_WARNING_THRESHOLD = 140_000;

/** Critical usage threshold (90% of max) - must save and restart */
export const CONTEXT_CRITICAL_THRESHOLD = 180_000;

/**
 * Estimated average tokens per character
 *
 * Used for rough token estimation. More accurate estimation requires
 * tiktoken library (~200KB bundle size).
 */
export const TOKENS_PER_CHAR = 0.25; // 1 token ~= 4 characters
```

---

## Rationale

### Why Hierarchical Organization?

1. **Discoverability**: Related constants grouped together
2. **Maintainability**: Change cache limits in one place (cache.ts)
3. **Testability**: Import specific config module in tests
4. **Scalability**: Add new domains without cluttering single file
5. **Ownership**: Clear which team/feature owns which constants

### Why Named Exports (Not Default)?

```typescript
// ✅ Named exports - explicit, tree-shakeable
export const MAX_RETRIES = 3;

// ❌ Default export - implicit, harder to tree-shake
export default { MAX_RETRIES: 3 };
```

Advantages:

- **Tree-shaking**: Bundler can eliminate unused constants
- **Explicit imports**: `import { MAX_RETRIES }` vs. `import config`
- **IDE support**: Autocomplete suggests available constants
- **Refactoring**: Rename refactors work better

### Why JSDoc Documentation?

```typescript
/**
 * Maximum cache entries before LRU eviction
 *
 * Tuning: Increase if cache hit rate <80%
 * Trade-off: Higher limit = more memory usage
 */
export const MAX_CACHE_ENTRIES = 50;
```

Benefits:

- **Explains intent**: Why this value chosen
- **Tuning guidance**: How to adjust for different workloads
- **Trade-offs**: What changes if increased/decreased
- **IDE tooltips**: Hover shows documentation

### Why TypeScript const Assertions?

```typescript
// ✅ const assertion - immutable, literal type
export const CACHE_LIMITS = {
  spec: 50,
  memory: 100,
  research: 20,
} as const;

// ❌ mutable object - can be modified at runtime
export const CACHE_LIMITS = {
  spec: 50,
  memory: 100,
  research: 20,
};
```

Benefits:

- **Immutability**: Prevents accidental modification
- **Literal types**: `CACHE_LIMITS.spec` is `50` (not `number`)
- **Type narrowing**: Enables better type inference

---

## Alternatives Considered

### 1. Single Constants File

**Approach**: All constants in `extension/src/config/constants.ts`.

**Pros**:

- ✅ Simple - one place to look
- ✅ Easy to import - single import statement
- ✅ No directory structure needed

**Cons**:

- ❌ Becomes God file (100+ constants, hard to navigate)
- ❌ No logical grouping (cache, context, timeouts all mixed)
- ❌ Merge conflicts (everyone edits same file)
- ❌ Difficult to test (import everything or nothing)

**Verdict**: Doesn't scale - will become unmanageable.

### 2. Per-Module Constants

**Approach**: Constants defined in same file as usage.

```typescript
// extension/src/services/SpecCache.ts
const MAX_ENTRIES = 50; // Local constant

export class SpecCache {
  /* ... */
}
```

**Pros**:

- ✅ Locality - constant near usage
- ✅ No import needed
- ✅ Scoped - not globally visible

**Cons**:

- ❌ Duplication - same constant redefined in multiple places
- ❌ Inconsistency - MAX_ENTRIES differs across modules
- ❌ Hard to find - must search codebase for all occurrences
- ❌ Difficult to test - can't override for testing

**Verdict**: Loses centralization benefits - not recommended.

### 3. Environment Variables

**Approach**: Load constants from `.env` file at runtime.

```bash
# .env
MAX_CONTEXT_TOKENS=200000
CACHE_LIMIT_SPEC=50
```

**Pros**:

- ✅ Runtime configuration (no rebuild to change)
- ✅ Environment-specific (dev vs. prod)
- ✅ Secrets support (API keys, tokens)

**Cons**:

- ❌ Type safety - all values are strings (need parsing)
- ❌ Validation - must check/convert at runtime
- ❌ Default values - need fallbacks if not set
- ❌ Deployment complexity - must manage .env files
- ❌ Not needed - extension config is compile-time

**Verdict**: Over-engineered for constants - use for secrets only.

### 4. JSON Configuration Files

**Approach**: Store constants in `config.json`.

```json
{
  "context": {
    "maxTokens": 200000,
    "warningThreshold": 140000
  }
}
```

**Pros**:

- ✅ Human-readable
- ✅ No code changes to modify
- ✅ Can be validated with JSON schema

**Cons**:

- ❌ No type safety (must validate at runtime)
- ❌ No JSDoc (documentation separate from values)
- ❌ Extra I/O (must read file)
- ❌ Not idiomatic TypeScript

**Verdict**: JSON better for user-facing config, not code constants.

---

## Consequences

### Positive

1. **Clarity**: Named constants document intent (MAX_RETRIES vs. 3)
2. **Consistency**: Single source of truth (no duplicate definitions)
3. **Maintainability**: Change value in one place, propagates everywhere
4. **Testability**: Mock config module to test boundary conditions
5. **Discoverability**: IDE autocomplete shows available constants
6. **Documentation**: JSDoc explains rationale and tuning guidance

### Negative

1. **Import overhead**: Must import constants explicitly
2. **Indirection**: One more hop to find value (navigate to config file)
3. **Verbosity**: `MAX_CACHE_ENTRIES` longer than `50`

### Neutral

1. **File count**: +5 config files (minimal)
2. **Bundle size**: No impact (constants tree-shaken if unused)

---

## Implementation Guidelines

### Constant Naming Conventions

- **UPPER_SNAKE_CASE**: For primitive constants
  (`MAX_RETRIES`, `DEFAULT_TIMEOUT_MS`)
- **PascalCase**: For complex objects/enums (`CacheLimits`, `RetryStrategy`)
- **Descriptive**: Include unit in name (`TIMEOUT_MS` not `TIMEOUT`)

### Organization Rules

**context.ts**:

- Context window sizes, thresholds, token estimations
- Example: `MAX_CONTEXT_TOKENS`, `CONTEXT_WARNING_THRESHOLD`

**cache.ts**:

- Cache entry limits, TTL values, token budgets
- Example: `MAX_CACHE_ENTRIES`, `CACHE_TTL_MS`

**timeouts.ts**:

- Operation timeouts, retry delays, polling intervals
- Example: `DEFAULT_TIMEOUT_MS`, `RETRY_DELAYS_MS`

**limits.ts**:

- General size/count limits not fitting other categories
- Example: `MAX_FILE_SIZE_BYTES`, `MAX_ARRAY_LENGTH`

**paths.ts**:

- Default file paths, directory names
- Example: `DEFAULT_SPECIFY_PATH`, `MEMORY_DIR_NAME`

### Documentation Template

```typescript
/**
 * [Brief description of what this constant represents]
 *
 * [Longer explanation if needed: why this value, how it was chosen]
 *
 * Tuning: [How to adjust for different scenarios]
 * Trade-off: [What changes if increased/decreased]
 * Related: [Other constants affected by changing this]
 */
export const CONSTANT_NAME = value;
```

### Example - cache.ts

```typescript
/**
 * Cache Configuration Constants
 */

/**
 * Maximum entries in SpecCache before LRU eviction
 *
 * Workspaces typically have <50 specs. Higher limit improves hit rate
 * but increases memory usage (~1MB per 10 specs).
 *
 * Tuning: Increase if cache hit rate <80% (check logs)
 * Trade-off: +10 entries ~= +1MB memory
 * Related: SPEC_CACHE_TTL_MS, SPEC_CACHE_TOKEN_BUDGET
 */
export const SPEC_CACHE_MAX_ENTRIES = 50;

/**
 * Time-to-live for SpecCache entries (milliseconds)
 *
 * Spec files change infrequently, so 5 minutes balances freshness
 * with cache hit rate.
 *
 * Tuning: Decrease if specs change frequently (rapid iteration)
 * Trade-off: Lower TTL = more disk reads, higher TTL = staler data
 */
export const SPEC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Maximum tokens in SpecCache before eviction
 *
 * Reserves ~25% of context window for spec content. Large specs
 * (10k tokens) won't overflow context.
 *
 * Tuning: Increase if loading many large specs simultaneously
 * Trade-off: Higher budget = less room for other context (memories, hints)
 * Related: MAX_CONTEXT_TOKENS
 */
export const SPEC_CACHE_TOKEN_BUDGET = 50_000;
```

---

## Implementation Results

### Phase 0: Magic Number Replacement (T001-T008)

**T001-T003**: ✅ Create config files

- Created extension/src/config/context.ts
- Created extension/src/config/cache.ts
- Created extension/src/config/index.ts (barrel export)

**T004**: ✅ Partial - ContextHealthMonitor.ts

- Replaced 9 magic numbers with named constants:
  - 100000 → CONTEXT_HEALTHY_THRESHOLD
  - 140000 → CONTEXT_WARNING_THRESHOLD
  - 180000 → CONTEXT_CRITICAL_THRESHOLD
  - 200000 → MAX_CONTEXT_TOKENS
- Before: `if (tokens > 140000)`
- After: `if (tokens > CONTEXT_WARNING_THRESHOLD)`

**T005-T008**: ❌ Deferred to Phase 3

- Remaining magic numbers easier to replace after module extraction
- Will be addressed when refactoring extracted services

**Audit Results**:

- Found 47 magic numbers total
- Replaced 9 in Phase 0 (19%)
- Deferred 38 to Phase 3 (81%)

---

## Testing Strategy

### Unit Tests

```typescript
import { MAX_CACHE_ENTRIES, CACHE_TTL_MS } from '../config/cache';

it('should evict when cache exceeds MAX_CACHE_ENTRIES', () => {
  const cache = new Cache({ maxEntries: MAX_CACHE_ENTRIES });

  for (let i = 0; i < MAX_CACHE_ENTRIES + 1; i++) {
    cache.set(`key${i}`, `value${i}`);
  }

  expect(cache.size).toBe(MAX_CACHE_ENTRIES); // Evicted one
});

it('should allow overriding config for testing', () => {
  vi.mock('../config/cache', () => ({
    MAX_CACHE_ENTRIES: 2, // Override for test
  }));

  const cache = new Cache({ maxEntries: MAX_CACHE_ENTRIES });
  // Test with smaller limit
});
```

### Integration Tests

- Verify config values actually used (not hardcoded elsewhere)
- Test boundary conditions (cache at limit, context at threshold)
- Validate documentation accuracy (tuning guidance works)

---

## Future Enhancements

### Runtime Configuration

For **user-tunable** constants (not development constants):

- Expose via VSCode settings (`gofer.cache.maxEntries`)
- Load from settings, fall back to config defaults
- Validate user inputs (prevent invalid values)

Example:

```typescript
export function getCacheMaxEntries(): number {
  const userValue = vscode.workspace
    .getConfiguration('gofer')
    .get<number>('cache.maxEntries');
  return userValue ?? SPEC_CACHE_MAX_ENTRIES; // Default if not set
}
```

### Configuration Validation

- Schema validation on startup (catch invalid values early)
- Warn if values outside recommended ranges
- Log configuration snapshot for debugging

### Documentation Generation

- Auto-generate config reference doc from JSDoc comments
- Include in extension README or docs site
- Keep documentation in sync with code

---

## References

- [Engineering Review](../../specs/001-gofer-engineering-remediation/ENGINEERING_REVIEW.md) -
  Code Quality section
- [Phase 0 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-0-prerequisites-magic-numbers-p0---critical) -
  T001-T008
- [TypeScript const assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions)
- [Magic Numbers Code Smell](https://refactoring.guru/smells/magic-numbers)

---

## Approval

- **Approved by**: Engineering Team
- **Date**: 2026-02-24
- **Implementation**: Phase 0 (T001-T004 complete, T005-T008 deferred)
- **Status**: Partial implementation, remaining magic numbers deferred to Phase
  3
