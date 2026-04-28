# ADR-003: Error Handling Strategy

**Status**: Accepted
**Date**: 2026-02-24
**Deciders**: Engineering Team
**Phase**: Phase 1 - Logger Service, Phase 3-4 - Error Handler Replacement
**Related Tasks**: T011 (Logger), T013-T016 (Error Handler Replacement)

---

## Context

The codebase had **47 silent error handlers** that swallowed exceptions without
logging:

```typescript
// Anti-pattern: Silent error handler
try {
  await riskyOperation();
} catch {
  // Error swallowed - no logging, no user feedback
}
```

**Problems**:

1. **Debugging nightmare**: Failures invisible in logs, impossible to diagnose
2. **Silent failures**: Users unaware operations failed, data loss possible
3. **Production mysteries**: "It doesn't work" reports with no error trail
4. **Masking real bugs**: Exceptions indicate bugs, silencing prevents
   discovery
5. **Compliance risk**: No audit trail for failures in critical operations

**Engineering Review Score**: Error Handling **7/10** (silent handlers primary
issue)

**Examples of silent failures**:

- File sync operations failing silently
- Migration steps skipped without notice
- Cache writes failing without fallback
- Configuration loads failing with stale data

---

## Decision

We will replace all silent error handlers with **explicit logging via Logger
service**:

1. **Log all exceptions**: Use `Logger.error()` for every caught exception
2. **Contextual metadata**: Include operation name, inputs, stack traces
3. **User feedback**: Surface critical errors to users via
   `vscode.window.showErrorMessage()`
4. **Structured logging**: JSON-formatted logs for parsing/aggregation
5. **No swallowing**: Every exception either logged or re-thrown

**Implementation Pattern**:

```typescript
try {
  await riskyOperation(input);
  logger.info('OperationContext', 'Operation succeeded', { input });
} catch (error) {
  logger.error('OperationContext', error as Error, {
    operation: 'riskyOperation',
    input,
  });
  // User feedback for critical failures
  vscode.window.showErrorMessage(`Operation failed: ${(error as Error).message}`);
  // Re-throw if caller should handle
  throw error;
}
```

---

## Rationale

### Why Logger Service?

1. **Centralized formatting**: Consistent log format across extension
2. **Testability**: Can inject mock logger to verify error handling
3. **Level control**: Can filter debug vs. error logs
4. **Metadata support**: Structured context for post-mortem analysis
5. **Future extensibility**: Can add remote logging, metrics later

### Why Explicit Logging?

1. **Observability**: Every failure leaves audit trail
2. **Debuggability**: Stack traces + context enable root cause analysis
3. **User trust**: Transparent about failures vs. hiding them
4. **Compliance**: Audit trails for data operations
5. **Quality feedback**: Logs reveal bugs to fix

### Why Not Silent Handlers?

Silent handlers (empty `catch {}`) are **never** justified because:

1. **Violates fail-fast**: Errors indicate bugs, must be investigated
2. **Masks corruption**: Partial state changes go unnoticed
3. **False success**: Operation appears successful but actually failed
4. **Debugging impossibility**: No evidence of what went wrong

**Exception**: Truly optional operations (e.g., cache lookup) can fail silently
BUT must still log at debug level.

---

## Alternatives Considered

### 1. Global Error Handler

**Approach**: Catch all unhandled exceptions in global handler.

**Pros**:

- ✅ Single error handling implementation
- ✅ Never miss an exception (automatic fallback)
- ✅ Easy to add telemetry/metrics

**Cons**:

