B# ADR-004: Cache Eviction Strategy

**Status**: Accepted
**Date**: 2026-02-24
**Deciders**: Engineering Team
**Phase**: Phase 2 - Cache Infrastructure
**Related Tasks**: T017-T019 (Cache Eviction)

---

## Context

The codebase had **unbounded cache growth** leading to memory leaks:

**Problem Caches**:

1. **SpecCache**: Loaded spec.md and tasks.md files, never evicted
2. **MemoryManager**: Indexed memories from JSONL files, unbounded growth
3. **Research Index**: Cached research findings, no size limits
4. **File Watchers**: Created watchers but never disposed, accumulated over time

**Impact**:

- Memory usage grew linearly with workspace size
- VSCode instances crashed after hours of use (>5 workspaces)
- No mechanism to free memory under pressure
- Cache invalidation bugs (stale data served indefinitely)

**Engineering Review Score**: Performance & Scalability **7/10** (cache
eviction primary issue)

**Real-world failure** (v1.12.2):

- Multiple workspace folder changes created duplicate file watchers
- Each watcher had 60s timers, accumulating to 50+ concurrent timers
- Memory exhaustion crashed VSCode with 5+ instances

---

## Decision

We will implement **hybrid cache eviction** using:

1. **LRU (Least Recently Used)**: Evict least-accessed entries when size limit
   reached
2. **TTL (Time To Live)**: Evict entries after fixed lifetime (prevent stale
   data)
3. **Token Budget**: Evict when estimated token usage exceeds threshold
   (context-aware)
4. **Explicit Invalidation**: Allow manual cache clearing on relevant events

**Implementation**:

```typescript
interface CacheConfig {
  maxEntries: number; // LRU limit
  ttlMs: number; // Time to live
  maxTokens: number; // Token budget
}

class Cache<K, V> {
  private entries: Map<K, CacheEntry<V>>;

  public get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }

    // Update LRU timestamp
    entry.lastAccess = Date.now();
    return entry.value;
  }

  public set(key: K, value: V): void {
    // Evict if over limits
    this.evictIfNeeded();

    this.entries.set(key, {
      value,
      timestamp: Date.now(),
      lastAccess: Date.now(),
      tokens: estimateTokens(value),
    });
  }

  private evictIfNeeded(): void {
    // Evict by token budget
    if (this.totalTokens() > this.config.maxTokens) {
      this.evictLRU();
    }

    // Evict by entry count
    if (this.entries.size >= this.config.maxEntries) {
      this.evictLRU();
    }
  }

  private evictLRU(): void {
    const lruEntry = [...this.entries.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    this.entries.delete(lruEntry[0]);
  }
}
```

---

## Rationale

### Why LRU?

1. **Predictable size**: Hard limit on entries prevents unbounded growth
2. **Locality of reference**: Recent access predicts future access (cache hit
   rate)
3. **Simple to implement**: O(1) access + eviction with Map + timestamp
4. **Industry standard**: Proven pattern in HTTP caches, CPU caches, databases

### Why TTL?

1. **Prevents stale data**: Spec files change, must re-read
2. **Time-based invalidation**: Some data inherently expires (e.g., auth
   tokens)
3. **Complements LRU**: Hot entries stay fresh, cold entries expire naturally
4. **Configurable freshness**: Different caches have different staleness
   tolerance

### Why Token Budget?

1. **Context window aware**: Gofer's primary resource is LLM context, not RAM
2. **Dynamic sizing**: Large specs count more than small ones
3. **Prevents context overflow**: Stop loading before hitting 200k token limit
4. **Aligns with use case**: Spec cache for feeding context to LLMs

### Why All Three?

Different workloads need different eviction triggers:

- **LRU**: Protects against many small entries (100 tiny specs)
- **TTL**: Protects against stale data (spec edited, still cached)
- **Token budget**: Protects against few huge entries (3 massive specs)

Using all three handles edge cases that any single strategy misses.

---

## Alternatives Considered

### 1. No Eviction (Status Quo)

**Approach**: Load into cache, never evict.

**Pros**:

- ✅ Simple implementation (no eviction logic)
- ✅ Maximum cache hit rate (everything cached forever)
- ✅ Predictable performance (cache always warm)

**Cons**:

