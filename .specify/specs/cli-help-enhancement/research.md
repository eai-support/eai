---
date: 2026-03-15T11:30:00Z
researcher: Claude Sonnet 4.5
feature: 'CLI Help System Enhancement'
status: complete
---

# Research: CLI Help System Enhancement for EAI CLI

## Feature Summary

Enhance the EAI CLI help system to follow industry best practices and support AI coding agents. This includes implementing machine-readable output, improving help text structure, adding progressive disclosure, and ensuring accessibility standards are met.

## Executive Summary

### Current State Analysis

The EAI CLI uses Commander.js 13.x with a solid foundation but has critical gaps:

**Strengths:**
- Consistent help text across all 14 commands and 30+ subcommands
- Good error messages with actionable guidance
- Custom help footer showing realistic workflows
- Symbol-based visual feedback (✓, ✗, ⚠, →)

**Critical Gaps:**
- **JSON output incomplete**: 9 commands have empty `if (options.json) {}` blocks
- **Output utilities non-functional**: All functions in `output.ts` have empty bodies
- **No format flag**: Missing `--format` option for flexible output
- **No schema introspection**: Can't discover command structure programmatically

### Industry Best Practices Research

Research across GitHub CLI, AWS CLI, kubectl, and modern standards reveals:

1. **Progressive Disclosure**: Help systems should provide brief → detailed → comprehensive information
2. **AI Agent Support**: Machine-readable output (`--output json`) is table stakes
3. **Accessibility**: Screen reader compatibility and color-independent formatting essential
4. **Structured Errors**: Error codes, failing input context, and actionable suggestions required
5. **Multi-Level Help**: Help available at every hierarchy level with consistent structure

## Codebase Analysis

### Where to Implement

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| Main Program | `src/index.ts` | Root command, help footer | ✅ Good |
| Commands | `src/commands/*.ts` | 14 command files | ⚠️ Needs fixes |
| Output Utilities | `src/lib/output.ts` | Formatting helpers | ❌ Empty implementations |
| API Client | `src/lib/api-client.ts` | Platform API calls | ✅ Good |

### Existing Patterns to Follow

#### Pattern 1: Commander.js Declarative Help

**Found in:** `src/commands/types.ts:23-29`

```typescript
typesCommand
  .command('seed')
  .description('Push Object Types to platform')
  .option('--env <environment>', 'Target environment', 'dev')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--dry-run', 'Show what would be seeded without making changes', false)
  .option('--json', 'Output raw JSON', false)
```

**Why relevant:** All commands follow this declarative pattern. Enhancement should maintain this consistency.

#### Pattern 2: Symbol-Based Visual Feedback

**Found in:** `src/lib/output.ts:7-18`

```typescript
export const symbols = {
  success: chalk.green('✓'),
  error: chalk.red('✗'),
  warning: chalk.yellow('⚠'),
  info: chalk.blue('→'),
  pending: chalk.gray('○'),
  updated: chalk.cyan('↻'),
  unchanged: chalk.gray('='),
  added: chalk.green('+'),
  removed: chalk.red('-'),
  changed: chalk.yellow('~'),
} as const;
```

**Why relevant:** Visual consistency across all commands. Should extend this pattern for new output types.

#### Pattern 3: Contextual Error Messages

**Found in:** `src/commands/types.ts:57` and `src/commands/env.ts:119-120`

```typescript
// types.ts
out.error('BASE_URL_PUBLIC_API not set. Run `eai env pull` or set it in .env.local');

// env.ts
out.error('Azure CLI not found or not logged in. Run `az login` first.');
```

**Why relevant:** Errors include both problem statement and actionable solution. This pattern is highly effective.

#### Pattern 4: Custom Help Footer with Workflows

**Found in:** `src/index.ts:61-78`

```typescript
program.addHelpText('after', `
${chalk.bold('Getting Started:')}
  ${chalk.cyan('eai init my-vertical')}     Scaffold a new vertical app
  ...
${chalk.bold('Common Workflows:')}
  ${chalk.dim('# Define your data model, validate, and seed')}
  ${chalk.cyan('eai types validate && eai types seed')}
  ...
`);
```

**Why relevant:** Shows realistic usage patterns, not just syntax. Users learn by example.

