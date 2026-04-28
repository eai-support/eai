# ADR-001: Dependency Injection Framework

**Status**: Accepted
**Date**: 2026-02-24
**Deciders**: Engineering Team
**Phase**: Phase 1 - Dependency Injection Infrastructure
**Related Tasks**: T009, T010

---

## Context

The Gofer extension suffered from pervasive global state and tight coupling:

- **God objects**: `extension.ts` (1200 LOC) and `goferMigrator.ts` (2499 LOC)
  with excessive responsibilities
- **Global mutable state**: Services stored in module-level variables, making
  testing difficult
- **Tight coupling**: Direct instantiation with `new` throughout the codebase
- **Hidden dependencies**: Service dependencies not explicit in constructors
- **Testing challenges**: Difficult to mock dependencies or reset state between
  tests

These issues led to:

- Poor testability (mocking required global state manipulation)
- Fragile refactoring (changes rippled unpredictably)
- Concurrency bugs (shared mutable state without coordination)
- Difficulty reasoning about service lifecycles

We needed a dependency injection framework to:

1. Make dependencies explicit via constructor injection
2. Enable singleton lifecycle management
3. Facilitate testing through dependency mocking
4. Support incremental refactoring without breaking existing code

---

## Decision

We will use **TSyringe** as our dependency injection container.

**Implementation**:

- Services decorated with `@injectable()`
- Container configured in `extension/src/di/container.ts`
- Singletons registered in `registerServices()` function
- Container resolved via `getContainer()` accessor
- Test isolation via `resetContainer()` utility

**Example**:

```typescript
// Service definition
@injectable()
export class Logger {
  public info(context: string, message: string): void {
    /* ... */
  }
}

// Container registration
import { container } from 'tsyringe';
container.registerSingleton(Logger);

// Service resolution
const logger = container.resolve(Logger);
```

---

## Rationale

### Why TSyringe?

1. **Lightweight**: Minimal API surface (~5 core methods)
2. **TypeScript-native**: Built specifically for TypeScript with strong typing
3. **Zero-config**: Works out-of-the-box with standard decorators
4. **Microsoft-backed**: Official Microsoft project, well-maintained
5. **VSCode proven**: Used successfully in other VSCode extensions
6. **Incremental adoption**: Can adopt gradually without rewriting everything

### Why not alternatives?

**InversifyJS**:

- ❌ Heavier weight (~3x larger bundle size)
- ❌ More complex API (requires binding syntax, custom decorators)
- ❌ Steeper learning curve for team
- ✅ More features (multi-injection, contextual bindings)
- **Verdict**: Over-engineered for our needs

**Manual Factory Pattern**:

- ✅ No external dependencies
- ❌ Verbose boilerplate (factory functions for every service)
- ❌ Manual lifecycle management (no automatic singletons)
- ❌ No metadata-based injection (lose decorator benefits)
- **Verdict**: Too much manual work

**TypeDI**:

- ✅ Similar API to TSyringe
- ❌ Less active maintenance (last major release 2019)
- ❌ Smaller community
- ❌ Not Microsoft-backed
- **Verdict**: Less confidence in long-term support

**No DI Framework (status quo)**:

- ✅ No new dependencies
- ❌ Continues existing problems (global state, tight coupling)
- ❌ Blocks all other refactoring efforts
- **Verdict**: Unacceptable - problems only worsen over time

---

## Consequences

### Positive

1. **Explicit dependencies**: Constructor signatures now document dependencies
   clearly
2. **Testability improved**: Can inject mocks via `container.register()` in
   tests
3. **Singleton management**: Container handles instance lifecycle automatically
4. **Incremental refactoring**: Can migrate services one at a time
5. **Type safety**: TypeScript enforces dependency types at compile-time
6. **Reduced coupling**: Services depend on abstractions, not concrete
   implementations

### Negative

1. **Build configuration**: Requires `experimentalDecorators` and
   `emitDecoratorMetadata` in tsconfig.json
2. **Runtime dependency**: Adds `tsyringe` (~50KB) and `reflect-metadata`
   (~20KB) to bundle
3. **Learning curve**: Team must understand DI concepts and TSyringe API
4. **Decorator overhead**: Metadata reflection adds small runtime cost
5. **Breaking change risk**: Migrating existing services requires careful
   coordination

### Neutral

1. **Import overhead**: Must import `reflect-metadata` at extension entry point
2. **Testing pattern**: Tests must call `resetContainer()` for isolation
3. **Resolution syntax**: `container.resolve(Service)` instead of `new Service()`

---

## Implementation Notes

### Phase 1 (Completed)

- ✅ Installed `tsyringe` and `reflect-metadata`
- ✅ Enabled decorator support in tsconfig.json
- ✅ Created `extension/src/di/container.ts` with registration functions
- ✅ Registered core services: Logger, DisposalService, EventHandlers,
  InitializationService, CommandRegistry, StateManager

### Phase 4 (Completed)

- ✅ Registered migration services: VersionDetector, UpgradeService,
  ResourceSyncer, PathMigrator
- ✅ Migrated goferMigrator.ts to use DI (reduced from 2499 LOC to 467 LOC)

### Future Phases

- **Phase 2-3**: Register cache services (SpecCache, MemoryCache) when extracted
- **Testing**: Create helper utilities for container mocking in test setup

---

## References

- [TSyringe GitHub](https://github.com/microsoft/tsyringe)
- [TSyringe Documentation](https://github.com/microsoft/tsyringe#readme)
- [Engineering Review](../../specs/001-gofer-engineering-remediation/ENGINEERING_REVIEW.md) -
  Architecture section
- [Phase 1 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-1-dependency-injection-infrastructure-p1---high) -
  T009, T010

---

## Approval

- **Approved by**: Engineering Team
- **Date**: 2026-02-24
- **Implementation**: Phase 1 (T009-T010), Phase 4 (T026-T030)