- ❌ Memory leaks (unbounded growth)
- ❌ Stale data (no invalidation)
- ❌ VSCode crashes (OOM errors)
- ❌ Production failure (v1.12.2 memory leak)

**Verdict**: Unacceptable - proven to cause crashes.

### 2. LRU Only

**Approach**: Evict least recently used when size limit reached.

**Pros**:

- ✅ Bounded memory usage
- ✅ Simple to implement
- ✅ Good cache hit rates

**Cons**:

- ❌ No staleness protection (hot stale data stays forever)
- ❌ Size limit arbitrary (100 entries? 1000? why?)
- ❌ Doesn't account for entry size (1 huge entry = 1 tiny entry)

**Verdict**: Insufficient - stale data remains a risk.

### 3. TTL Only

**Approach**: Evict entries after fixed lifetime (e.g., 5 minutes).

**Pros**:

- ✅ Prevents stale data
- ✅ Simple to implement
- ✅ Predictable freshness

**Cons**:

- ❌ No size limit (many entries created in < TTL = unbounded)
- ❌ Wastes memory (cold entries sit until TTL expires)
- ❌ Arbitrary TTL (5min? 1hr? depends on use case)

**Verdict**: Insufficient - doesn't prevent unbounded growth.

### 4. FIFO (First-In-First-Out)

**Approach**: Evict oldest entry when size limit reached.

**Pros**:

- ✅ Simple to implement (queue)
- ✅ Bounded memory usage
- ✅ Predictable behavior

**Cons**:

- ❌ Ignores access patterns (evicts hot old entries)
- ❌ Worse cache hit rate than LRU
- ❌ No staleness protection

**Verdict**: Inferior to LRU for cache use case.

### 5. Adaptive Sizing (Dynamic Limits)

**Approach**: Adjust cache size based on available memory.

**Pros**:

- ✅ Maximizes cache usage under low memory pressure
- ✅ Degrades gracefully under high memory pressure
- ✅ No fixed limits (adapts to environment)

**Cons**:

- ❌ Complex to implement (memory monitoring, heuristics)
- ❌ Unpredictable behavior (limits change at runtime)
- ❌ Difficult to test (environment-dependent)
- ❌ Doesn't solve staleness problem

**Verdict**: Over-engineered - fixed limits sufficient for now.

---

## Consequences

### Positive

1. **Bounded memory**: Hard limits prevent runaway growth
2. **Freshness**: TTL ensures data doesn't go stale
3. **Context-aware**: Token budgets align with LLM use case
4. **Testability**: Eviction logic testable (set limits, verify eviction)
5. **Performance**: Cache hit rate remains high with proper tuning
6. **Reliability**: Prevents OOM crashes seen in production

### Negative

1. **Cache misses**: Eviction means some reads hit disk (trade-off for
   stability)
2. **Tuning required**: Limits must be configured per cache (not one-size-fits-all)
3. **Complexity**: Hybrid strategy more complex than single-strategy
4. **Token estimation**: Estimating tokens imprecise (can over/underestimate)

### Neutral

1. **Monitoring needed**: Must log cache hit rates to validate tuning
2. **Eviction overhead**: ~O(n) to find LRU entry (acceptable for small caches)

---

## Implementation Guidelines

### Cache Configuration

**SpecCache** (spec.md, tasks.md files):

- **maxEntries**: 50 (workspace rarely has >50 specs)
- **ttlMs**: 300000 (5 minutes - specs change infrequently)
- **maxTokens**: 50000 (reserve 25% of context for specs)

**MemoryManager** (indexed memories):

- **maxEntries**: 100 (typical workspace has ~100 relevant memories)
- **ttlMs**: 600000 (10 minutes - memories change infrequently)
- **maxTokens**: 30000 (reserve 15% of context for memories)

**ResearchIndex** (research findings):

- **maxEntries**: 20 (usually <20 features researched in session)
- **ttlMs**: 1800000 (30 minutes - research stale after this)
- **maxTokens**: 40000 (research can be verbose)

### Tuning Approach

1. **Start conservative**: Low limits, monitor hit rates
2. **Measure**: Log cache hits, misses, evictions
3. **Adjust**: Increase limits if hit rate <80%
4. **Validate**: Verify memory usage stays bounded under load
5. **Document**: Record tuning rationale in comments

### Token Estimation

