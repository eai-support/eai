# ADR-002: Module Extraction Strategy

**Status**: Accepted
**Date**: 2026-02-24
**Deciders**: Engineering Team
**Phase**: Phase 3-4 - God Object Refactoring
**Related Tasks**: T020-T025 (extension.ts), T026-T030 (goferMigrator.ts)

---

## Context

The codebase had two severe God object anti-patterns:

1. **extension.ts**: 1200 LOC monolithic activation function
   - Mixed concerns: initialization, event handling, command registration,
     disposal
   - Dense nested callbacks and promise chains
   - Difficult to test individual responsibilities
   - High cognitive load for maintenance

2. **goferMigrator.ts**: 2499 LOC migration orchestrator
   - 30+ public methods doing unrelated tasks
   - Mixed concerns: version detection, resource syncing, path migration,
     upgrade orchestration
   - No separation between coordination logic and implementation details
   - Impossible to test individual migration steps

These God objects violated Single Responsibility Principle and blocked:

- Unit testing (too many responsibilities to mock)
- Feature velocity (changes in one area affected unrelated code)
- Parallel development (merge conflicts from touching same file)
- Onboarding (understanding 1000+ LOC functions overwhelming)

**Engineering Review Scores**:

- Architecture & Design: **7/10** (God objects primary issue)
- Code Quality: **7/10** (complexity from monolithic structure)

---

## Decision

We will use **phased extraction with facade pattern**:

1. **Extract focused services** from God objects (<600 LOC each)
2. **Keep facades** as orchestrators (preserve public API)
3. **Migrate incrementally** (service by service, not big bang rewrite)
4. **Use DI container** for service composition
5. **Maintain backward compatibility** (no breaking API changes)

**Implementation**:

### Phase 3: extension.ts Extraction (T020-T025)

- T020: DisposalService (disposal logic)
- T021: EventHandlers (workspace events)
- T022: InitializationService (workspace initialization)
- T023: CommandRegistry (command registration)
- T024: Refactor extension.ts as orchestrator

Result: extension.ts 1200 LOC → ~800 LOC (33% reduction)

### Phase 4: goferMigrator.ts Extraction (T026-T030)

- T026: VersionDetector (247 LOC) - format detection, version comparison
- T027: UpgradeService (437 LOC) - upgrade orchestration with progress
- T028: ResourceSyncer (496 LOC) - file/resource synchronization
- T029: PathMigrator (332 LOC) - path reference migration
- T030: Refactor goferMigrator.ts as facade

Result: goferMigrator.ts 2499 LOC → 467 LOC (81% reduction)

---

## Rationale

### Why Phased Extraction?

1. **Risk mitigation**: Each service can be tested independently before
   integration
2. **Incremental progress**: Show progress without waiting for complete rewrite
3. **Easier review**: Small PRs (200-500 LOC) vs. massive rewrite (2000+ LOC)
4. **Maintain stability**: Extension keeps working throughout refactoring
5. **Learn and adapt**: Discover better patterns as we extract

### Why Facade Pattern?

1. **Backward compatibility**: Existing callers see same API
2. **Gradual migration**: Callers can migrate to services when ready
3. **Clear boundary**: Facade shows public API, services are implementation
   details
4. **Simplifies testing**: Mock facades easily, test services in isolation

### Why Service LOC Limits?

- **<600 LOC per service**: Fits on ~2 screens, easier to comprehend
- **Forces focus**: Service must have single, clear responsibility
- **Prevents regression**: Service can't grow back into God object
- **Code review friendly**: Reviewers can understand full service in one sitting

---

## Alternatives Considered

### 1. Big Bang Rewrite

**Approach**: Rewrite entire extension from scratch in new architecture.

**Pros**:

- ✅ Perfect architecture from day one
- ✅ No legacy baggage or compromises
- ✅ Clean slate for naming, patterns, conventions

**Cons**:

