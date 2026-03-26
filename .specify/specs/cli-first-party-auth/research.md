---
date: '2026-03-26T06:58:40.000Z'
researcher: Claude
feature: 'cli-first-party-auth'
status: complete
---

# Research: CLI First-Party Auth

## Feature Summary

Change `eai login` so it works like `az login` — the CLI ships with its own
hardcoded App Registration (a public client in EAI's Entra CIAM tenant). Users
install the CLI and run `eai login` immediately with no configuration required.
The per-project `ENTRA_CLIENT_ID` concept is removed entirely.

---

## Codebase Analysis

### Where to Implement

| Component | Location | Purpose |
|-----------|----------|---------|
| Login command | `src/commands/login.ts` | Remove `--client-id` option, remove runtime clientId resolution, use hardcoded constant |
| Auth constants | `src/commands/login.ts:12-14` | Add `DEFAULT_CLIENT_ID` constant alongside existing tenant constants |
| Auth lib | `src/lib/auth.ts` | `deviceCodeLogin()` signature stays the same — just receives hardcoded value |
| Init template | `src/commands/init.ts:265-268` | Remove `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET` lines from `.env.local` scaffold |
| Stored tokens | `src/lib/auth.ts:StoredTokens` | `clientId` field stays — used for token refresh |

### Current Client ID Resolution (login.ts:23-37)

```typescript
// CURRENT — three-step resolution ending in process.exit(1)
let clientId = options.clientId;                          // --client-id flag

if (!clientId) {
  const root = await findProjectRoot();
  if (root) {
    const env = await loadEnvFile(root);
    clientId = env.ENTRA_CLIENT_ID || process.env.ENTRA_CLIENT_ID;  // .env.local / env var
  }
}

if (!clientId) {
  out.error('No client ID provided. Use --client-id or set ENTRA_CLIENT_ID in .env.local');
  process.exit(1);                                        // ← user sees error on first run
}
```

### Target State (after this feature)

```typescript
// TARGET — single hardcoded constant, no resolution needed
const DEFAULT_CLIENT_ID = 'PLACEHOLDER_EAI_CLI_CLIENT_ID';  // EAI to provide real value

// login action simply uses it directly
await deviceCodeLogin(
  options.tenantName,
  options.tenantId,
  DEFAULT_CLIENT_ID,
  options.scope,
);
```

### Hardcoded Constants Pattern (already used in login.ts)

The file already follows this pattern for tenant config:

```typescript
// src/commands/login.ts:12-14
const DEFAULT_TENANT_NAME = 'eaidevmyentepriseai';
const DEFAULT_TENANT_ID   = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const DEFAULT_SCOPE       = 'openid profile email offline_access api://32191e63-e253-48de-9ea1-a5337e236fe6/access_as_user';
```

`DEFAULT_CLIENT_ID` follows the exact same pattern. No new pattern introduced.

### Init .env.local Template (init.ts:265-268)

```
ENTRA_TENANT_NAME=eaidevmyentepriseai
ENTRA_TENANT_ID=50808ce0-f31b-4fd0-9861-74b83b8c112a
ENTRA_CLIENT_ID=<your-app-client-id>         ← REMOVE
ENTRA_CLIENT_SECRET=<your-app-client-secret> ← REMOVE
ENTRA_SCOPES="email offline_access openid profile"
```

These two lines are removed. The verticals's own Entra config (for server-side
auth of the app itself) may still be needed, but `ENTRA_CLIENT_ID` for the CLI
login is no longer required.

### Integration Points

1. **`src/lib/auth.ts:deviceCodeLogin()`** — signature unchanged, just receives hardcoded value
2. **`src/lib/auth.ts:StoredTokens`** — `clientId` field retained (needed for token refresh in `refreshAccessToken()`)
3. **`src/commands/init.ts:267-268`** — `.env.local` template: remove `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET` lines
4. **`src/commands/verify.ts:170`** — `ENTRA_CLIENT_ID` is in the `required[]` bulk-validation array; must be removed
5. **`src/commands/dev.ts:64-68`** — pre-flight check reads `env.ENTRA_CLIENT_ID && env.ENTRA_TENANT_ID`; must be updated
6. **`src/lib/config.ts:24`** — `EAIProjectConfig.entra.clientId` typed interface field; remove or mark optional
7. **`tests/helpers/setup-dsl.ts:50`** — `clientId: 'test-client-id'` in fake token; no change needed

### 🐛 Bug Discovered: Device Code Message Never Shown

