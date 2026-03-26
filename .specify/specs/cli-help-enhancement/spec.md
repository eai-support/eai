---
id: "cli-help-enhancement"
title: "CLI Help System Enhancement"
status: "draft"
created: "2026-03-15T11:35:00Z"
updated: "2026-03-26"
priority: "medium"
assignee: "engineer-agent"
---

# CLI Help System Enhancement

## Overview

Enhance the EAI CLI help system to follow industry best practices and support AI coding agents through machine-readable output, improved help text structure, progressive disclosure, and accessibility standards.

**Target Users**: Developers (both human and AI agents) using the EAI CLI for vertical application development

**Primary Value**: Enable automation, improve discoverability, and ensure accessibility while maintaining the CLI's current strengths

**Research Reference**: See `research.md` for comprehensive codebase analysis and industry best practices

## User Stories

### US1: Automated Testing and CI/CD Integration (P0)

**As a** DevOps engineer
**I want to** get structured, machine-readable output from CLI commands
**So that** I can parse results in automated scripts and CI/CD pipelines

**Acceptance Criteria**:
- [ ] All commands support `--format json` flag
- [ ] JSON output is valid, parseable JSON with consistent schema
- [ ] Errors in JSON mode include error codes and structured details
- [ ] JSON output excludes progress indicators and ANSI codes
- [ ] Exit codes reliably indicate success (0) vs failure (1)

### US2: AI Agent Tool Integration (P0)

**As an** AI coding agent
**I want to** discover command capabilities and schemas at runtime
**So that** I can use the CLI effectively without pre-training

**Acceptance Criteria**:
- [ ] `--describe` flag outputs JSON schema for any command
- [ ] Schema includes parameter types, constraints, and defaults
- [ ] Help text is structured and machine-parseable
- [ ] Error messages include error codes for programmatic handling
- [ ] Commands are deterministic (same input → same output)

### US3: Accessible CLI for All Users (P1)

**As a** developer using assistive technology
**I want** CLI output that works with screen readers
**So that** I can use the tool independently

**Acceptance Criteria**:
- [ ] `--simple` mode provides plain text without colors/symbols
- [ ] Help text uses structural elements (headings, lists)
- [ ] Information is not conveyed by color alone
- [ ] Output utilities check for TTY and color support
- [ ] All commands work in text-only mode

### US4: Quick Command Discovery (P1)

**As a** new CLI user
**I want to** quickly find the right command and learn how to use it
**So that** I can accomplish my task without reading full documentation

**Acceptance Criteria**:
- [ ] `--help` shows brief, scannable information
- [ ] `--examples` flag shows 2-5 practical usage examples
- [ ] Help footer includes common workflow patterns
- [ ] Error messages suggest related commands
- [ ] Tab completion works in bash, zsh, and fish shells

### US5: Structured Error Handling (P1)

**As a** developer debugging CLI failures
**I want** clear, actionable error messages with context
**So that** I can quickly understand and fix the problem

**Acceptance Criteria**:
- [ ] All errors include structured error codes (E001-E399)
- [ ] Error messages state the problem and provide a solution
- [ ] Errors show the failing input when relevant
- [ ] Error codes are categorized (Project, Auth, Platform, Validation)
- [ ] Errors link to docs/troubleshooting when appropriate

## Functional Requirements

### FR001: JSON Output Implementation

**Description**: Implement machine-readable JSON output for all commands that return structured data

**Validation**: Run each command with `--format json` and verify:
- Output is valid JSON (parseable by `JSON.parse()`)
- Schema is consistent across invocations
- No ANSI escape codes or progress indicators in output

**Integration**: Complete empty `if (options.json)` blocks in:
- `src/commands/types.ts:164-165`
- `src/commands/resources.ts:70-71, 111-113, 276`
- `src/commands/deploy.ts:119-120, 171-180`
- `src/commands/tenant.ts:44-45, 129-130`

**Commands affected**: `types seed`, `types pull`, `resources list/get/query/schema`, `deploy trigger/status`, `tenant list/create`