- ❌ Months of development with no shipped features
- ❌ High risk (might miss edge cases current code handles)
- ❌ Difficult to test (can't compare behavior to production)
- ❌ Merge conflicts if features land during rewrite
- ❌ Loses institutional knowledge embedded in existing code

**Verdict**: Too risky for production extension with active users.

### 2. Leave As-Is

**Approach**: Keep God objects, address issues with linting/documentation.

**Pros**:

- ✅ Zero refactoring effort
- ✅ No risk of introducing bugs
- ✅ Team already familiar with code

**Cons**:

- ❌ Problems only worsen over time (God objects grow)
- ❌ Continues to block testing improvements
- ❌ Maintenance burden increases
- ❌ Engineering Review scores won't improve

**Verdict**: Unacceptable - technical debt compounds if not addressed.

### 3. Microservices (Separate Processes)

**Approach**: Split extension into multiple processes communicating via IPC.

**Pros**:

- ✅ True isolation between services
- ✅ Independent deployment/versioning
- ✅ Fault isolation (one crash doesn't kill extension)

**Cons**:

- ❌ Massive architectural change (not incremental)
- ❌ Performance overhead (IPC latency)
- ❌ Complex debugging (multiple processes)
- ❌ VSCode extension model doesn't support this pattern
- ❌ Over-engineered for monolithic VSCode extension

**Verdict**: Wrong tool for the job - VSCode extensions are in-process.

### 4. Extract Functions (No Services)

**Approach**: Break God objects into many small functions in same file.

**Pros**:

- ✅ Simple refactoring (just move code)
- ✅ No DI overhead
- ✅ Easy to understand (all in one file)

**Cons**:

- ❌ Still have 1000+ LOC files (hard to navigate)
- ❌ No dependency management (functions share file-level state)
- ❌ Difficult to test (functions not isolated)
- ❌ Doesn't solve God object problem (just God file instead)

**Verdict**: Insufficient - doesn't achieve separation goals.

---

## Consequences

### Positive

1. **Testability**: Services can be unit tested in isolation (easier mocking)
2. **Maintainability**: <600 LOC services fit in mental model
3. **Velocity**: Parallel development (different services, no conflicts)
4. **Onboarding**: New developers understand one service at a time
5. **Code quality**: Forces adherence to Single Responsibility Principle
6. **Risk reduction**: Incremental changes tested in production before next step
7. **Clear boundaries**: Service interfaces make dependencies explicit

### Negative

1. **Temporary duplication**: During migration, some code exists in both places
2. **Extra indirection**: Facades add one level of call depth
3. **Migration effort**: Each God object extraction takes 1-2 days
4. **Breaking changes risk**: Must preserve exact API behavior during migration
5. **Testing overhead**: Must test both facade delegation AND service
   implementation

### Neutral

1. **File count increase**: 2 God files become 10+ service files (more
   navigation)
2. **Import overhead**: More `import` statements in facades
3. **Container dependency**: Services must be registered in DI container

---

## Implementation Results

### extension.ts Extraction (Phase 3)

**Before**:

- 1200 LOC in single activate() function
- Mixed initialization, events, commands, disposal
- 80% code coverage difficult due to coupling

**After**:

- ~800 LOC facade (33% reduction)
- 4 focused services: DisposalService, EventHandlers, InitializationService,
  CommandRegistry
- Each service <300 LOC, testable independently
- Same public API (backward compatible)

### goferMigrator.ts Extraction (Phase 4)

**Before**:

- 2499 LOC God object
- 30+ public methods, no clear separation
- Impossible to test migration steps individually

**After**:

- 467 LOC facade (81% reduction)
- 4 focused services: VersionDetector (247 LOC), UpgradeService (437 LOC),
  ResourceSyncer (496 LOC), PathMigrator (332 LOC)
- All services under 600 LOC target
- Same public API (backward compatible)
- Services independently testable

**Total Reduction**: 3699 LOC → 1267 LOC (66% reduction in God object code)

---

## Lessons Learned

### What Worked Well

1. **IResourceOperations interface**: Allowed UpgradeService creation before
   ResourceSyncer existed
2. **Backing up originals**: Kept `.old.ts` files for reference during
   migration
3. **Compilation as validation**: TypeScript caught missing methods
   immediately
4. **Parallel extraction**: T027-T029 developed concurrently (3x faster than
   sequential)

### What We'd Do Differently

1. **Earlier interface extraction**: Define interfaces first, implement later
   (enables parallel work)
2. **Test migration alongside code**: Some tests broke due to API changes not
   caught early
3. **Document runtime configuration needs**: setWorkspacePath() pattern
   discovered mid-migration

### Future Applications

- **Cache services** (Phase 2): Extract SpecCache, MemoryCache using same
  pattern
- **Other God objects**: Apply to any future 500+ LOC classes
- **Service boundaries**: Use <600 LOC limit as design guideline going forward

---

## References

- [Engineering Review](../../specs/001-gofer-engineering-remediation/ENGINEERING_REVIEW.md) -
  Architecture section
- [Phase 3 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-3-god-object-refactoring---extensionts) -
  T020-T025
- [Phase 4 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-4-god-object-refactoring---gofermigratorts) -
  T026-T030
- [Facade Pattern](https://refactoring.guru/design-patterns/facade)
- [God Object Anti-Pattern](https://sourcemaking.com/antipatterns/the-blob)

---

## Approval

- **Approved by**: Engineering Team
- **Date**: 2026-02-24
- **Implementation**: Phase 3 (T020-T025), Phase 4 (T026-T030)
- **Status**: Successfully delivered - 66% God object LOC reduction
