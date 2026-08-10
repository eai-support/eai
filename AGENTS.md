# AGENTS.md

## Feature Test Ownership

- When creating, updating, or removing feature behavior, update the owned tests in the same repo and PR. Do not hand feature testing to `eai-testing-dev` unless the deployed canary, route/config contract, auth/tenant smoke, or release evidence surface changes.
- Broad browser click-through paths belong in the owning frontend repo's Playwright CI/preview suite with controlled fixtures. Keep them out of prod cross-service checks except for stable read-only canaries and monitoring.
- Provider/data oddities belong in provider contract tests, mocked edge-case tests, and safe non-prod live provider smokes owned by the repo that implements the provider surface.
- Entra UI/session/cookie changes require controlled auth UI/session tests in the owning frontend repo. Deployed login-smoke plus role/tenant canaries live in `enterpriseaigroup/eai-testing-dev`.
- EAI CLI behavior is owned by `eai-support/eai` through `ci/eai-cli-tests`; `eai-testing-dev` only keeps deployed read-only CLI canaries and release-observability evidence aligned.
- Release/SRP evidence changes must keep CI check names, required-test metadata, coverage mappings, and any `eai-testing-dev` dispatch aliases in sync before promotion enforcement is tightened.

## Project Overview

- **Project**: eai
- **Language**: TypeScript
- **Package Manager**: npm

## Commands

- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Focused SRP CLI evidence**: `npm run test:eai-cli:ci`
- **Release preflight**: `npm run release:check`

## Project Structure

```
eai/
├── src/
│   ├── index.ts                 # Entry point, Commander.js program
│   ├── commands/                # Command modules
│   │   ├── init.ts              # Scaffold new app
│   │   ├── dev.ts               # Local dev server
│   │   ├── login.ts             # Auth (login/logout)
│   │   ├── whoami.ts            # Auth status
│   │   ├── user.ts              # User management
│   │   ├── env.ts               # Environment config
│   │   ├── types.ts             # Object Type management
│   │   ├── resources.ts         # CRUD operations
│   │   ├── tenant.ts            # Tenant management
│   │   ├── chat.ts              # AI chat workflows
│   │   ├── docs.ts              # Document operations
│   │   ├── deploy.ts            # Deployment
│   │   ├── verify.ts            # Platform checks (verify/doctor)
│   │   ├── gofer.ts             # Safe Gofer asset refresh for existing repos
│   │   └── update.ts            # CLI updates
│   └── lib/                     # Shared library modules
│       ├── api.ts               # PlatformAPIClient
│       ├── auth.ts              # Entra CIAM auth
│       ├── config.ts            # Config loader
│       ├── error-codes.ts       # Error code system
│       ├── gofer-refresh.ts     # Gofer manifest planning/apply
│       ├── output.ts            # Output utilities
│       ├── project-manifest.ts  # Project manifest persistence
│       ├── schema-builder.ts    # CLI schema introspection
│       └── update-check.ts      # Update checker
├── docs-site/                   # Docusaurus docs wrapper publishing from .tech-docs
├── .specify/                    # Gofer pipeline specs
│   └── specs/
│       └── cli-help-enhancement/
├── package.json                 # @enterpriseai/cli
├── tsconfig.json                # TypeScript strict ESM
├── CLAUDE.md                    # Workflow instructions
└── AGENTS.md                    # This file
```

## Code Style

### TypeScript Conventions

- Use strict mode (`"strict": true` in tsconfig.json)
- Use ESM imports (`import`/`export`), never `require()`
- Add explicit return types to all public functions
- Prefer `unknown` over `any`; use proper type narrowing
- Use `readonly` for properties that should not be reassigned
- Prefer interfaces over type aliases for object shapes

### CLI Patterns

**Command Structure** (Commander.js):
```typescript
import { Command } from 'commander';

export const myCommand = new Command('my-command')
  .description('Brief description')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--simple', 'Plain text output for screen readers')
  .action(async (options) => {
    // Command logic
  });
```

**Error Handling**:
```typescript
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

// Exit with structured error
exitWithError(ErrorCode.E101); // Not logged in

// Exit with context interpolation
exitWithError(ErrorCode.E002, { var: 'BASE_URL_PUBLIC_API' });

// Exit with format awareness
exitWithError(ErrorCode.E201, { url: apiUrl }, options.format);
```

**Output Utilities**:
```typescript
import { success, error, warn, info, symbols } from '../lib/output.js';

success('Operation completed');           // ✓ Operation completed
error('Something went wrong');            // ✗ Something went wrong
warn('Deprecation warning');              // ⚠ Deprecation warning
info('Additional context');               // → Additional context

// Respects --simple flag (ERROR: Something went wrong)
// Respects --no-color flag (no ANSI codes)
// Detects TTY automatically
```

