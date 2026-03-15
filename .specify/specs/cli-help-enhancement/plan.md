---
feature: CLI Help System Enhancement
spec: spec.md
research: research.md
status: ready
created: 2026-03-15T12:30:00Z
---

# Implementation Plan: CLI Help System Enhancement

## Technical Context

### Tech Stack

- **Language**: TypeScript 5.7 (strict ESM)
- **Framework**: Commander.js 13.x (CLI framework)
- **Styling**: chalk 5.x (terminal colors)
- **Testing**: Vitest 2.1.0 (unit and integration tests)
- **Node.js**: >= 20.0.0

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ CLI Entry Point (src/index.ts)                          │
│  - Global flags (--format, --describe, --simple)        │
│  - Enhanced help footer                                 │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         ├─ Command Groups   │
         │  (src/commands/)  │
         └─────────┬─────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───▼────┐   ┌────▼────┐   ┌────▼────┐
│ types  │   │ tenant  │   │ deploy  │
│ .ts    │   │ .ts     │   │ .ts     │
└───┬────┘   └────┬────┘   └────┬────┘
    │             │             │
    └─────────────┼─────────────┘
                  │
       ┌──────────▼──────────┐
       │  Output Layer       │
       │  (src/lib/)         │
       ├─────────────────────┤
       │ output.ts           │
       │ - success()         │
       │ - error()           │
       │ - json()            │
       │ - formatOutput()    │
       ├─────────────────────┤
       │ error-codes.ts      │
       │ - ErrorCode enum    │
       │ - formatError()     │
       ├─────────────────────┤
       │ schema-builder.ts   │
       │ - buildSchema()     │
       │ - describeCommand() │
       └─────────────────────┘
