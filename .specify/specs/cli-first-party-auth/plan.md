---
feature: cli-first-party-auth
spec: .specify/specs/cli-first-party-auth/spec.md
research: .specify/specs/cli-first-party-auth/research.md
status: ready
created: '2026-03-26T00:00:00.000Z'
---

# Implementation Plan: CLI First-Party Authentication

**Branch**: `cli-first-party-auth` | **Spec**: `.specify/specs/cli-first-party-auth/spec.md`

## Summary

Remove the `ENTRA_CLIENT_ID` configuration requirement from `eai login` by embedding a
single hardcoded `DEFAULT_CLIENT_ID` constant (public client, EAI-owned App Registration)
into `login.ts` — the same pattern already used for `DEFAULT_TENANT_NAME`,
`DEFAULT_TENANT_ID`, and `DEFAULT_SCOPE`. Simultaneously fix a bug where the device code
verification URL and user code are never displayed to the user. Clean up all downstream
references to `ENTRA_CLIENT_ID` in `init.ts`, `verify.ts`, `dev.ts`, and `config.ts`.
Total change surface: 6 files, ~25 lines deleted, ~5 lines added.

---

## Technical Context

**Tech Stack**: TypeScript 5.7.2 ESM strict, Node.js 18+, Commander.js, node:fetch API  
**Primary Dependencies**: `commander`, `chalk` (both already in use; no new deps)  
**Testing**: Vitest — run `npm test` before and after to confirm baseline holds  
**Target Platform**: Node.js CLI binary distributed via npm  
**Constraints**: No new dependencies; no breaking changes to `deviceCodeLogin()` signature;
no token-storage format changes; `StoredTokens.clientId` must be retained

### Auth Flow: Before vs After

```
BEFORE                              AFTER
──────                              ─────
eai login                           eai login
  ├─ read --client-id flag            └─ use DEFAULT_CLIENT_ID constant
  ├─ OR read .env.local                   └─ deviceCodeLogin(tenantName,
  │     ENTRA_CLIENT_ID                         tenantId,
  ├─ OR read process.env                        DEFAULT_CLIENT_ID,   ← hardcoded
  │     ENTRA_CLIENT_ID                         scope)
  └─ OR process.exit(1)                   └─ console.log(deviceCode.message)
                                                  ← URL + user code shown
```

### Integration Points

| Component | File | Change Type | Current Lines |
|-----------|------|-------------|---------------|
| Hardcoded constants | `src/commands/login.ts` | Add constant | After line 14 |
| `--client-id` Commander option | `src/commands/login.ts` | Delete line | Line 20 |
| clientId resolution block | `src/commands/login.ts` | Delete block | Lines 23–37 |
| `clientId` display line | `src/commands/login.ts` | Delete line | Line 41 |
| `deviceCodeLogin()` call arg | `src/commands/login.ts` | Update reference | Line 47 |
| Device code message display | `src/lib/auth.ts` | Add `console.log` | After line 160 |
| `EAIProjectConfig.entra.clientId` | `src/lib/config.ts` | Mark optional | Line 24 |
| `resolveProjectConfig()` return | `src/lib/config.ts` | Mark optional | Line 232 |
| `.env.local` scaffold template | `src/commands/init.ts` | Delete 2 lines | Lines 267–268 |
| `required[]` array | `src/commands/verify.ts` | Remove item | Line 170 |
| Auth pre-flight check | `src/commands/dev.ts` | Update condition | Lines 64–68 |

### Key Dependencies (No Change)

- `deviceCodeLogin()` signature in `auth.ts` — unchanged; receives hardcoded value
- `StoredTokens.clientId` field in `auth.ts` — retained; used by `refreshAccessToken()`
- `tests/helpers/setup-dsl.ts:50` — `clientId: 'test-client-id'` in fake token; no change
- `--tenant-name`, `--tenant-id`, `--scope` flags on `login` — preserved

---

## Placeholder Strategy

Until EAI provides the real App Registration GUID, use the string
`'EAI_CLI_CLIENT_ID_PLACEHOLDER'` as the constant value. This string:

1. Is clearly not a valid GUID — it will cause a `400 Bad Request` from Entra rather than
   silently misbehaving
2. Is grep-searchable: `grep -r EAI_CLI_CLIENT_ID_PLACEHOLDER src/`
3. Matches the naming used in `research.md` and `spec.md` (FR-01)

When EAI confirms the real GUID, replace the placeholder with a single-line edit:

```typescript
// src/commands/login.ts — find and replace this one line
const DEFAULT_CLIENT_ID = 'EAI_CLI_CLIENT_ID_PLACEHOLDER';
// → const DEFAULT_CLIENT_ID = '<real-guid-from-eai>';
```