### Integration Points

1. **Commander.js hooks**: Use `.addHelpText()` for custom help sections
2. **Output utilities**: Implement missing functions in `src/lib/output.ts`
3. **JSON output**: Complete empty blocks in all command handlers
4. **Format flag**: Add to all commands that produce structured data

### Related Code

Key files requiring updates:

- `src/index.ts:61-78` — Root help footer (extend with examples)
- `src/lib/output.ts:20-46` — Empty utility functions (implement)
- `src/commands/types.ts:164-165` — Empty JSON block (implement)
- `src/commands/resources.ts:70-71, 111-113, 276` — Empty JSON blocks (implement)
- `src/commands/deploy.ts:119-120, 171-180` — Empty JSON blocks (implement)
- `src/commands/tenant.ts:44-45, 129-130` — Empty JSON blocks (implement)

## Technology Decisions

### Decision 1: Output Format Strategy

**Choice:** Implement `--format <type>` flag with support for: `text`, `json`, `yaml`

**Rationale:**
- Industry standard (AWS CLI, kubectl use this pattern)
- More flexible than multiple boolean flags (`--json`, `--yaml`)
- Extensible to additional formats (csv, table, etc.)
- AI agents can request JSON programmatically

**Alternatives considered:**
- Environment variable (`OUTPUT_FORMAT=json`) — Less discoverable
- Multiple flags (`--json`, `--yaml`) — Flag proliferation
- Auto-detect TTY — Too magical, lacks explicit control

**Implementation:**
```typescript
.option('--format <format>', 'Output format (text|json|yaml)', 'text')
```

### Decision 2: Help Text Enhancement Strategy

**Choice:** Progressive disclosure with three tiers:
1. Brief help (default `--help`)
2. Detailed help (`--help-detailed` or extended in default)
3. Examples (`--examples`)

**Rationale:**
- Reduces cognitive load for beginners
- Supports quick reference for experts
- AI agents can request specific detail levels
- Follows GitHub CLI and kubectl patterns

**Alternatives considered:**
- Verbose flag (`--verbose --help`) — Non-standard
- Separate docs command — Adds complexity
- Man pages — Not cross-platform

**Implementation:**
```typescript
program.addHelpText('afterAll', `
Use 'eai <command> --help' for detailed information
Use 'eai <command> --examples' for usage examples
`);
```

### Decision 3: Schema Introspection

**Choice:** Add `--describe` flag to output JSON schema of command structure

**Rationale:**
- AI agents need runtime capability discovery
- Enables dynamic tool integration
- Standard pattern in modern CLIs
- Supports IDE autocomplete generation

**Alternatives considered:**
- OpenAPI spec generation — Overkill for CLI
- `--help --json` — Mixes concerns
- Separate schema command — Less discoverable

**Implementation:**
```typescript
.option('--describe', 'Output JSON schema for this command', false)
```

### Decision 4: Error Code System

**Choice:** Implement structured error codes with categories:

```typescript
const ERROR_CODES = {
  // Project errors (E001-E099)
  PROJECT_NOT_FOUND: 'E001',
  CONFIG_MISSING: 'E002',

  // Auth errors (E100-E199)
  AUTH_FAILED: 'E100',
  TOKEN_EXPIRED: 'E101',

  // Platform errors (E200-E299)
  PLATFORM_UNREACHABLE: 'E200',
  RESOURCE_NOT_FOUND: 'E201',

  // Validation errors (E300-E399)
  INVALID_SCHEMA: 'E300',
  MISSING_FIELD: 'E301',
};
```

**Rationale:**
- Machine-parseable error handling
- Enables error-specific automation
- Categorization aids troubleshooting
- Standard in enterprise CLIs

**Alternatives considered:**
- HTTP status codes — Not appropriate for CLI
- String-based codes — Less structured
- No error codes — Harder for automation

### Decision 5: Output Utility Implementation

**Choice:** Implement all empty functions in `output.ts` with these signatures:

```typescript
export function success(msg: string): void;
export function error(msg: string): void;
export function warn(msg: string): void;
export function info(msg: string): void;
export function heading(text: string): void;
export function dim(text: string): void;
export function table(rows: Array<[string, string]>): void;
export function json(data: unknown): void;
export function yaml(data: unknown): void;
```