- ❌ Loses operation context (don't know what was attempted)
- ❌ Can't provide specific user feedback
- ❌ Difficult to test (global state)
- ❌ Doesn't solve silent handler problem (catch blocks still needed)

**Verdict**: Insufficient - complements but doesn't replace local handling.

### 2. Propagate All Errors (No Catching)

**Approach**: Never catch exceptions, let them bubble to caller.

**Pros**:

- ✅ Forces caller to handle errors explicitly
- ✅ No hidden error handling
- ✅ Simple (no try-catch blocks)

**Cons**:

- ❌ VSCode extension crashes on unhandled exceptions
- ❌ Can't provide contextual user feedback
- ❌ Impossible to gracefully degrade (fail-fast only)
- ❌ Makes optional operations difficult (cache, telemetry)

**Verdict**: Too extreme - need graceful degradation for non-critical paths.

### 3. Result Types (No Exceptions)

**Approach**: Return `Result<T, Error>` instead of throwing.

**Pros**:

- ✅ Errors explicit in type signature
- ✅ Forces caller to handle via type system
- ✅ No hidden control flow (exceptions)

**Cons**:

- ❌ Doesn't interop with existing Promise-based code
- ❌ Verbose (`if (result.isErr()) { ... }` everywhere)
- ❌ Not idiomatic TypeScript (exceptions standard)
- ❌ Massive refactor to adopt (10000+ LOC change)

**Verdict**: Better for new greenfield code, too disruptive for migration.

### 4. Console Logging Only

**Approach**: Use `console.error()` instead of Logger service.

**Pros**:

- ✅ No custom infrastructure needed
- ✅ Works out of box
- ✅ Familiar API

**Cons**:

- ❌ No structured metadata (plain strings only)
- ❌ Not testable (can't mock console)
- ❌ No level control (all logs always visible)
- ❌ No extension integration (doesn't use VSCode output channels)

**Verdict**: Insufficient - need structured, testable logging.

---

## Consequences

### Positive

1. **Observability**: Every failure logged with context for diagnosis
2. **Debuggability**: Stack traces + metadata enable quick root cause analysis
3. **User feedback**: Critical errors surfaced to users appropriately
4. **Testing**: Mock logger enables verification of error handling paths
5. **Quality**: Error logs reveal bugs to fix (previously hidden)
6. **Trust**: Transparency builds user confidence (vs. mysterious failures)

### Negative

1. **Noise**: More logging increases output volume (need filtering)
2. **Performance**: Logging overhead on exception paths (~1-5ms per log)
3. **Maintenance**: Must update error handlers as code changes
4. **Verbosity**: Try-catch blocks add LOC (but necessary complexity)

### Neutral

1. **Code size**: ~30% more LOC in functions with error handling (acceptable
   trade-off)
2. **Testing overhead**: Must test both success and error paths

---

## Implementation Guidelines

### When to Catch

**Always catch**:

- I/O operations (file, network, IPC)
- User input parsing/validation
- External dependencies (vscode API, npm packages)
- State mutations (cache updates, config writes)

**Never catch without logging**:

- Pure functions (shouldn't throw)
- Async operations (must handle Promise rejections)

### Log Levels

| Level   | When to Use                               | Example                         |
| ------- | ----------------------------------------- | ------------------------------- |
| error() | Operation failed, may impact user         | File sync failed                |
| warn()  | Degraded mode but functional              | Cache write failed, using stale |
| info()  | Significant operations completed          | Migration successful            |
| debug() | Verbose diagnostics (disabled in prod)    | Cache hit                       |

### Metadata Guidelines

Always include:

- **operation**: What was attempted (e.g., 'syncMissingResources')
- **context**: Relevant IDs, paths, inputs
- **error**: Full Error object (message + stack)

Example:

```typescript
logger.error('ResourceSyncer', error as Error, {
  operation: 'copyBundledResources',
  resourceType: 'claude-commands',
  targetPath: '/path/to/target',
  fileCount: 10,
});
```

### User Feedback

Surface errors to users when:

- ✅ Critical operation failed (must retry or cancel)
- ✅ User action required (e.g., permission denied)
- ✅ Data loss possible (e.g., migration failed)

Don't surface when:

- ❌ Background operation (cache, telemetry)
- ❌ Retry will happen automatically
- ❌ Graceful degradation active

---

## Implementation Results

### Phase 1: Logger Service (T011)

- ✅ Created Logger service with error(), warn(), info(), debug() methods
- ✅ Structured metadata support via Record<string, unknown>
- ✅ Registered as singleton in DI container
- ✅ Used in all new services (UpgradeService, ResourceSyncer, etc.)

### Phase 3: Error Handler Replacement (T013-T016)

**Goal**: Replace 47 silent error handlers across codebase

**Progress**:

- T013: ✅ Audit all empty catch blocks (found 47)
- T014: ❌ Pending - Replace in extension.ts (~10 handlers)
- T015: ❌ Pending - Replace in goferMigrator.ts (~15 handlers, done via
  service extraction)
- T016: ❌ Pending - Replace in remaining files (~22 handlers)

**Expected outcome**: 0 silent handlers remaining

---

## Testing Strategy

### Unit Tests

```typescript
it('should log error when operation fails', async () => {
  const mockLogger = {
    error: vi.fn(),
  };
  const service = new MyService(mockLogger);

  await expect(service.riskyOperation()).rejects.toThrow();

  expect(mockLogger.error).toHaveBeenCalledWith('MyService', expect.any(Error), {
    operation: 'riskyOperation',
  });
});
```

### Integration Tests

- Verify error logs written to output channel
- Verify user error messages displayed
- Verify graceful degradation on non-critical failures

---

## Future Enhancements

### Structured Logging

- **Goal**: Parse logs for metrics/alerting
- **Format**: JSONL (JSON Lines) for easy ingestion
- **Storage**: `.specify/logs/extension.jsonl`
- **Retention**: Rotate logs daily, keep 7 days

### Telemetry

- **Goal**: Aggregate error rates by operation
- **Privacy**: Opt-in, anonymized stack traces
- **Dashboard**: Visualize error trends over time

### User-Facing Error Reports

- **Goal**: "Report Issue" button in error notifications
- **Content**: Auto-populate GitHub issue with logs, context
- **Privacy**: Redact sensitive paths, user data

---

## References

- [Engineering Review](../../specs/001-gofer-engineering-remediation/ENGINEERING_REVIEW.md) -
  Error Handling section
- [Phase 1 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#phase-1-dependency-injection-infrastructure-p1---high) -
  T011 (Logger)
- [Phase 3 Tasks](../../specs/001-gofer-engineering-remediation/tasks.md#us4-observability---replace-silent-error-handlers) -
  T013-T016
- [Logger Service](../../extension/src/services/Logger.ts)

---

## Approval

- **Approved by**: Engineering Team
- **Date**: 2026-02-24
- **Implementation**: Phase 1 (T011), Phase 3 (T013-T016 in progress)
- **Impact**: Eliminates silent failures, improves debuggability significantly
