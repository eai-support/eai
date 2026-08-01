# Codebase Guide

Complete reference for the EAI CLI codebase architecture, patterns, and conventions.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Commands](#commands)
- [Libraries](#libraries)
- [Patterns](#patterns)
- [Adding Features](#adding-features)

## Overview

**Package**: `@enterpriseai/cli`
**Language**: TypeScript 5.7 (strict mode, ESM)
**Framework**: Commander.js 13.x
**Node.js**: ≥20.0.0

The CLI provides a developer-friendly interface to the EAI Platform, abstracting away all platform internals. Every command wraps platform API calls with clear error messages, structured error codes, and machine-readable output.

## Directory Structure

```
src/
├── index.ts                 # Entry point, Commander program, global flags
├── commands/                # 14 command modules
│   ├── init.ts              # eai init - Scaffold from eai-app-template
│   ├── dev.ts               # eai dev - Local dev server
│   ├── login.ts             # eai login/logout - Entra CIAM auth
│   ├── whoami.ts            # eai whoami - Auth status
│   ├── user.ts              # eai user - User management
│   ├── env.ts               # eai env - Environment variables
│   ├── types.ts             # eai types - Object Type management
│   ├── resources.ts         # eai resources - CRUD operations
│   ├── tenant.ts            # eai tenant - Tenant management
│   ├── chat.ts              # eai chat - AI workflows
│   ├── docs.ts              # eai docs - Document operations
│   ├── deploy.ts            # eai deploy - Deployment
│   ├── verify.ts            # eai verify/doctor - Platform checks
│   └── update.ts            # eai update - CLI updates
└── lib/                     # 9 shared library modules
    ├── api.ts               # PlatformAPIClient (fetch wrapper)
    ├── auth.ts              # Entra CIAM browser auth (authorization code + PKCE)
    ├── config.ts            # Load .env.local + eai.config.ts
    ├── error-codes.ts       # Structured error codes (E001-E399)
    ├── output.ts            # Output utilities (symbols, colors, TTY)
    ├── schema-builder.ts    # JSON schema for --describe flag
    └── update-check.ts      # GitHub releases API check
```

## Commands

### Command Module Pattern

All commands follow this structure:

```typescript
import { Command } from "commander";
import { createAPIClient } from "../lib/api.js";
import { getToken } from "../lib/auth.js";
import { ErrorCode, exitWithError } from "../lib/error-codes.js";
import { success, error } from "../lib/output.js";

export const myCommand = new Command("my-command")
  .description("Brief description for --help")
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (options) => {
    try {
      // 1. Validate prerequisites
      const token = await getToken();
      if (!token) {
        exitWithError(ErrorCode.E101, undefined, options.format);
      }

      // 2. Call platform API
      const client = createAPIClient(token);
      const result = await client.get("/v3/endpoint");

      // 3. Handle output format
      if (options.format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        success(`Operation completed: ${result.data.length} items`);
      }
    } catch (err) {
      exitWithError(ErrorCode.E203, { details: err.message }, options.format);
    }
  });
```

### Command Groups

| Group           | Commands              | Purpose                             |
| --------------- | --------------------- | ----------------------------------- |
| **Scaffolding** | init, dev             | Project setup and local development |
| **Auth**        | login, logout, whoami | Authentication and identity         |
| **Config**      | env                   | Environment variables and secrets   |
| **Schema**      | types                 | Object Type definitions             |
| **Data**        | resources, tenant     | CRUD operations                     |
| **AI**          | chat, docs            | AI workflows and documents          |
| **Deploy**      | deploy                | GitHub Actions deployment           |
| **Diagnostics** | verify, doctor        | Platform health checks              |
| **Maintenance** | update, user          | CLI updates and user management     |

## Libraries

### api.ts - Platform API Client

```typescript
import { createAPIClient } from "./lib/api.js";

const client = createAPIClient(token);

// GET request
const result = await client.get("/v3/object-types");

// POST request
const created = await client.post("/v3/resources", { data });

// PUT request
const updated = await client.put("/v3/resources/123", { data });

// DELETE request
await client.delete("/v3/resources/123");
```

**Key features**:

- Bearer token authentication
- Automatic error handling
- JSON request/response
- Base URL from `BASE_URL_PUBLIC_API` env var

### auth.ts - Authentication

```typescript
import { getToken, saveToken, clearToken } from "./lib/auth.js";

// Get stored token (or undefined)
const token = await getToken();

// Save token after login
await saveToken({ accessToken, refreshToken, expiresAt });

// Clear token on logout
await clearToken();
```

**Token storage**: `~/.eai/tokens.json`
**Flow**: Entra CIAM browser auth (authorization code + PKCE)

### config.ts - Configuration Loader

```typescript
import { loadConfig } from "./lib/config.js";

const config = await loadConfig();
// Returns: { BASE_URL_PUBLIC_API, TENANT_ID, ... }
```

**Sources** (in order):

1. `.env.local` (dotenv)
2. `eai.config.ts` (TypeScript exports)
3. `process.env` (system environment)

### error-codes.ts - Error Handling

```typescript
import { ErrorCode, exitWithError, formatError } from "./lib/error-codes.js";

// Exit with error (text or JSON format)
exitWithError(ErrorCode.E101); // Not logged in
exitWithError(ErrorCode.E002, { var: "BASE_URL_PUBLIC_API" });
exitWithError(ErrorCode.E201, { url: apiUrl }, "json");

// Format error without exiting
const errorMessage = formatError(ErrorCode.E101);
```

**Error code categories**:

- **E001-E099**: Project errors (config, not in project)
- **E100-E199**: Auth errors (not logged in, token expired)
- **E200-E299**: Platform errors (API down, not found)
- **E300-E399**: Validation errors (invalid schema, missing field)

### output.ts - Output Utilities

```typescript
import { success, error, warn, info, symbols } from "./lib/output.js";

success("Operation completed"); // ✓ Operation completed
error("Something went wrong"); // ✗ Something went wrong
warn("Deprecation warning"); // ⚠ Deprecation warning
info("Additional context"); // → Additional context
```

**Symbols**:

```typescript
symbols.success; // ✓ (green)
symbols.error; // ✗ (red)
symbols.warning; // ⚠ (yellow)
symbols.info; // → (blue)
symbols.pending; // ○ (gray)
symbols.updated; // ↻ (cyan)
symbols.unchanged; // = (gray)
symbols.added; // + (green)
symbols.removed; // - (red)
symbols.changed; // ~ (yellow)
```

**Color handling**:

- Respects `--no-color` flag
- Respects `NO_COLOR` environment variable
- Respects `FORCE_COLOR` environment variable
- Auto-detects TTY (disables colors when piped)

**Simple mode** (for screen readers):

- `--simple` flag converts symbols to text: `SUCCESS:`, `ERROR:`, `WARNING:`, `INFO:`
- No ANSI escape codes
- Pure ASCII output

### schema-builder.ts - CLI Introspection

```typescript
import { describeProgram } from "./lib/schema-builder.js";

const schema = describeProgram(program);
console.log(JSON.stringify(schema, null, 2));
```

Used by `--describe` flag to output JSON schema of CLI structure for AI agents.

### update-check.ts - Version Management

```typescript
import { checkForUpdate, notifyIfUpdateAvailable } from "./lib/update-check.js";

// Check for updates (async, non-blocking)
await checkForUpdate(currentVersion);

// Notify user if update available (called at end of command)
await notifyIfUpdateAvailable(currentVersion);
```

Checks GitHub releases API once per day, stores last check in `~/.eai/last-update-check`.

## Patterns

### Global Flags

Defined in `src/index.ts`, available on all commands:

```typescript
program
  .option("--simple", "Plain text output without colors or symbols")
  .option("--no-color", "Disable colored output")
  .option("--color", "Force colored output")
  .option("--describe", "Output JSON schema of all commands")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.simple) {
      setSimpleMode(true);
    }

    if (opts.noColor) {
      process.env.NO_COLOR = "1";
    }

    if (opts.color) {
      process.env.FORCE_COLOR = "1";
    }
  });
```

### Format Flag

Commands with structured output should support `--format`:

```typescript
.option('--format <format>', 'Output format (text|json)', 'text')
.action(async (options) => {
  const data = await fetchData();

  if (options.format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Human-readable text output
    success(`Found ${data.length} items`);
    data.forEach(item => {
      console.log(`  ${symbols.info} ${item.name}`);
    });
  }
});
```

### Error Handling

Always use structured error codes:

```typescript
try {
  const result = await riskyOperation();
} catch (err) {
  // Use specific error code with context
  exitWithError(ErrorCode.E203, { details: err.message }, options.format);
}
```

**Never**:

```typescript
// ❌ Don't do this
console.error("Error:", err.message);
process.exit(1);
```

**Always**:

```typescript
// ✅ Do this
exitWithError(ErrorCode.E203, { details: err.message }, options.format);
```

### API Calls

```typescript
// 1. Get token
const token = await getToken();
if (!token) {
  exitWithError(ErrorCode.E101, undefined, options.format);
}

// 2. Create client
const client = createAPIClient(token);

// 3. Make request with error handling
try {
  const result = await client.get("/v3/endpoint");
  return result;
} catch (err) {
  exitWithError(ErrorCode.E203, { details: err.message }, options.format);
}
```

### Help Text

Use Commander's declarative help:

```typescript
export const myCommand = new Command("my-command")
  .description("Brief description (1 line)")
  .option("--tenant-key <key>", "Target tenant (default: from .env.local)")
  .option("--format <format>", "Output format (text|json)", "text")
  .addHelpText(
    "after",
    `
Examples:
  $ eai my-command
  $ eai my-command --tenant-key acme
  $ eai my-command --format json
  `,
  )
  .action(async (options) => {
    /* ... */
  });
```

## Adding Features

### Adding a New Command

1. **Create command file** in `src/commands/`:

```typescript
// src/commands/my-new-command.ts
import { Command } from "commander";
import { ErrorCode, exitWithError } from "../lib/error-codes.js";
import { success } from "../lib/output.js";

export const myNewCommand = new Command("my-new-command")
  .description("What this command does")
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (options) => {
    // Implementation
    success("Done!");
  });
```

2. **Register in `src/index.ts`**:

```typescript
import { myNewCommand } from "./commands/my-new-command.js";

program.addCommand(myNewCommand);
```

3. **Update documentation**:
   - Add to `README.md` commands table
   - Add to docs site (`docs/src/content/docs/reference/commands/`)
   - Add examples to `docs/src/content/docs/examples/`

### Adding a New Error Code

1. **Add to enum** in `src/lib/error-codes.ts`:

```typescript
export enum ErrorCode {
  // ...
  E999 = "E999", // Your new error code
}
```

2. **Add to catalog**:

```typescript
export const errorCatalog: Record<ErrorCode, Omit<ErrorDefinition, "code">> = {
  // ...
  [ErrorCode.E999]: {
    message: "What went wrong",
    suggestion: "How to fix it",
  },
};
```

3. **Use in commands**:

```typescript
exitWithError(ErrorCode.E999, { contextVar: "value" }, options.format);
```

### Adding a New Output Utility

1. **Add function** to `src/lib/output.ts`:

```typescript
export function myUtility(text: string): void {
  if (simpleMode) {
    console.log(`MY_UTILITY: ${text}`);
  } else {
    console.log(`${symbols.info} ${chalk.cyan(text)}`);
  }
}
```

2. **Use in commands**:

```typescript
import { myUtility } from "../lib/output.js";

myUtility("This is my custom output");
```

### Adding Global Flags

Add to `src/index.ts` program options:

```typescript
program
  .option("--my-flag", "What this flag does")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.myFlag) {
      // Handle flag globally
    }
  });
```

---

## Testing

Run tests with:

```bash
npm test           # Run once
npm run test:watch # Watch mode
npm run test:ui    # UI mode
npm run coverage   # Coverage report
```

## Build and Release

```bash
npm run build      # Compile TypeScript
npm run typecheck  # Type check without emitting
npm run lint       # Run ESLint
./release.sh patch "Release message"
```

See [README.md](README.md#releasing) for full release process.

## Documentation

- **README.md** - User-facing documentation (installation, commands, architecture)
- **CLAUDE.md** - Workflow instructions for AI agents
- **AGENTS.md** - Project conventions and patterns
- **CODEBASE.md** - This file (comprehensive technical reference)
- **docs/** - Full documentation site (93 pages, Starlight/Astro)

## License

MIT - see [LICENSE](LICENSE)