`auth.ts:162-163` has only a comment `// Display message to user` — **the actual display call is missing**.
Users currently see `Authenticating with Entra CIAM` and then the CLI silently polls with no URL or user code shown. This must be fixed as part of this feature (it's in the code path we're changing).

```typescript
// auth.ts — CURRENT (broken)
const deviceCode: DeviceCodeResponse = await deviceCodeRes.json();
// Display message to user   ← comment only, nothing rendered

// auth.ts — FIXED
const deviceCode: DeviceCodeResponse = await deviceCodeRes.json();
console.log(`\n${deviceCode.message}\n`);  // shows: "To sign in, use a web browser to open..."
```

---

## Technology Decisions

### Decision 1: Public Client App Registration

- **Choice**: Register the EAI CLI as a **Public Client** in the existing `eaidevmyentepriseai` CIAM tenant
- **Rationale**: CLI tools run on user devices and cannot keep secrets. Public clients use only a client_id (no secret). This is the Microsoft-recommended pattern for device code flow.
- **Alternatives**: Confidential client (rejected — requires a secret, impossible to ship securely in a CLI binary)

### Decision 2: Hardcoded vs Runtime-Configured

- **Choice**: Hardcoded constant `DEFAULT_CLIENT_ID` in `login.ts`
- **Rationale**: Same approach used for `DEFAULT_TENANT_NAME` and `DEFAULT_TENANT_ID`. No config needed. `az cli` uses the same approach with client ID `04b07795-8542-4aa3-0786-83349992f3b4`.
- **Alternatives**: Environment variable override kept (rejected by user — "hardcoded only")

### Decision 3: Remove ENTRA_CLIENT_ID From init Template

- **Choice**: Delete `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET` from the `.env.local` scaffold
- **Rationale**: These vars no longer serve any purpose for CLI auth. Keeping them causes confusion.
- **Note**: If the vertical app itself needs Entra config for server-side flows, that's a separate concern documented elsewhere.

---

## Brownfield Analysis

### What Must NOT Change

| Protected Boundary | Why |
|-------------------|-----|
| `deviceCodeLogin()` signature in `auth.ts` | Called from login command; no change needed |
| `StoredTokens.clientId` field | Used in `refreshAccessToken()` — must remain |
| `--tenant-name`, `--tenant-id`, `--scope` flags | Power-user overrides for non-prod environments; keep |
| Token storage/encryption in `auth.ts` | Unrelated to this change |

### Downstream Dependencies

- `src/lib/auth.ts:refreshAccessToken()` — reads `tokens.clientId` from stored tokens. Since we now always store the hardcoded CLI client ID, this works correctly.
- `src/commands/whoami.ts` — may display clientId; no change needed.

---

## Constraints & Considerations

- **EAI must register the CLI App Registration** before the constant can be filled in. The implementation can use a `PLACEHOLDER` value and note this dependency.
- **`ENTRA_CLIENT_SECRET` removal from init** — verticals may need their own Entra config for server-side flows. The placeholder removal should be scoped to CLI login only. Investigate whether any vertical code reads `ENTRA_CLIENT_SECRET` at runtime.
- **Existing users** who have `.env.local` with `ENTRA_CLIENT_ID` — no migration needed. The variable is simply ignored going forward.
- **Public client security** — hardcoding a public client_id is safe and standard practice. There is no secret to protect.

---

## Open Questions

- [ ] **What is the actual Client ID for the EAI CLI App Registration?** — EAI team must provide this. Use `EAI_CLI_CLIENT_ID_PLACEHOLDER` until confirmed.
- [ ] **Is `ENTRA_CLIENT_SECRET` used anywhere in vertical app runtime code** (not just CLI login)? If so, keep it in the init template but remove `ENTRA_CLIENT_ID`. Locate grep: `ENTRA_CLIENT_SECRET` in vertical template repo.
- [ ] **`EAIProjectConfig.entra.clientId` in config.ts:24** — is this field consumed by any vertical app runtime, or only by the CLI login flow?

---

## Recommendations

1. Add `DEFAULT_CLIENT_ID` constant to `src/commands/login.ts` alongside the existing defaults
2. Remove the 15-line clientId resolution block from the login action
3. Remove `--client-id` Commander option from the login command
4. Remove `ENTRA_CLIENT_ID=...` and `ENTRA_CLIENT_SECRET=...` lines from the init `.env.local` template
5. Update `src/lib/config.ts` if it exports or documents `ENTRA_CLIENT_ID` as a known config key
6. Use a clearly-named placeholder (`EAI_CLI_CLIENT_ID_PLACEHOLDER`) so the value is easy to find and replace when the App Registration is created