### FR002: Output Utility Functions

**Description**: Implement all empty output utility functions in `src/lib/output.ts`

**Functions to implement**:
- `success(msg: string): void` - Success message with ✓ symbol
- `error(msg: string): void` - Error message with ✗ symbol
- `warn(msg: string): void` - Warning with ⚠ symbol
- `info(msg: string): void` - Info message with → symbol
- `heading(text: string): void` - Section heading (bold)
- `dim(text: string): void` - Dimmed text for secondary info
- `table(rows: Array<[string, string]>): void` - Two-column table
- `json(data: unknown): void` - Pretty-printed JSON
- `yaml(data: unknown): void` - YAML output

**Validation**:
- All existing command output continues to work
- Functions respect `--no-color` flag
- Functions detect TTY and disable colors if piped
- Table function aligns columns properly

**Integration**: Update all commands currently calling these functions

### FR003: Format Flag Support

**Description**: Add `--format <type>` flag to commands that output structured data

**Supported formats**:
- `text` (default) - Human-readable formatted output
- `json` - Machine-readable JSON
- `yaml` - YAML format (optional, P2)

**Validation**:
- Invalid format values show error with valid options
- Format flag works with all applicable commands
- Text format matches current output
- JSON/YAML formats are valid and parseable

**Integration**: Add to commands: `types seed/diff/pull`, `resources list/get/query`, `deploy status`, `tenant list/info`, `env list`

**Implementation pattern**:
```typescript
.option('--format <format>', 'Output format (text|json|yaml)', 'text')
```

### FR004: Error Code System

**Description**: Implement structured error codes for all error conditions

**Error code categories**:
- E001-E099: Project errors (not in EAI project, config missing)
- E100-E199: Auth errors (not logged in, token expired)
- E200-E299: Platform errors (API unreachable, resource not found)
- E300-E399: Validation errors (invalid schema, missing field)

**Validation**:
- All error paths use error codes
- Error codes are unique and documented
- JSON output includes error code
- Text output shows error code at end

**Integration**: Create `src/lib/error-codes.ts` with error code constants, update all error messages

**Error output format (text)**:
```
✗ BASE_URL_PUBLIC_API not set. Run `eai env pull` or set it in .env.local

Error code: E002
Exit code: 1
```

**Error output format (JSON)**:
```json
{
  "error": {
    "code": "E002",
    "message": "BASE_URL_PUBLIC_API not set",
    "suggestion": "Run `eai env pull` or set it in .env.local",
    "exitCode": 1
  }
}
```

### FR005: Schema Introspection

**Description**: Add `--describe` flag to output command schema in JSON format

**Validation**:
- `--describe` works on all commands
- Output is valid JSON Schema
- Schema includes parameter names, types, defaults, constraints
- Schema describes subcommands if applicable

**Integration**: Hook into Commander.js command registration to build schema

**Schema output example**:
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
    }
  ]
}
```

### FR006: Examples Flag

**Description**: Add `--examples` flag to show practical usage examples

**Validation**:
- Every command has 2-5 examples
- Examples are copy-pasteable
- Examples cover basic and advanced usage
- Examples show expected output when relevant

**Integration**: Use Commander's `.addHelpText('after', ...)` to add examples section

**Example output format**:
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

### FR007: Simple/Accessible Mode

**Description**: Add `--simple` flag for plain text output without colors or symbols

**Validation**:
- `--simple` disables all ANSI codes
- `--simple` disables all Unicode symbols
- Output is readable in pure ASCII
- Information conveyed by color is also in text

**Integration**: Check for `--simple` flag in output utility functions

**Example comparison**:
```
Normal mode:  ✓ Seeded 5 types to platform
Simple mode:  SUCCESS: Seeded 5 types to platform
```

### FR008: Help Footer Enhancement

**Description**: Extend root `--help` footer with better structure and more examples

**Validation**:
- Help footer shows command categories
- Common workflows are highlighted
- Examples are realistic and practical
- Footer points to `--examples` for more

**Integration**: Update `src/index.ts:61-78` help footer

**Enhanced structure**:
```
Getting Started:
  eai init my-vertical     Scaffold a new vertical
  eai login                Authenticate
  eai env pull             Sync configuration