**Rationale:**
- Centralizes all output formatting
- Enables consistent styling
- Simplifies testing (mock single module)
- Supports format switching in one place

## Constraints & Considerations

### 1. Commander.js Limitations

- **Constraint:** Commander.js auto-generates help from decorators
- **Impact:** Custom help must use `.addHelpText()` hooks, not override entirely
- **Mitigation:** Work within framework, extend don't replace

### 2. Terminal Width

- **Constraint:** Help text must fit 80-column terminals
- **Impact:** Descriptions must be concise, tables may wrap
- **Mitigation:** Use multi-line formatting, test on narrow terminals

### 3. Color Support Detection

- **Constraint:** Not all terminals support ANSI colors
- **Impact:** Symbol-based output may appear garbled
- **Mitigation:** Use chalk's built-in color detection, provide `--no-color` flag

### 4. Backward Compatibility

- **Constraint:** Existing scripts may depend on current output format
- **Impact:** Changes could break automation
- **Mitigation:**
  - Keep text format as default
  - New formats opt-in via flag
  - Version bump to indicate breaking changes

### 5. JSON Schema Complexity

- **Constraint:** Commander.js doesn't expose command schema programmatically
- **Impact:** `--describe` requires manual schema construction
- **Mitigation:** Build schema from command definitions at registration time

### 6. AI Agent Context Windows

- **Constraint:** Large help output consumes AI context tokens
- **Impact:** Verbose help reduces available working memory
- **Mitigation:** Implement progressive disclosure, brief help by default

### 7. Accessibility Requirements

- **Constraint:** Screen readers need structured, non-visual output
- **Impact:** ASCII art, tables, and color-only semantics are problematic
- **Mitigation:**
  - Provide `--simple` mode for plain text
  - Use semantic structure (headings, lists)
  - Ensure color is not the only indicator

### 8. Performance

- **Constraint:** Help generation must be instant (<100ms)
- **Impact:** Can't perform expensive operations (API calls, file I/O) in help
- **Mitigation:** All help text should be static or computed from in-memory structures

## Industry Best Practices Summary

### 1. Help Text Structure (POSIX/GNU Standards)

**Standard format:**
```
Usage: command [options] <required> [optional]

Description:
  Brief explanation of command purpose

Arguments:
  <required>   Description
  [optional]   Description (default: value)

Options:
  -s, --short   Description
  -l, --long    Longer description

Examples:
  Basic usage:
    $ command arg

  Advanced:
    $ command --flag arg
```

**Sources:** POSIX Utility Conventions, GNU Standards

### 2. Progressive Disclosure

**Pattern:**
- **Tier 1 (--help):** Usage, brief descriptions, common options
- **Tier 2 (extended):** All options, detailed descriptions
- **Tier 3 (--examples):** Real-world usage patterns

**Benefit:** Reduces cognitive load while maintaining full documentation

**Source:** GitHub CLI, kubectl

### 3. Machine-Readable Output

**Requirements:**
- `--output json` or `--format json` flag
- Consistent schema across invocations
- No progress indicators in JSON mode
- Structured errors with codes

**Example:**
```json
{
  "status": "success",
  "data": {...},
  "metadata": {
    "version": "0.1.4",
    "timestamp": "2026-03-15T11:30:00Z"
  }
}
```

**Source:** AWS CLI, kubectl, GitHub CLI

### 4. Error Message Structure

**Components:**
1. Error code (machine-readable)
2. Problem statement (what went wrong)
3. Context (failing input/state)
4. Solution (how to fix)
5. Additional resources (docs link)

**Example:**
```
✗ E201: Resource 'Customer' not found

  Input: type=Customer, id=abc-123

  This resource may have been deleted or you may not have permission to access it.

  Try:
    • List available resources: eai resources list Customer
    • Check your tenant configuration: eai whoami
    • View documentation: https://docs.example.com/resources

  Exit code: 1
```

**Source:** Google Technical Writing, LogRocket UX Guidelines

### 5. AI Agent Requirements

**Must-have features:**
1. `--output json` for structured data
2. `--describe` for schema introspection
3. `--dry-run` for validation without mutation
4. Deterministic behavior (same input → same output)
5. Error codes for programmatic handling