**API Calls**:
```typescript
import { createAPIClient } from '../lib/api.js';
import { getToken } from '../lib/auth.js';

const token = await getToken();
const client = createAPIClient(token);
const result = await client.get('/v4/data/resources/object-types');
```

**Config Loading**:
```typescript
import { loadConfig } from '../lib/config.js';

const config = await loadConfig();
// Returns: { env vars from .env.local, eai.config.ts exports }
```

## Testing

- Write tests for new functionality before marking tasks complete
- Run the full test suite before committing

## Git Workflow

- Use conventional commit messages (feat:, fix:, chore:, docs:)
- Create feature branches for new work
- Run tests and linting before committing

## Release Workflow

- `./release.sh <patch|minor|major> "Message"` is the canonical human release entrypoint
- `release.sh` must remain aligned with:
  - `.github/workflows/release.yml`
  - `.github/workflows/docs.yml`
  - `src/commands/update.ts`
  - `src/lib/update-check.ts`
  - `README.md`
- Every release should refresh `docs-site/static/llms.txt`, `docs-site/static/llms-full.txt`, and `docs-site/static/cli-help.txt`
- CLI auth, tenant context, command schema, error envelope, PublicAPI, and preview-lifecycle behavior must keep `ci/eai-cli-tests` green. That check is the repo-owned SRP evidence for the EAI CLI surface.
- The release workflow dispatches `eai-testing-dev` with `service=eai-cli` for deployed read-only schema/error/auth smoke. Keep prod canaries read-only; preview lifecycle is opt-in and cleanup-backed.
- npmjs is the primary release/install channel; GitHub Pages static registry is
  the fallback channel
- Before changing release behavior, verify npmjs and the public fallback
  packument still work:
  - `npm view eai-cli version --registry=https://registry.npmjs.org/`
  - `npm view @enterpriseai/cli version --registry=https://registry.npmjs.org/ --@enterpriseai:registry=https://registry.npmjs.org/`
  - `curl https://eai-support.github.io/eai/registry/@enterpriseai/cli`
- Recommended install is `npm install -g eai-cli`
- Canonical package install is `npm install -g @enterpriseai/cli`
- Static fallback install is `npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/`
- Persistent static fallback setup is `npm config set @enterpriseai:registry https://eai-support.github.io/eai/registry/ --location=user`
- `eai update` upgrades the installed CLI package only
- `eai gofer refresh --check` previews safe repo-local Gofer asset updates
- `eai template check` previews app-template and UI drift for existing repos without writing files
- Template or UI component changes are not auto-merged; review the preview before copying changes manually

## Boundaries

- Do not modify files outside the project scope without approval
- Do not commit secrets, API keys, or credentials
- Do not add dependencies without justification

## Core Principles

### Workflow Principles

1. **Plan First**
   - Enter plan mode for ANY non-trivial task (3+ steps or architectural
     decisions)
   - If something goes sideways, STOP and re-plan immediately — don't keep
     pushing
   - Use plan mode for verification steps, not just building
   - Write detailed specs upfront to reduce ambiguity

2. **Use Subagents**
   - Use subagents liberally to keep main context window clean
   - Offload research, exploration, and parallel analysis to subagents
   - For complex problems, throw more compute at it via subagents
   - One task per subagent for focused execution

3. **Self-Improvement**
   - After ANY correction from the user: update lessons file with the pattern
   - Write rules for yourself that prevent the same mistake
   - Ruthlessly iterate on these lessons until mistake rate drops
   - Review lessons at session start for relevant project

4. **Verify Before Done**
   - Never mark a task complete without proving it works
   - Never state anything that you do not know is correct, do not make
     assumptions, and always cite the latest on the internet or from information
     you have
   - Diff behavior between main and your changes when relevant
   - Ask yourself: "Would a staff engineer approve this?"
   - Run tests, check logs, demonstrate correctness

5. **Demand Elegance**
   - For non-trivial changes: pause and ask "is there a more elegant way?"
   - If a fix feels hacky: "Knowing everything I know now, implement the elegant
     solution"
   - Skip this for simple, obvious fixes — don't over-engineer
   - Challenge your own work before presenting it

6. **Autonomous Bug Fixing**
   - When given a bug report: just fix it. Don't ask for hand-holding
   - Point at logs, errors, failing tests — then resolve them
   - Zero context switching required from the user
   - Go fix failing CI tests without being told how

### Task Management

1. **Plan First**: Write plan with checkable items before starting
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to task tracking
6. **Capture Lessons**: Update lessons file after corrections

### Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal
  code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer
  standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid
  introducing bugs.