Development Workflow:
  eai types validate       Check object types
  eai types seed           Publish to platform
  eai dev                  Start dev server

Deployment:
  eai deploy trigger       Deploy to Azure
  eai deploy status        Check deployment

Use 'eai <command> --help' for command-specific help
Use 'eai <command> --examples' for usage examples
Use 'eai --describe' to see all commands in JSON
```

### FR009: TTY and Color Detection

**Description**: Detect terminal capabilities and adjust output automatically

**Validation**:
- Colors disabled when stdout is not a TTY (piped output)
- Colors respect NO_COLOR environment variable
- Colors respect FORCE_COLOR environment variable
- `--no-color` flag disables colors
- `--color` flag forces colors (for testing)

**Integration**: Use chalk's built-in detection, add explicit flag support

### FR010: Backward Compatibility

**Description**: Maintain backward compatibility for existing usage

**Validation**:
- Existing `--json` flags continue to work (map to `--format json`)
- Default output format is unchanged (text)
- Exit codes remain the same
- Existing error messages keep their content (add error codes)

**Integration**: Alias `--json` to `--format json`, preserve all current behavior as default

## Non-Functional Requirements

### Performance

- Help text generation: < 50ms
- JSON formatting overhead: < 10ms per command
- Schema introspection: < 100ms
- No performance regression for existing commands

### Security

- No sensitive data in error messages (tokens, passwords)
- No sensitive data in JSON output unless explicitly requested
- Error codes don't reveal internal system details

### Compatibility

- Works with Node.js ≥ 20.0.0 (current requirement)
- Compatible with Commander.js 13.x (no breaking changes)
- Works with existing chalk version
- Compatible with all current command patterns

### Accessibility

- WCAG 2.1 AA compliance where applicable to CLI
- Works with common screen readers (NVDA, JAWS, VoiceOver)
- Keyboard-only navigation (no mouse required)
- High contrast support via color themes

### Maintainability

- Error codes are centrally managed
- Output formats share common formatting logic
- Schema generation is automated from command definitions
- Examples are stored with command definitions

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| JSON output coverage | 100% | All structured output commands support `--format json` |
| Output utility coverage | 100% | All 9 utility functions implemented and tested |
| Error code coverage | 100% | All error paths have error codes |
| Help text quality | ≥4.5/5 | User survey rating (internal team) |
| Example coverage | 100% | All commands have ≥2 examples |
| Accessibility score | AA | WCAG 2.1 AA criteria met |
| Performance impact | <5% | No measurable slowdown vs baseline |
| Backward compatibility | 100% | All existing scripts continue working |

## Assumptions

- Commander.js 13.x API remains stable (no breaking changes planned)
- Chalk library continues to support color detection
- Terminal environments support ANSI escape codes (where colors are used)
- Users have access to bash, zsh, or fish shells (for tab completion)
- JSON output schemas can evolve (minor version bumps for new fields)
- Error codes are stable (new codes added, existing codes never change meaning)
- Performance requirements are based on typical CLI usage (not high-frequency automation)

## Dependencies

### Internal Dependencies
- `src/lib/output.ts` - All commands depend on output utilities
- `src/lib/error-codes.ts` - New module for error code constants
- `src/index.ts` - Root program for global help enhancements
- Commander.js hooks - For help text and schema generation

### External Dependencies
- **Commander.js 13.x**: Already in use, no version change
- **chalk 5.x**: Already in use, no version change
- **yaml** (optional): For YAML format support (P2 feature)

### Codebase Integration Points
1. **Commander.js declarative help** (`src/commands/types.ts:23-29`) - Maintain this pattern
2. **Symbol-based visual feedback** (`src/lib/output.ts:7-18`) - Extend this pattern
3. **Contextual error messages** (`src/commands/types.ts:57`) - Enhance with error codes
4. **Custom help footer** (`src/index.ts:61-78`) - Expand with better structure

## Out of Scope

The following are explicitly **not** included in this feature:

- **Internationalization (i18n)**: CLI remains English-only for this release
- **Man page generation**: Not included, may be future enhancement
- **Shell completion installation automation**: User must manually install completions
- **Interactive help browser**: Future enhancement, not in scope
- **Custom output formatters**: Format types are fixed (text, json, yaml)
- **Help versioning**: Not tracking when help text changes
- **Field filtering**: `--fields` flag for reducing output size (future)
- **Plugin system**: No extensibility for custom formats
- **Telemetry**: No usage tracking or analytics
- **Localized error messages**: Errors remain in English

## Research Traceability

| Research Finding | Spec Section | Reference |
|------------------|--------------|-----------|
| Empty JSON output blocks (9 commands) | FR001 | Lines 74-94 |
| Empty output utility functions | FR002 | Lines 96-124 |
| Commander.js declarative pattern | Assumptions, Dependencies | Lines 271, 284 |
| Symbol-based visual feedback | FR002, Dependencies | Lines 96-124, 285 |
| Contextual error messages | FR005, US5 | Lines 161-187, 61-73 |
| Custom help footer | FR008 | Lines 230-257 |
| Integration with Commander.js | FR006, FR008 | Lines 202-228, 230-257 |
| POSIX/GNU standards | FR003, FR007 | Lines 126-148, 218-228 |
| AI agent requirements | US2, FR005 | Lines 39-56, 150-175 |
| Accessibility standards | US3, FR007 | Lines 57-67, 218-228 |
| Progressive disclosure | FR006, FR008 | Lines 202-228, 230-257 |
| Error code system | FR004, US5 | Lines 150-187, 61-73 |
| Technology Decision 1 (format flag) | FR003 | Lines 126-148 |
| Technology Decision 2 (progressive help) | FR006, FR008 | Lines 202-228, 230-257 |
| Technology Decision 3 (schema introspection) | FR005 | Lines 176-200 |
| Technology Decision 4 (error codes) | FR004 | Lines 150-175 |
| Technology Decision 5 (output utilities) | FR002 | Lines 96-124 |
| Constraint: Commander.js limitations | Assumptions | Lines 271-272 |
| Constraint: Terminal width | FR008 | Lines 230-257 |
| Constraint: Color support detection | FR009 | Lines 259-268 |
| Constraint: Backward compatibility | FR010 | Lines 270-280 |
| Constraint: Performance requirements | Non-Functional Requirements - Performance | Lines 282-287 |

## Glossary

| Term | Definition |
|------|------------|
| **AI Agent** | Automated coding assistant (like Claude Code) that executes CLI commands programmatically |
| **ANSI Escape Codes** | Special character sequences for terminal colors and formatting |
| **CLI** | Command-Line Interface - text-based program interaction |
| **Error Code** | Machine-readable identifier for specific error conditions (e.g., E001) |
| **JSON Schema** | Standard for describing JSON data structures |
| **Machine-Readable** | Output format designed for programmatic parsing (vs human reading) |
| **Progressive Disclosure** | UX pattern showing information progressively (brief → detailed → comprehensive) |
| **Schema Introspection** | Runtime discovery of command structure and capabilities |
| **TTY** | Teletypewriter - terminal device (vs piped/redirected output) |
| **WCAG** | Web Content Accessibility Guidelines - accessibility standards |
| **Commander.js** | Node.js framework for building command-line programs |
| **Exit Code** | Numeric status returned by program (0 = success, 1+ = error) |
| **Format Flag** | Option to specify output format (--format json) |

---

## Next Steps

This specification is ready for **technical planning** (Stage 3). The plan should detail:
- Implementation order (Priority 0 fixes first)
- File-by-file changes required
- Testing strategy
- Migration path for existing users