**Nice-to-have:**
6. `--fields` for response filtering (reduce context usage)
7. `--quiet` for minimal output
8. Exit codes follow standards (0=success, 1=error, 2=misuse)

**Source:** AI Agent CLI research, Ben's Bites, DEV.to

### 6. Accessibility Standards

**Requirements:**
1. Text-based interface (keyboard-only navigation)
2. Screen reader compatible (structured output, not ASCII art)
3. Color-independent (use symbols + text, not just color)
4. High contrast support
5. Alternative formats (HTML docs for detailed reference)

**Avoid:**
- ASCII art decorations
- Color as only indicator
- Spinners without `--quiet` mode
- Unstructured wall of text

**Source:** ACM Accessibility Research, GitHub Blog, WCAG2ICT

### 7. Multi-Level Command Hierarchies

**Pattern:**
```
cli <group> <command> [subcommand] [options] [args]

Examples:
  eai types seed           # group + command
  eai resources list       # group + command
  eai deploy trigger       # group + command
```

**Help at each level:**
- `eai --help` → List groups
- `eai types --help` → List commands in group
- `eai types seed --help` → Detailed command help

**Source:** AWS CLI, kubectl, Commander.js patterns

### 8. Tab Completion Support

**Requirements:**
1. Shell completions for: bash, zsh, fish, PowerShell
2. Complete: command names, flags, arguments
3. Context-aware (adapt to previous arguments)
4. Help text in completions (when supported)

**Implementation:**
```bash
# Generate completions
eai completion bash > /etc/bash_completion.d/eai
eai completion zsh > ~/.zsh/completions/_eai
```

**Source:** Typer docs, CLI11 docs, argcomplete

## Recommendations

### Priority 1: Critical Fixes (1-2 hours)

1. **Implement JSON output blocks**
   - **Files:** `types.ts`, `resources.ts`, `deploy.ts`, `tenant.ts` (9 locations)
   - **Pattern:** `if (options.json) console.log(JSON.stringify(result, null, 2));`
   - **Impact:** Enables automation and AI agent usage

2. **Implement output utility functions**
   - **File:** `src/lib/output.ts`
   - **Functions:** `success()`, `error()`, `warn()`, `info()`, `heading()`, `dim()`, `table()`
   - **Impact:** Fixes broken styled output across all commands

3. **Standardize error messages**
   - **Files:** All command files
   - **Pattern:** "Problem statement. Actionable solution. (Error code: E001)"
   - **Impact:** Consistent, helpful error guidance

### Priority 2: Feature Additions (3-4 hours)

4. **Add `--format` flag**
   - **Files:** Commands that output structured data
   - **Options:** `text` (default), `json`, `yaml`
   - **Impact:** Flexible output for different use cases

5. **Implement `--describe` flag**
   - **Files:** All commands
   - **Output:** JSON schema of command structure
   - **Impact:** AI agents can discover capabilities at runtime

6. **Create error code system**
   - **File:** `src/lib/error-codes.ts`
   - **Categories:** Project (E001-E099), Auth (E100-E199), Platform (E200-E299)
   - **Impact:** Machine-parseable error handling

### Priority 3: Polish & Documentation (4-6 hours)

7. **Add `--examples` flag**
   - **Implementation:** `.addHelpText('afterAll', examplesText)`
   - **Content:** 2-5 examples per command
   - **Impact:** Improved discoverability

8. **Implement shell completion**
   - **Command:** `eai completion <shell>`
   - **Shells:** bash, zsh, fish
   - **Impact:** Better UX for daily users

9. **Create accessibility mode**
   - **Flag:** `--simple` or `--accessible`
   - **Output:** Plain text, no colors, no symbols
   - **Impact:** Screen reader compatibility

10. **Add man page generation**
    - **Tool:** Commander.js help → man format
    - **Distribution:** Package man pages with CLI
    - **Impact:** Standard Unix documentation

### Priority 4: Advanced Features (8+ hours)

11. **Implement `--fields` filter**
    - **Purpose:** Reduce output size for AI agents
    - **Syntax:** `--fields id,name,status`
    - **Impact:** Context window optimization

