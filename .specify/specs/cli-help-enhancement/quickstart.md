# Quickstart: CLI Help System Enhancement

## Prerequisites

- Node.js ≥ 20.0.0
- npm (comes with Node.js)
- EAI CLI codebase cloned locally
- TypeScript 5.7 knowledge
- Commander.js 13.x familiarity

## Setup

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Build the CLI**:
   ```bash
   npm run build
   ```

3. **Link CLI locally** for testing:
   ```bash
   npm link
   ```

4. **Verify CLI works**:
   ```bash
   eai --help
   ```

## Testing the Feature

### Phase 1: Output Utilities

After implementing Phase 1 (Foundation & Output Layer):

```bash
# Test TTY detection
eai types seed
eai types seed | cat    # Should disable colors when piped

# Test NO_COLOR
NO_COLOR=1 eai types seed

# Test --simple mode
eai types seed --simple

# Test --no-color flag
eai types seed --no-color
```

**Expected results**:
- Colors appear in terminal, but not when piped
- `NO_COLOR=1` disables all colors
- `--simple` shows text labels (SUCCESS, ERROR) instead of symbols (✓, ✗)
- `--no-color` disables colors

### Phase 2: Error Codes

After implementing Phase 2 (Error Code System):

```bash
# Test error codes in text mode
cd /tmp && eai types seed
# Expected: "✗ Not in an EAI project. Error code: E001. Exit code: 1"

# Test error codes in JSON mode
cd /tmp && eai types seed --format json
# Expected: {"error":{"code":"E001","message":"Not in an EAI project","suggestion":"...","exitCode":1}}
```

**Expected results**:
- All errors show error codes (E001-E399)
- Text errors show "Error code: EXXX" at the end
- JSON errors include structured error object

### Phase 3: JSON Output

After implementing Phase 3 (JSON Output Implementation):

```bash
# Test types commands
eai types seed --format json
eai types diff --format json
eai types pull --format json

# Test resources commands
eai resources list --format json
eai resources get <id> --format json

# Test tenant commands
eai tenant list --format json

# Test deploy commands
eai deploy status --format json

# Test env commands
eai env list --format json
```

**Expected results**:
- All commands produce valid JSON (parseable by `JSON.parse()`)
- No ANSI codes or progress indicators in JSON output
- JSON schema is consistent

**Verify JSON validity**:
```bash
eai types seed --format json | jq .
# Should pretty-print JSON without errors
```

### Phase 4: Format Flag

After implementing Phase 4 (Format Flag Support):

```bash
# Test format flag
eai types seed --format text
eai types seed --format json
eai types seed --format yaml  # (optional P2)

# Test invalid format
eai types seed --format invalid
# Expected: "Invalid format 'invalid'. Use: text, json, yaml"

# Test backward compatibility
eai types seed --json
# Should work the same as --format json
```

**Expected results**:
- `--format text` shows human-readable output
- `--format json` shows machine-readable JSON
- Invalid format shows error with valid options
- Existing `--json` flag still works

### Phase 5: Schema Introspection

After implementing Phase 5 (Schema Introspection):

```bash
# Test --describe flag
eai --describe
eai types --describe
eai types seed --describe

# Verify JSON schema validity
eai types seed --describe | jq .
```

**Expected results**:
- `--describe` outputs valid JSON schema
- Schema includes command name, description, options
- Schema includes option types, defaults, constraints

### Phase 6: Examples and Help

After implementing Phase 6 (Examples and Help Enhancement):

```bash
# Test --examples flag
eai types seed --examples
eai resources list --examples
eai tenant create --examples

# Test enhanced help
eai --help
eai types --help
```

**Expected results**:
- `--examples` shows 2-5 practical usage examples
- Examples are copy-pasteable
- Root `--help` shows improved footer with workflow sections
- Help text is clear and scannable

### Phase 7: Testing

After implementing Phase 7 (Testing and Validation):

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- tests/unit/output.test.ts
npm test -- tests/unit/error-codes.test.ts
npm test -- tests/integration/json-output.test.ts

# Run with coverage
npm run test:coverage
```

**Expected results**:
- All tests pass
- Code coverage ≥ 80%
- No performance regression

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/output.ts` | Output utility functions (success, error, json, etc.) |
| `src/lib/error-codes.ts` | Error code definitions and formatting |
| `src/lib/schema-builder.ts` | Command schema introspection |
| `src/index.ts` | Global flags (--describe, --simple, --format) |
| `src/commands/types.ts` | Example command with format flag, examples |
| `tests/unit/output.test.ts` | Unit tests for output utilities |
| `tests/integration/json-output.test.ts` | Integration tests for JSON output |

## Common Issues

### Issue 1: Colors still showing when piped

**Problem**: Colors appear in piped output even though TTY detection is implemented