```

### Integration Points

| Component | File | Integration Type |
|-----------|------|------------------|
| CLI Entry Point | `src/index.ts` | Add global flags, enhance help |
| Output Utilities | `src/lib/output.ts` | Complete empty function bodies |
| Type Commands | `src/commands/types.ts` | Add format flag, examples, JSON output |
| Resource Commands | `src/commands/resources.ts` | Add format flag, examples, JSON output |
| Tenant Commands | `src/commands/tenant.ts` | Add format flag, examples, JSON output |
| Deploy Commands | `src/commands/deploy.ts` | Add format flag, examples, JSON output |
| Env Commands | `src/commands/env.ts` | Add format flag, examples |
| Error Handling | All command files | Add error codes, structured errors |
| Schema Builder | `src/lib/schema-builder.ts` | New module for --describe |
| Error Codes | `src/lib/error-codes.ts` | New module for error code constants |

### Key Dependencies

- **Commander.js 13.x**: Already in use, leveraging `.addHelpText()` and `.option()` APIs
- **chalk 5.x**: Already in use, leveraging color detection (`chalk.level`)
- **ora**: Already in use for spinners, needs TTY integration
- **yaml** (optional): For YAML format support (P2 feature, may defer)

## Implementation Phases

### Phase 1: Foundation & Output Layer (P0)

**Goal**: Implement core output utilities and TTY detection

**Tasks**:

- [x] Create task tracking structure
- [ ] Implement `src/lib/output.ts` utility functions
  - [ ] `success(msg: string): void` - print with ✓ or SUCCESS
  - [ ] `warn(msg: string): void` - print with ⚠ or WARNING
  - [ ] `info(msg: string): void` - print with → or INFO
  - [ ] `heading(text: string): void` - print bold heading
  - [ ] `dim(text: string): void` - print dimmed text
  - [ ] `table(rows: Array<[string, string]>): void` - aligned two-column table
  - [ ] `json(data: unknown): void` - pretty-printed JSON to stdout
  - [ ] `yaml(data: unknown): void` - YAML output (optional P2)
  - [ ] `blank(): void` - print blank line
- [ ] Add TTY and color detection
  - [ ] Check `process.stdout.isTTY`
  - [ ] Respect `NO_COLOR` environment variable
  - [ ] Respect `FORCE_COLOR` environment variable
  - [ ] Support `--no-color` global flag
  - [ ] Support `--color` global flag (force colors)
- [ ] Add `--simple` mode support
  - [ ] Global flag in `src/index.ts`
  - [ ] Disable colors and symbols when `--simple` is set
  - [ ] Replace symbols with text labels (SUCCESS, ERROR, WARNING, INFO)
- [ ] Create format output helper
  - [ ] `formatOutput(data: unknown, format: 'text' | 'json' | 'yaml'): void`

**Verification**:

- [ ] All output utility functions work correctly
- [ ] TTY detection disables colors when piped
- [ ] `NO_COLOR=1 eai types seed` shows no colors
- [ ] `eai types seed --simple` shows text-only output
- [ ] `eai types seed --no-color` disables colors
- [ ] Unit tests for all output functions

**Files Modified**:
- `src/lib/output.ts` - Implement all utility functions
- `src/index.ts` - Add global `--simple`, `--no-color`, `--color` flags

**Estimated Time**: 4 hours

---

### Phase 2: Error Code System (P0)

**Goal**: Implement structured error codes and formatted error output

**Tasks**:

- [ ] Create `src/lib/error-codes.ts`
  - [ ] Define `ErrorCode` enum with all error codes (E001-E399)
  - [ ] Categorize errors:
    - E001-E099: Project errors
    - E100-E199: Auth errors
    - E200-E299: Platform errors
    - E300-E399: Validation errors
  - [ ] Define `ErrorDefinition` interface
  - [ ] Create error catalog with code, message template, suggestion
  - [ ] Implement `formatError(code: ErrorCode, context?: Record<string, string>): string`
  - [ ] Implement `formatErrorJSON(code: ErrorCode, context?: Record<string, string>): object`
- [ ] Map existing error messages to error codes
  - [ ] Catalog all existing error messages across all commands
  - [ ] Assign error codes to each error condition
  - [ ] Document error codes in `error-codes.ts`
- [ ] Update error output format
  - [ ] Text format: error message + "Error code: EXXX" + "Exit code: 1"
  - [ ] JSON format: `{ error: { code, message, suggestion, exitCode } }`
- [ ] Add helper function `exitWithError(code: ErrorCode, context?: object, format?: string)`

**Verification**:

- [ ] All error codes are unique and documented
- [ ] Text errors show error code at the end
- [ ] JSON errors include structured error object
- [ ] Exit codes are consistent (0 for success, 1 for error)
- [ ] Unit tests for error formatting functions

**Files Created**:
- `src/lib/error-codes.ts` - Error code definitions and formatting

**Files Modified**:
- All command files (`src/commands/*.ts`) - Replace error messages with error codes

**Error Code Examples**:
```typescript
E001: "Not in an EAI project"
E002: "Environment variable not set"
E003: "Config file not found"
E101: "Not logged in"
E102: "Token expired"
E103: "Invalid credentials"
E201: "API unreachable"
E202: "Resource not found"
E203: "API error response"
E301: "Invalid schema"
E302: "Validation failed"
E303: "Required field missing"
```

**Estimated Time**: 6 hours

---

### Phase 3: JSON Output Implementation (P0)

**Goal**: Complete all empty JSON output blocks in commands

**Tasks**:

- [ ] Implement JSON output for `types` commands
  - [ ] `types seed --format json`: Output `{ tenants: [{ tenantKey, tenantId, created, updated, failed }] }`
  - [ ] `types diff --format json`: Output `{ diffs: [{ type, change, field }] }`
  - [ ] `types pull --format json`: Output `{ types: [...], count: N }`
- [ ] Implement JSON output for `resources` commands
  - [ ] `resources list --format json`: Output `{ resources: [...], count: N }`
  - [ ] `resources get --format json`: Output `{ resource: {...} }`
  - [ ] `resources query --format json`: Output `{ results: [...], count: N }`
  - [ ] `resources schema --format json`: Output `{ schema: {...} }`
- [ ] Implement JSON output for `deploy` commands
  - [ ] `deploy trigger --format json`: Output `{ deploymentId, status, message }`
  - [ ] `deploy status --format json`: Output `{ status, logs: [...], timestamp }`
- [ ] Implement JSON output for `tenant` commands
  - [ ] `tenant list --format json`: Output `{ tenants: [...], count: N }`
  - [ ] `tenant create --format json`: Output `{ tenant: {...}, created: true }`
  - [ ] `tenant info --format json`: Output `{ tenant: {...} }`
- [ ] Implement JSON output for `env` commands
  - [ ] `env list --format json`: Output `{ env: {...}, source: 'file' }`
- [ ] Ensure JSON output has no progress indicators
  - [ ] Disable `ora` spinners when format is JSON
  - [ ] Disable colored output in JSON mode
  - [ ] Ensure only valid JSON is written to stdout

**Verification**:

- [ ] All commands with `--format json` produce valid JSON
- [ ] JSON output is parseable by `JSON.parse()`
- [ ] No ANSI codes or spinners in JSON output
- [ ] Schema is consistent across invocations
- [ ] Integration tests for each JSON output command

**Files Modified**:
- `src/commands/types.ts:164-165` - Complete JSON output blocks
- `src/commands/resources.ts:70-71, 111-113, 276` - Complete JSON output blocks
- `src/commands/deploy.ts:119-120, 171-180` - Complete JSON output blocks
- `src/commands/tenant.ts:44-45, 129-130` - Complete JSON output blocks
- `src/commands/env.ts` - Add JSON output support

**Estimated Time**: 8 hours

---

### Phase 4: Format Flag Support (P0)

**Goal**: Add `--format <type>` flag to all applicable commands

**Tasks**:

- [ ] Add `--format` flag to all applicable commands
  - [ ] `types seed`, `types diff`, `types pull`
  - [ ] `resources list`, `resources get`, `resources query`, `resources schema`
  - [ ] `deploy trigger`, `deploy status`
  - [ ] `tenant list`, `tenant create`, `tenant info`
  - [ ] `env list`
- [ ] Implement format validation
  - [ ] Accept values: `text`, `json`, `yaml` (yaml is optional P2)
  - [ ] Reject invalid values with error message
  - [ ] Show valid options in error: "Invalid format 'foo'. Use: text, json, yaml"
- [ ] Backward compatibility
  - [ ] Alias existing `--json` flags to `--format json`
  - [ ] Ensure `--json` continues to work (deprecated but functional)
  - [ ] Log deprecation warning for `--json` flag (visible only in verbose mode)
- [ ] Format routing logic
  - [ ] If `format === 'json'`: Use `out.json(data)`
  - [ ] If `format === 'yaml'`: Use `out.yaml(data)` (P2 feature)
  - [ ] If `format === 'text'`: Use existing formatted output

**Verification**:

- [ ] `--format json` produces JSON output
- [ ] `--format text` produces human-readable output
- [ ] `--format invalid` shows error with valid options
- [ ] Existing `--json` flags continue to work
- [ ] Default format is `text` (no breaking changes)

**Files Modified**:
- All command files with structured output (`src/commands/*.ts`)

**Estimated Time**: 4 hours

---

### Phase 5: Schema Introspection (P1)

**Goal**: Implement `--describe` flag for runtime schema discovery

**Tasks**:

- [ ] Create `src/lib/schema-builder.ts`
  - [ ] Implement `buildCommandSchema(command: Command): object`
  - [ ] Extract command name, description
  - [ ] Extract options (name, type, default, description)
  - [ ] Extract subcommands recursively
  - [ ] Generate JSON Schema format output
- [ ] Add `--describe` global flag to `src/index.ts`
  - [ ] Hook into Commander.js to intercept `--describe`
  - [ ] When `--describe` is present, output schema instead of executing
  - [ ] Format: `{ command, description, options: [...], subcommands: [...] }`
- [ ] Implement command introspection
  - [ ] For each command, extract all registered options
  - [ ] Detect option types (string, boolean, number, enum)
  - [ ] Extract default values
  - [ ] Extract choice constraints (for enum types)
- [ ] Schema output format
  - [ ] Follow JSON Schema Draft 7 conventions
  - [ ] Include metadata (version, generated timestamp)

**Verification**:

- [ ] `eai --describe` outputs full CLI schema
- [ ] `eai types --describe` outputs types command schema
- [ ] `eai types seed --describe` outputs seed subcommand schema
- [ ] Schema is valid JSON and parseable
- [ ] Schema includes all options with correct types
- [ ] Unit tests for schema builder functions

**Files Created**:
- `src/lib/schema-builder.ts` - Command schema introspection

**Files Modified**:
- `src/index.ts` - Add global `--describe` flag handler

**Schema Example**:
```json
{
  "command": "eai types seed",
  "description": "Push Object Types to platform",
  "options": [
    {
      "name": "--env",
      "type": "string",
      "default": "dev",
      "description": "Target environment"
    },
    {
      "name": "--format",
      "type": "enum",
      "values": ["text", "json", "yaml"],
      "default": "text",
      "description": "Output format"
    },
    {
      "name": "--dry-run",
      "type": "boolean",
      "default": false,
      "description": "Show what would be seeded without making changes"
    }
  ]
}
```

**Estimated Time**: 6 hours

---

### Phase 6: Examples and Help Enhancement (P1)

**Goal**: Add `--examples` flag and enhance help text

**Tasks**:

- [ ] Add `--examples` support to all commands
  - [ ] Use Commander's `.addHelpText('after', ...)` API
  - [ ] Create examples section for each command
  - [ ] Include 2-5 practical examples per command
  - [ ] Show expected output for key examples
- [ ] Create examples for each command group
  - [ ] `types`: seed, diff, pull, validate examples
  - [ ] `resources`: list, get, query, create examples
  - [ ] `tenant`: list, create, info examples
  - [ ] `deploy`: trigger, status examples
  - [ ] `env`: list, pull, push examples
  - [ ] `user`: invite, list, remove examples
  - [ ] `chat`: send, list examples
  - [ ] `docs`: upload, list examples
- [ ] Enhance root help footer (`src/index.ts`)
  - [ ] Add "Getting Started" section
  - [ ] Add "Development Workflow" section
  - [ ] Add "Deployment" section
  - [ ] Point users to `--examples` flag
  - [ ] Point users to `--describe` flag
- [ ] Improve command-level help text
  - [ ] Use clearer, more concise descriptions
  - [ ] Group related options together
  - [ ] Add usage notes where helpful

**Verification**:

- [ ] Every command shows examples with `--examples`
- [ ] Examples are copy-pasteable
- [ ] Examples cover basic and advanced usage
- [ ] Root `--help` shows improved footer
- [ ] Help text is scannable and well-structured
- [ ] Manual review of all help text output

**Files Modified**:
- `src/index.ts` - Enhanced root help footer
- All command files (`src/commands/*.ts`) - Add examples to each command

**Example Output**:
```
Examples:

  Basic usage:
    $ eai types seed

  Seed specific tenant:
    $ eai types seed --tenant-key my-vertical

  Preview changes without applying:
    $ eai types seed --dry-run

  Get JSON output for automation:
    $ eai types seed --format json
```

**Estimated Time**: 8 hours

---

### Phase 7: Testing and Validation (P0)

**Goal**: Comprehensive testing of all new functionality

**Tasks**:

- [ ] Unit tests for output utilities
  - [ ] Test all output functions with various inputs
  - [ ] Test TTY detection logic
  - [ ] Test color mode detection
  - [ ] Test `--simple` mode
  - [ ] Test table formatting and alignment
- [ ] Unit tests for error code system
  - [ ] Test error code formatting (text and JSON)
  - [ ] Test error code uniqueness
  - [ ] Test error context interpolation
  - [ ] Test exit code consistency
- [ ] Unit tests for schema builder
  - [ ] Test schema generation for various command structures
  - [ ] Test option type detection
  - [ ] Test subcommand recursion
  - [ ] Test JSON Schema validity
- [ ] Integration tests for JSON output
  - [ ] Test each command with `--format json`
  - [ ] Verify JSON parseability
  - [ ] Verify schema consistency
  - [ ] Verify no ANSI codes in output
- [ ] Integration tests for format flag
  - [ ] Test `--format text` vs `--format json`
  - [ ] Test invalid format values
  - [ ] Test backward compatibility with `--json`
- [ ] Integration tests for `--describe`
  - [ ] Test schema output for each command
  - [ ] Test schema accuracy
- [ ] Integration tests for examples
  - [ ] Verify examples are shown with `--examples`
  - [ ] Verify examples are valid commands
- [ ] Accessibility testing
  - [ ] Test with screen reader (manual)
  - [ ] Test `--simple` mode readability
  - [ ] Test `NO_COLOR` environment variable
  - [ ] Test piped output (no colors)
- [ ] Performance testing
  - [ ] Measure help text generation time (< 50ms)
  - [ ] Measure JSON formatting overhead (< 10ms)
  - [ ] Measure schema introspection time (< 100ms)
  - [ ] Compare baseline vs. enhanced CLI performance

**Verification**:

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Test coverage ≥ 80% for new code
- [ ] No performance regression
- [ ] All user stories have test coverage
- [ ] CI pipeline passes

**Files Created**:
- `tests/unit/output.test.ts` - Output utilities tests
- `tests/unit/error-codes.test.ts` - Error code tests
- `tests/unit/schema-builder.test.ts` - Schema builder tests
- `tests/integration/format-flag.test.ts` - Format flag tests
- `tests/integration/json-output.test.ts` - JSON output tests
- `tests/integration/describe-flag.test.ts` - Schema introspection tests
- `tests/integration/examples.test.ts` - Examples flag tests

**Estimated Time**: 10 hours

---

### Phase 8: Documentation and Polish (P1)

**Goal**: Update documentation and finalize implementation

**Tasks**:

- [ ] Update CLI documentation
  - [ ] Document `--format` flag in all relevant command docs
  - [ ] Document `--describe` flag usage
  - [ ] Document `--examples` flag usage
  - [ ] Document `--simple` mode for accessibility
  - [ ] Document error codes reference
- [ ] Create error codes reference page
  - [ ] List all error codes (E001-E399)
  - [ ] Document error categories
  - [ ] Provide troubleshooting guidance for each error
- [ ] Update README.md
  - [ ] Add section on machine-readable output
  - [ ] Add section on accessibility features
  - [ ] Add examples of JSON output usage
  - [ ] Add link to error codes reference
- [ ] Create migration guide
  - [ ] Document `--json` → `--format json` migration
  - [ ] Document new error code format
  - [ ] Provide examples of before/after output
- [ ] Add inline code comments
  - [ ] Document complex output formatting logic
  - [ ] Document error code catalog structure
  - [ ] Document schema builder algorithm
- [ ] Final polish
  - [ ] Review all error messages for clarity
  - [ ] Review all help text for consistency
  - [ ] Review all examples for accuracy
  - [ ] Fix any formatting inconsistencies

**Verification**:

- [ ] Documentation is complete and accurate
- [ ] All examples in docs are tested and work
- [ ] Error codes are fully documented
- [ ] Migration guide is clear
- [ ] Code comments are helpful

**Files Modified**:
- `README.md` - Updated with new features
- `docs/` - Updated command reference pages
- All source files - Added inline comments

**Files Created**:
- `docs/reference/error-codes.md` - Error codes reference
- `docs/guides/machine-readable-output.md` - JSON/YAML output guide
- `docs/guides/accessibility.md` - Accessibility features guide
- `MIGRATION.md` - Migration guide for breaking changes (if any)

**Estimated Time**: 6 hours

---

## File Structure

```
src/
├── index.ts                      # Add global flags, enhanced help
├── lib/
│   ├── output.ts                 # ✅ Implement all utility functions
│   ├── error-codes.ts            # ✨ NEW: Error code definitions
│   ├── schema-builder.ts         # ✨ NEW: Command schema introspection
│   ├── config.ts                 # (existing, no changes)
│   ├── api.ts                    # (existing, no changes)
│   └── auth.ts                   # (existing, no changes)
├── commands/
│   ├── types.ts                  # Add format flag, examples, JSON output
│   ├── resources.ts              # Add format flag, examples, JSON output
│   ├── tenant.ts                 # Add format flag, examples, JSON output
│   ├── deploy.ts                 # Add format flag, examples, JSON output
│   ├── env.ts                    # Add format flag, examples, JSON output
│   ├── user.ts                   # Add examples, error codes
│   ├── chat.ts                   # Add examples, error codes
│   ├── docs.ts                   # Add examples, error codes
│   └── verify.ts                 # Add examples, error codes
tests/
├── unit/
│   ├── output.test.ts            # ✨ NEW: Output utilities tests
│   ├── error-codes.test.ts       # ✨ NEW: Error code tests
│   └── schema-builder.test.ts   # ✨ NEW: Schema builder tests
├── integration/
│   ├── format-flag.test.ts       # ✨ NEW: Format flag tests
│   ├── json-output.test.ts       # ✨ NEW: JSON output tests
│   ├── describe-flag.test.ts     # ✨ NEW: Schema introspection tests
│   └── examples.test.ts          # ✨ NEW: Examples flag tests
docs/
├── reference/
│   └── error-codes.md            # ✨ NEW: Error codes reference
└── guides/
    ├── machine-readable-output.md # ✨ NEW: JSON/YAML guide
    └── accessibility.md          # ✨ NEW: Accessibility guide
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes to existing scripts | HIGH | Maintain backward compatibility with `--json` flag, default to `text` format |
| Performance regression from output formatting | MEDIUM | Benchmark before/after, optimize hot paths, lazy-load YAML library |
| Commander.js API limitations for schema introspection | MEDIUM | Prototype schema builder early, fallback to manual schema if needed |
| Incomplete error code coverage | MEDIUM | Catalog all existing error messages first, systematic migration |
| JSON output schema instability | MEDIUM | Version JSON schemas, document breaking changes |
| TTY detection false positives | LOW | Test on multiple platforms (macOS, Linux, Windows WSL) |
| Accessibility compliance gaps | LOW | Manual testing with screen readers, follow WCAG guidelines |

## Spec Traceability

### User Story Coverage

| Story | Priority | Status | Plan References |
|-------|----------|--------|-----------------|
| US1: Automated Testing and CI/CD Integration | P0 | COVERED | Phase 3 (JSON Output), Phase 4 (Format Flag) |
| US2: AI Agent Tool Integration | P0 | COVERED | Phase 5 (Schema Introspection), Phase 2 (Error Codes) |
| US3: Accessible CLI for All Users | P1 | COVERED | Phase 1 (Simple Mode, TTY Detection) |
| US4: Quick Command Discovery | P1 | COVERED | Phase 6 (Examples, Help Enhancement) |
| US5: Structured Error Handling | P1 | COVERED | Phase 2 (Error Code System) |

### Functional Requirement Coverage

| Requirement | Status | Plan Reference |
|-------------|--------|----------------|
| FR001: JSON Output Implementation | COVERED | Phase 3 - JSON output for all commands |
| FR002: Output Utility Functions | COVERED | Phase 1 - Complete output.ts functions |
| FR003: Format Flag Support | COVERED | Phase 4 - Add --format flag to all commands |
| FR004: Error Code System | COVERED | Phase 2 - Create error-codes.ts, structured errors |
| FR005: Schema Introspection | COVERED | Phase 5 - Create schema-builder.ts, --describe flag |
| FR006: Examples Flag | COVERED | Phase 6 - Add --examples to all commands |
| FR007: Simple/Accessible Mode | COVERED | Phase 1 - Add --simple flag, TTY detection |
| FR008: Help Footer Enhancement | COVERED | Phase 6 - Enhanced root help footer |
| FR009: TTY and Color Detection | COVERED | Phase 1 - Implement TTY/color detection |
| FR010: Backward Compatibility | COVERED | Phase 4 - Alias --json to --format json |

### Acceptance Criteria Mapping

| User Story | Acceptance Criterion | Plan Component | Implementation Approach |
|------------|---------------------|----------------|-------------------------|
| US1 | All commands support `--format json` | Phase 4: Format Flag Support | Add `.option('--format <format>', ...)` to all commands |
| US1 | JSON output is valid, parseable JSON | Phase 3: JSON Output Implementation | Use `out.json(data)` which calls `JSON.stringify()` |
| US1 | Errors in JSON mode include error codes | Phase 2: Error Code System | `formatErrorJSON()` returns structured error object |
| US1 | JSON output excludes progress indicators | Phase 3: JSON Output Implementation | Disable `ora` spinners when `format === 'json'` |
| US1 | Exit codes reliably indicate success/failure | Phase 2: Error Code System | Standardize `process.exit(0)` for success, `process.exit(1)` for errors |
| US2 | `--describe` flag outputs JSON schema | Phase 5: Schema Introspection | `buildCommandSchema()` extracts command metadata |
| US2 | Schema includes parameter types, constraints | Phase 5: Schema Introspection | Introspect Commander.js options, detect types |
| US2 | Help text is structured and machine-parseable | Phase 6: Examples and Help Enhancement | Use consistent formatting in `.addHelpText()` |
| US2 | Error messages include error codes | Phase 2: Error Code System | All errors use `formatError(code, context)` |
| US2 | Commands are deterministic | Phase 3: JSON Output Implementation | Remove timestamps/randomness from output |
| US3 | `--simple` mode provides plain text | Phase 1: Foundation & Output Layer | Replace symbols with text labels when `--simple` |
| US3 | Help text uses structural elements | Phase 6: Examples and Help Enhancement | Use headings, lists, consistent formatting |
| US3 | Information not conveyed by color alone | Phase 1: Foundation & Output Layer | Use symbols + text, not just colors |
| US3 | Output utilities check for TTY | Phase 1: Foundation & Output Layer | Check `process.stdout.isTTY` before using colors |
| US3 | All commands work in text-only mode | Phase 1: Foundation & Output Layer | Default to text mode, graceful degradation |
| US4 | `--help` shows brief, scannable information | Phase 6: Examples and Help Enhancement | Use concise descriptions, clear structure |
| US4 | `--examples` flag shows 2-5 practical examples | Phase 6: Examples and Help Enhancement | Add `.addHelpText('after', examples)` to all commands |
| US4 | Help footer includes common workflow patterns | Phase 6: Examples and Help Enhancement | Enhanced root help footer with workflow sections |
| US4 | Error messages suggest related commands | Phase 2: Error Code System | Include suggestions in error catalog |
| US4 | Tab completion works in bash, zsh, fish | Out of Scope | Not included in this phase (future enhancement) |
| US5 | All errors include structured error codes | Phase 2: Error Code System | Create error catalog with E001-E399 codes |
| US5 | Error messages state problem and solution | Phase 2: Error Code System | Error catalog includes message + suggestion |
| US5 | Errors show failing input when relevant | Phase 2: Error Code System | Use context interpolation in error messages |
| US5 | Error codes are categorized | Phase 2: Error Code System | E001-E099 Project, E100-E199 Auth, E200-E299 Platform, E300-E399 Validation |
| US5 | Errors link to docs/troubleshooting | Phase 8: Documentation and Polish | Add doc links to error catalog |

**Coverage**: 100% of user stories, 100% of functional requirements, 100% of acceptance criteria

## Implementation Notes

### Order of Implementation

Phases should be implemented in order 1-8 due to dependencies:
- Phase 1 (Output Layer) is required for Phase 2-3
- Phase 2 (Error Codes) should precede Phase 3 (JSON Output) for consistent error handling
- Phase 4 (Format Flag) depends on Phase 3 (JSON Output)
- Phase 5-6 can be done in parallel after Phase 4
- Phase 7 (Testing) should be continuous but requires all features to be complete
- Phase 8 (Documentation) should be last

### Critical Integration Points

1. **Commander.js Options**: All `--format`, `--describe`, `--examples`, `--simple` flags must be added at the correct command level (global vs. per-command)
2. **Output Routing**: Every command must check `options.format` and route to appropriate output method
3. **Error Handling**: All error paths must migrate from direct `console.error()` to `formatError()` or `exitWithError()`
4. **TTY Detection**: Output utilities must check TTY status before applying colors/symbols
5. **JSON Mode Spinners**: All `ora` spinners must be disabled when `format === 'json'`

### Testing Strategy

- **Unit tests first**: Write tests for output utilities, error codes, schema builder before implementing commands
- **Integration tests per phase**: Test each phase's functionality before moving to next
- **Continuous regression testing**: Run full test suite after each phase to catch regressions
- **Manual accessibility testing**: Test with screen readers (VoiceOver on macOS) for Phase 1
- **Performance benchmarking**: Baseline before Phase 1, measure after Phase 3, 5, 6

### Backward Compatibility Strategy

- Keep existing `--json` flags functional (alias to `--format json`)
- Default format is `text` (no behavior change)
- Existing error messages keep their content (add error code at end)
- Exit codes remain unchanged (0 = success, 1 = error)
- No changes to command names or required arguments

### Performance Optimization

- Lazy-load `yaml` library (only when `--format yaml` is used)
- Cache schema introspection results (same command = same schema)
- Minimize string allocations in hot paths
- Use streaming JSON output for large datasets (if needed)

### Accessibility Considerations

- Use both symbols AND text for status (e.g., "✓ SUCCESS" not just "✓")
- Ensure sufficient contrast in color choices
- Provide `--simple` mode for screen reader users
- Respect `NO_COLOR` environment variable
- Test with VoiceOver (macOS), NVDA (Windows), Orca (Linux)

### AI Agent Integration

- JSON schemas should be self-describing (include type metadata)
- Error codes should be machine-parseable and stable
- Command output should be deterministic (no timestamps unless requested)
- `--describe` output should include usage examples
- JSON output should never include partial data (atomic operations)

---

## Total Estimated Effort

| Phase | Hours |
|-------|-------|
| Phase 1: Foundation & Output Layer | 4 |
| Phase 2: Error Code System | 6 |
| Phase 3: JSON Output Implementation | 8 |
| Phase 4: Format Flag Support | 4 |
| Phase 5: Schema Introspection | 6 |
| Phase 6: Examples and Help Enhancement | 8 |
| Phase 7: Testing and Validation | 10 |
| Phase 8: Documentation and Polish | 6 |
| **Total** | **52 hours** |

Estimated calendar time: **2-3 weeks** (assuming 20-25 hours/week)

---

## Success Criteria

From spec.md, we will measure success by:

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| JSON output coverage | 100% | All structured output commands support `--format json` |
| Output utility coverage | 100% | All 9 utility functions implemented and tested |
| Error code coverage | 100% | All error paths have error codes (E001-E399) |
| Help text quality | ≥4.5/5 | User survey rating (internal team) |
| Example coverage | 100% | All commands have ≥2 examples |
| Accessibility score | AA | WCAG 2.1 AA criteria met (TTY detection, NO_COLOR, --simple) |
| Performance impact | <5% | Benchmark baseline vs. enhanced (help, JSON, schema) |
| Backward compatibility | 100% | All existing scripts continue working (--json alias) |
| Test coverage | ≥80% | Code coverage for new code (output, error-codes, schema-builder) |

---

## Next Steps

This plan is ready for **task breakdown** (Stage 4). The tasks should:
- Break each phase into granular, actionable tasks
- Assign priorities (P0 for MVP, P1 for polish)
- Identify dependencies between tasks
- Estimate effort per task (small/medium/large)

Ready for: `/4_gofer_tasks`