12. **Create interactive help**
    - **Command:** `eai help` (interactive search)
    - **Features:** Fuzzy search, navigation, examples
    - **Impact:** Improved discovery for new users

13. **Add help versioning**
    - **Track:** When help text changes
    - **Flag:** `--help-version` shows history
    - **Impact:** Debugging changed behavior

## Open Questions

1. **Should we support custom output formatters?**
   - Allow plugins to register new `--format` types?
   - Or keep format options fixed?

2. **How verbose should JSON error objects be?**
   - Include stack traces in JSON errors?
   - Or keep errors brief and use `--verbose` for details?

3. **Should we auto-detect piped output?**
   - When `stdout` is piped, default to JSON?
   - Or require explicit `--format json`?

4. **Man page distribution strategy?**
   - Package with npm (limited cross-platform support)?
   - Or provide web-based man page viewer?

5. **Completion installation automation?**
   - Auto-install completions during `npm install -g`?
   - Or require manual `eai completion install`?

## Implementation Approach

### Phase 1: Fix Critical Gaps (Week 1)

1. Implement output utility functions
2. Complete JSON output blocks
3. Standardize error messages
4. Add error code system

**Deliverable:** Functional JSON output, consistent errors

### Phase 2: Add Core Features (Week 2)

5. Implement `--format` flag
6. Add `--describe` for schema introspection
7. Enhance help text with examples
8. Add `--examples` flag

**Deliverable:** Feature-complete help system

### Phase 3: Polish & Accessibility (Week 3)

9. Implement shell completion
10. Add `--simple` mode for accessibility
11. Create comprehensive examples
12. Generate man pages

**Deliverable:** Production-ready, accessible CLI

### Phase 4: Advanced Features (Week 4+)

13. Interactive help browser
14. Field filtering
15. Help versioning
16. Plugin system for formatters

**Deliverable:** Best-in-class CLI help system

## Success Criteria

1. ✅ All `--json` flags produce valid JSON output
2. ✅ All output utility functions implemented and working
3. ✅ Error messages include error codes and actionable guidance
4. ✅ Help text follows progressive disclosure pattern
5. ✅ AI agents can introspect command schema via `--describe`
6. ✅ Screen readers can parse all output
7. ✅ Tab completion works in bash, zsh, fish
8. ✅ Examples provided for all commands
9. ✅ Documentation updated with new features
10. ✅ Tests cover all help scenarios

## References

### Industry Standards
- [POSIX Utility Conventions](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html)
- [GNU Command-Line Standards](https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html)
- [Command Line Interface Guidelines](https://clig.dev/)
- [Semantic Versioning 2.0.0](https://semver.org/)

### Leading CLIs
- [GitHub CLI Manual](https://cli.github.com/manual/)
- [kubectl Reference](https://kubernetes.io/docs/reference/kubectl/)
- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)

### Best Practices
- [10 Design Principles for Delightful CLIs - Atlassian](https://www.atlassian.com/blog/it-teams/10-design-principles-for-delightful-clis)
- [Building a More Accessible GitHub CLI - GitHub Blog](https://github.blog/engineering/user-experience/building-a-more-accessible-github-cli/)
- [Writing CLI Tools That AI Agents Want to Use - DEV](https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no)
- [Writing Helpful Error Messages - Google](https://developers.google.com/tech-writing/error-messages)

### Implementation Resources
- [Commander.js Documentation](https://github.com/tj/commander.js)
- [chalk - Terminal Styling](https://github.com/chalk/chalk)
- [argcomplete - Shell Completion](https://kislyuk.github.io/argcomplete/)

## Conclusion

The EAI CLI has a solid foundation with consistent help patterns across all commands. The critical gaps are in execution (empty function implementations) rather than design. By implementing the Priority 1 fixes, the CLI will become fully functional for automation scenarios. Priority 2-4 enhancements will bring it to best-in-class status, particularly for AI agent integration and accessibility.

The research reveals clear industry consensus on CLI help best practices:
- Progressive disclosure reduces cognitive load
- Machine-readable output is non-negotiable
- Error messages must be actionable
- Accessibility requires text structure, not just visual styling
- AI agents need schema introspection and deterministic behavior

Implementation should proceed incrementally, testing each phase before moving forward to ensure backward compatibility and maintain the CLI's current strengths.