```typescript
function estimateTokens(content: string): number {
  // Rough approximation: 1 token ~= 4 characters
  // More accurate: use tiktoken library (adds 200KB to bundle)
  return Math.ceil(content.length / 4);
}
```

### Invalidation Events

Explicitly invalidate caches on:

- **File watcher events**: spec.md modified → invalidate SpecCache entry
- **Git branch change**: New branch → invalidate all caches
- **Manual refresh**: User command → invalidate specific cache
- **Extension restart**: Workspace reopened → start with cold cache

---

## Testing Strategy

### Unit Tests

```typescript
it('should evict LRU entry when maxEntries exceeded', () => {
  const cache = new Cache({ maxEntries: 2, ttlMs: 10000, maxTokens: 10000 });

  cache.set('a', 'value-a');
  cache.set('b', 'value-b');
  cache.get('a'); // Make 'a' more recent

  cache.set('c', 'value-c'); // Should evict 'b' (LRU)

  expect(cache.get('a')).toBe('value-a');
  expect(cache.get('b')).toBeUndefined(); // Evicted
  expect(cache.get('c')).toBe('value-c');
});

it('should evict entry when TTL expired', async () => {
  const cache = new Cache({ maxEntries: 100, ttlMs: 100, maxTokens: 10000 });

  cache.set('key', 'value');
  await new Promise((resolve) => setTimeout(resolve, 150)); // Wait for TTL

  expect(cache.get('key')).toBeUndefined(); // Expired
});

it('should evict when token budget exceeded', () => {
  const cache = new Cache({ maxEntries: 100, ttlMs: 10000, maxTokens: 100 });

  cache.set('small', 'x'.repeat(50)); // ~13 tokens
  cache.set('large', 'x'.repeat(400)); // ~100 tokens (over budget)

  expect(cache.get('small')).toBeUndefined(); // Evicted to make room
  expect(cache.get('large')).toBeDefined();
});
```

### Integration Tests

- **Memory leak test**: Create 1000 cache entries, verify memory bounded
- **Staleness test**: Modify spec.md, verify cache returns fresh data
- **Multi-workspace test**: 5 workspaces, verify no watcher accumulation

---

## Implementation Status

### Phase 2: Cache Infrastructure (T017-T019)

**T017**: ✅ Analyze existing cache patterns

- Identified SpecCache, MemoryManager, ResearchIndex as targets
- Found unbounded growth in all three
- Documented memory leak from file watchers (led to v1.12.3 fix)

**T018**: ❌ Pending - Add LRU+TTL eviction to SpecCache

- Implement Cache<K, V> base class
- Configure for SpecCache use case
- Add cache hit/miss metrics

**T019**: ❌ Pending - Add eviction to MemoryManager, ResearchIndex

- Apply Cache<K, V> pattern to both
- Tune limits based on typical workspace size
- Integration test with 5 workspaces

**Expected outcome**: 0 unbounded caches, memory stays <200MB per workspace

---

## Future Enhancements

### Persistent Caching

- **Goal**: Survive extension restarts (faster warmup)
- **Storage**: `.specify/.cache/` (gitignored)
- **Format**: JSONL for incremental load
- **Invalidation**: Checksum files to detect changes

### Cache Warming

- **Goal**: Proactively load likely-needed specs
- **Heuristic**: Load specs from current + recent branches
- **Timing**: During idle time (not on activation)

### Multi-Level Caching

- **L1 (Memory)**: Hot data, fast access, small size
- **L2 (Disk)**: Warm data, medium access, larger size
- **L3 (Network)**: Cold data, slow access, unlimited size (future: remote
  spec repository)

---

## References

- [Engineering Review](../../specs/001-gofer-engineering-remediation/ENGINEERING_REVIEW.md) -
  Performance section
- [Phase 2 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-2-cache-eviction-p1---high) -
  T017-T019
- [v1.12.3 Memory Leak Fix](../../../../MEMORY.md#critical-memory-leak-from-duplicate-workspace-listeners-and-missing-cleanup-v1123-fix)
- [LRU Cache Pattern](https://en.wikipedia.org/wiki/Cache_replacement_policies#Least_recently_used_(LRU))

---

## Approval

- **Approved by**: Engineering Team
- **Date**: 2026-02-24
- **Implementation**: Phase 2 (T017 complete, T018-T019 pending)
- **Priority**: P1 - Critical for production stability (memory leaks resolved)