---

## FR-08 Resolution: `EAIProjectConfig.entra.clientId`

**Decision**: Mark `clientId` as **optional** (`clientId?: string`) rather than removing it.

**Rationale**: `resolveProjectConfig()` is a public export that may be consumed by vertical
app runtime code outside the CLI. Removing the field is a breaking change; marking it
optional is backward-compatible and signals that the field is no longer required. The
function already returns an empty string fallback (`env.ENTRA_CLIENT_ID || ''`) — changing
this to `env.ENTRA_CLIENT_ID || undefined` aligns with optional semantics. If a vertical
app currently checks `config.entra.clientId` it will still compile and run correctly
(value is `undefined` instead of `''`).

---

## Implementation Phases

### Phase 1: Core Auth Change — `src/commands/login.ts`

**Goal**: Replace the 3-path clientId resolution with a single hardcoded constant; remove
the `--client-id` flag; keep all other flags and login behaviour identical.

#### Tasks

**T1.1 — Add `DEFAULT_CLIENT_ID` constant** (after line 14)

```typescript
// src/commands/login.ts — add after line 14
const DEFAULT_CLIENT_ID = 'EAI_CLI_CLIENT_ID_PLACEHOLDER';
```

Follows the exact same pattern as `DEFAULT_TENANT_NAME`, `DEFAULT_TENANT_ID`, and
`DEFAULT_SCOPE` on lines 12–14.

**T1.2 — Remove `--client-id` Commander option** (line 20)

Delete this line:
```typescript
  .option('--client-id <id>', 'App registration client ID')
```

**T1.3 — Delete clientId resolution block** (lines 23–37)

Delete this entire block (15 lines):
```typescript
    let clientId = options.clientId;

    // Try to resolve client ID from project config
    if (!clientId) {
      const root = await findProjectRoot();
      if (root) {
        const env = await loadEnvFile(root);
        clientId = env.ENTRA_CLIENT_ID || process.env.ENTRA_CLIENT_ID;
      }
    }

    if (!clientId) {
      out.error('No client ID provided. Use --client-id or set ENTRA_CLIENT_ID in .env.local');
      process.exit(1);
    }
```

**T1.4 — Remove `clientId` display line** (currently line 41, renumbers after T1.3)

Delete this line (the Client ID is an internal implementation detail; not useful to display):
```typescript
    out.info(`Client: ${chalk.dim(clientId)}`);
```

**T1.5 — Update `deviceCodeLogin()` call to use constant** (currently line 47)

Change `clientId` (the now-deleted variable) to `DEFAULT_CLIENT_ID`:
```typescript
      // BEFORE
      clientId,
      // AFTER
      DEFAULT_CLIENT_ID,
```

**T1.6 — Remove now-unused imports** (lines 8–9)

After the resolution block is deleted, `findProjectRoot` and `loadEnvFile` are no longer
called in `login.ts`. Remove them from the import:
```typescript
// BEFORE
import { findProjectRoot, loadEnvFile } from '../lib/config.js';
// AFTER — remove this import entirely (line 8-9)
// (no config.js imports remain in login.ts)
```

#### Verification

- `eai login --help` output contains no `--client-id`, no `ENTRA_CLIENT_ID`
- Running `eai login` on a machine with no `.env.local` and no `ENTRA_CLIENT_ID` env var
  proceeds to the device code flow (reaches Entra endpoint, fails with `400` on placeholder
  client ID — correct behaviour until real GUID is provided)
- `eai login --tenant-name foo --tenant-id bar --scope baz` still works (flags preserved)
- `npx tsc --noEmit` passes

---

### Phase 2: Bug Fix — `src/lib/auth.ts`

**Goal**: Display the device code message (URL + user code) returned by the Entra endpoint
so users know where to go and what to enter.

#### Tasks

**T2.1 — Add `console.log` for device code message** (after line 160)

```typescript
// src/lib/auth.ts — replace comment on line 162 with actual output
// BEFORE (line 162):
  // Display message to user

// AFTER:
  console.log(`\n${deviceCode.message}\n`);
```

The `message` field is part of the `DeviceCodeResponse` interface already defined at
`auth.ts:34`. The Entra CIAM device code endpoint always populates this field with a
human-readable string such as:
> "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and
> enter the code XXXXXXXX to authenticate."

The `\n` wrappers before and after visually separate the instruction from surrounding
`out.*` output (satisfying FR-04 and NFR-05).

#### Verification

- Running `eai login` (with real Client ID) shows the Entra message in the terminal before
  polling begins
- The message appears on its own lines, separated from the `Authenticating with Entra CIAM`
  heading and subsequent output