**Solution**: Ensure `chalk.level` is respected, check `process.stdout.isTTY` before using colors:

```typescript
const useColors = process.stdout.isTTY && !process.env.NO_COLOR;
if (useColors) {
  console.log(chalk.green('Success'));
} else {
  console.log('Success');
}
```

### Issue 2: JSON output contains ANSI codes

**Problem**: JSON output includes ANSI escape codes from `chalk`

**Solution**: Disable all spinners and colored output when `format === 'json'`:

```typescript
if (options.format !== 'json') {
  spinner.start('Loading...');
}

// Later...
if (options.format === 'json') {
  out.json(data);
} else {
  console.log(chalk.green(data));
}
```

### Issue 3: --json flag not working after migration

**Problem**: Existing `--json` flag no longer works

**Solution**: Add backward compatibility alias in command definition:

```typescript
.option('--json', 'Output raw JSON (deprecated, use --format json)', false)
.option('--format <format>', 'Output format (text|json|yaml)', 'text')
.action(async (options) => {
  // Map --json to --format json for backward compatibility
  if (options.json) {
    options.format = 'json';
  }
  // ...
});
```

### Issue 4: Schema introspection missing option types

**Problem**: `--describe` output doesn't include option types or defaults

**Solution**: Introspect Commander.js command metadata:

```typescript
function buildCommandSchema(command: Command): object {
  const options = command.options.map(opt => ({
    name: opt.flags,
    type: inferOptionType(opt),  // Implement type inference
    default: opt.defaultValue,
    description: opt.description,
  }));
  // ...
}
```

### Issue 5: Tests failing due to encrypted tokens

**Problem**: Integration tests fail because tokens aren't being read

**Solution**: Use the existing `userIsLoggedIn()` helper from test DSL:

```typescript
import { userIsLoggedIn } from '../helpers/setup-dsl.js';

beforeEach(async () => {
  await userIsLoggedIn(ctx, { email: 'test@example.com' });
});
```

## Manual Testing Checklist

Before marking a phase complete:

- [ ] Test in terminal (TTY mode)
- [ ] Test piped output (`eai command | cat`)
- [ ] Test with `NO_COLOR=1`
- [ ] Test with `--simple` flag
- [ ] Test with `--format json`
- [ ] Test with invalid inputs (error paths)
- [ ] Test on macOS (primary platform)
- [ ] Test on Linux (if available)
- [ ] Test with screen reader (VoiceOver on macOS)
- [ ] Verify JSON validity with `jq`
- [ ] Check for ANSI codes in JSON output
- [ ] Verify error codes are correct

## Performance Benchmarking

To measure performance impact:

```bash
# Baseline (before changes)
time eai --help
time eai types seed --dry-run

# After implementation
time eai --help
time eai types seed --dry-run
time eai types seed --format json
time eai --describe

# Compare results
# Help text should be < 50ms
# JSON formatting should add < 10ms
# Schema introspection should be < 100ms
```

## Accessibility Testing

To test with screen reader:

1. **Enable VoiceOver** (macOS):
   - Press `Cmd + F5` to enable VoiceOver
   - Or: System Preferences → Accessibility → VoiceOver → Enable

2. **Run CLI commands**:
   ```bash
   eai --help
   eai types seed --simple
   eai types seed --format json
   ```

3. **Verify**:
   - Help text is read clearly by VoiceOver
   - `--simple` mode is screen reader friendly
   - No important information conveyed by color alone

4. **Disable VoiceOver**:
   - Press `Cmd + F5` again

## Next Steps

After completing all phases:

1. Run full test suite: `npm test`
2. Run lint: `npm run lint`
3. Build: `npm run build`
4. Manual testing with checklist above
5. Performance benchmarking
6. Accessibility testing
7. Update documentation
8. Create PR for review

## Useful Commands

```bash
# Development
npm run build                # Build TypeScript
npm run lint                 # Lint code
npm test                     # Run tests
npm run test:watch           # Watch mode
npm run test:ui              # Visual test UI

# Testing CLI
eai --help                   # Show help
eai --version                # Show version
eai --describe               # Show schema (after Phase 5)
eai <command> --examples     # Show examples (after Phase 6)
eai <command> --format json  # JSON output (after Phase 3)
eai <command> --simple       # Simple mode (after Phase 1)

# Debugging
node --inspect-brk bin/eai.js types seed  # Debug with Node inspector
DEBUG=* eai types seed                     # Enable debug logging (if implemented)
```

## Resources

- [Commander.js Documentation](https://github.com/tj/commander.js)
- [chalk Documentation](https://github.com/chalk/chalk)
- [Vitest Documentation](https://vitest.dev/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [JSON Schema Draft 7](https://json-schema.org/draft-07/json-schema-release-notes.html)