- `npx tsc --noEmit` passes (no signature change)

---

### Phase 3: Cleanup — 4 files

**Goal**: Remove all remaining `ENTRA_CLIENT_ID` references from the CLI surface.

#### Tasks

**T3.1 — `src/commands/init.ts`: Remove 2 lines from `.env.local` scaffold** (lines 267–268)

```typescript
// BEFORE (lines 267-268 inside the template string):
ENTRA_CLIENT_ID=<your-app-client-id>
ENTRA_CLIENT_SECRET=<your-app-client-secret>

// AFTER: both lines deleted
// (ENTRA_TENANT_NAME, ENTRA_TENANT_ID, ENTRA_SCOPES on adjacent lines remain)
```

Result: generated `.env.local` retains `ENTRA_TENANT_NAME`, `ENTRA_TENANT_ID`, and
`ENTRA_SCOPES` but omits `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`.

**T3.2 — `src/commands/verify.ts`: Remove `ENTRA_CLIENT_ID` from `required[]`** (line 170)

```typescript
// BEFORE (line 170):
    const required = ['BASE_URL_PUBLIC_API', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'AUTH_SECRET'];

// AFTER:
    const required = ['BASE_URL_PUBLIC_API', 'ENTRA_TENANT_ID', 'AUTH_SECRET'];
```

**T3.3 — `src/commands/dev.ts`: Update auth pre-flight check** (lines 64–68)

The existing check validates both `ENTRA_CLIENT_ID` and `ENTRA_TENANT_ID`. The CLI no
longer needs `ENTRA_CLIENT_ID` from the project environment — authentication is handled
by the hardcoded first-party client. The check should only validate `ENTRA_TENANT_ID`
(which is still needed for server-side app auth in the vertical's own Next.js stack).

```typescript
// BEFORE (lines 64-68):
      if (env.ENTRA_CLIENT_ID && env.ENTRA_TENANT_ID) {
        out.success(`Auth configured for tenant ${chalk.dim(env.ENTRA_TENANT_ID)}`);
      } else {
        out.warn('Entra auth not configured. Login will not work.');
      }

// AFTER:
      if (env.ENTRA_TENANT_ID) {
        out.success(`Entra tenant configured: ${chalk.dim(env.ENTRA_TENANT_ID)}`);
      } else {
        out.warn('ENTRA_TENANT_ID not set. Server-side Entra auth may not work.');
      }
```

Note: The warning message is updated to be accurate — the CLI itself works regardless
(via first-party auth); the warning now pertains only to the vertical's server-side config.

**T3.4 — `src/lib/config.ts`: Mark `clientId` optional in interface and `resolveProjectConfig`** (lines 24, 232)

```typescript
// BEFORE (line 22-25 — EAIProjectConfig.entra object):
  entra: {
    tenantName: string;
    tenantId: string;
    clientId: string;
  };

// AFTER:
  entra: {
    tenantName: string;
    tenantId: string;
    clientId?: string;  // No longer required — CLI uses first-party App Registration
  };
```

```typescript
// BEFORE (line 232 — resolveProjectConfig return):
      clientId: env.ENTRA_CLIENT_ID || '',

// AFTER:
      clientId: env.ENTRA_CLIENT_ID || undefined,
```

#### Verification

- `grep -r ENTRA_CLIENT_ID src/` returns zero results
- `eai init` scaffold does not contain `ENTRA_CLIENT_ID` or `ENTRA_CLIENT_SECRET` in
  generated `.env.local`
- `eai verify` (doctor) on a project without `ENTRA_CLIENT_ID` passes env var checks
- `eai dev` on a project without `ENTRA_CLIENT_ID` does not warn about missing client ID
- `npx tsc --noEmit` passes (optional field is backward-compatible)

---

### Phase 4: Testing & Validation

**Goal**: Confirm all existing tests pass, verify the success criteria from the spec, and
validate the grep-clean state of the codebase.

#### Tasks

**T4.1 — Run full test suite**

```bash
npm test
```

Expected: all tests pass without modification. The only test-adjacent file noted in
research (`tests/helpers/setup-dsl.ts:50`, `clientId: 'test-client-id'`) is unaffected
by this change.

**T4.2 — TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Key checks:
- `DEFAULT_CLIENT_ID` constant used as `string` arg to `deviceCodeLogin()` ✓
- `clientId?: string` in interface does not break `resolveProjectConfig()` return ✓
- Removed `findProjectRoot`/`loadEnvFile` imports cause no dangling references ✓

**T4.3 — Grep validation (zero-tolerance)**

```bash
grep -r ENTRA_CLIENT_ID src/
```

Expected: no output (zero matches).

```bash
grep -r 'client-id' src/
```

Expected: no output.

**T4.4 — Build**

```bash
npm run build
```

Expected: clean build.

**T4.5 — Help output check**

```bash
node dist/index.js login --help
```

Expected output must:
- Contain `--tenant-name`, `--tenant-id`, `--scope` (preserved flags)
- NOT contain `--client-id`
- NOT contain `ENTRA_CLIENT_ID`

#### Verification

All 8 success criteria from spec.md §5 satisfied:

| Criterion | Check |
|-----------|-------|
| Steps to first login | 1 (`eai login`) — resolution block deleted |
| Config required before login | 0 vars, 0 flags — hardcoded constant |
| `ENTRA_CLIENT_ID` refs in `src/` | 0 — T4.3 grep check |
| `--client-id` in `eai login --help` | Not present — T4.5 |
| `ENTRA_CLIENT_ID` in `eai init` output | Not present — T3.1 |
| `eai verify` flagging absent `ENTRA_CLIENT_ID` | Does not flag — T3.2 |
| Device code URL/code displayed | Yes — T2.1 fix |
| Existing tests pass | All passing — T4.1 |

---

## File Change Map

| File | Lines Deleted | Lines Added | Net |
|------|--------------|-------------|-----|
| `src/commands/login.ts` | 17 (option line, resolution block, clientId display, unused import) | 1 (DEFAULT_CLIENT_ID constant) | −16 |
| `src/lib/auth.ts` | 1 (stub comment) | 1 (`console.log` call) | 0 |
| `src/lib/config.ts` | 0 | 1 (`?` on interface field; `undefined` fallback) | +1 |
| `src/commands/init.ts` | 2 (ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET template lines) | 0 | −2 |
| `src/commands/verify.ts` | 1 (array item) | 0 | −1 |
| `src/commands/dev.ts` | 5 (if/else block) | 4 (updated if/else block) | −1 |
| **Total** | **26** | **7** | **−19** |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Placeholder client ID ships to users before real GUID provided | Low | Medium — login fails with `400` (clear error, not silent) | Deploy blocked by EAI confirming GUID; single-line swap |
| Vertical app runtime reads `config.entra.clientId` and gets `undefined` | Low | Low — optional field, `undefined` === empty string in most checks | Marked optional not removed; backward-compatible |
| `ENTRA_CLIENT_SECRET` still needed by vertical server-side auth | Low | None for CLI — out of scope per spec §8 | Scoped removal (init template only); vertical can add back if needed |
| Existing stored tokens (with `clientId` from old flow) break refresh | None | None | `StoredTokens.clientId` field and `refreshAccessToken()` untouched |

---

## Spec Traceability

### User Stories

| User Story | Phase(s) | Tasks |
|-----------|----------|-------|
| US-01: Zero-config login | 1, 2 | T1.1–T1.6, T2.1 |
| US-02: Login requires no flags | 1 | T1.2, T1.3 |
| US-03: New project scaffold has no Entra client config | 3 | T3.1 |
| US-04: Platform verification ignores client ID | 3 | T3.2 |
| US-05: Local dev server starts without Entra client config | 3 | T3.3 |
| US-06: Power-user tenant overrides still work | 1 | T1.5 (flags preserved) |

**US Coverage: 6/6**

### Functional Requirements

| Requirement | Phase | Task(s) |
|------------|-------|---------|
| FR-01: CLI ships with hardcoded first-party Client ID | 1 | T1.1 |
| FR-02: `--client-id` flag removed | 1 | T1.2 |
| FR-03: Runtime clientId resolution block removed | 1 | T1.3 |
| FR-04: Device code URL and user code displayed | 2 | T2.1 |
| FR-05: `eai init` scaffold removes Entra client vars | 3 | T3.1 |
| FR-06: `eai verify` does not require `ENTRA_CLIENT_ID` | 3 | T3.2 |
| FR-07: `eai dev` pre-flight does not check `ENTRA_CLIENT_ID` | 3 | T3.3 |
| FR-08: Project config interface updated | 3 | T3.4 |

**FR Coverage: 8/8**

### FR-08 Clarification Resolved

The spec flagged `[NEEDS CLARIFICATION]` on whether `EAIProjectConfig.entra.clientId`
is consumed by vertical app runtime code. **Resolution**: Mark optional. This is the
safest change — it removes the CLI's requirement for the field without breaking any
downstream consumer that may still reference it. No code search revealed any CLI
consumption of this field beyond `resolveProjectConfig()` itself, and that function
is not called anywhere in the CLI's own auth path (only in commands that read project
config for API operations).
