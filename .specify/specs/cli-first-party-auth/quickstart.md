# Quickstart Testing Guide — CLI First-Party Auth

This guide covers how to build and manually test the `cli-first-party-auth` feature against all acceptance criteria (US-01 through US-06).

---

## Prerequisites

### Required Tools

- **Node.js** v18 or later (`node --version`)
- **npm** v9 or later (`npm --version`)

### Repository Setup

```bash
git clone <repo-url>
cd eai-cli
npm install
```

### Replacing the Client ID Placeholder

The implementation uses `EAI_CLI_CLIENT_ID_PLACEHOLDER` as the value of `DEFAULT_CLIENT_ID` in `src/commands/login.ts` until EAI provides the real App Registration GUID.

- **For unit/integration tests**: the placeholder is fine — tests mock the auth library.
- **For live end-to-end tests against Entra CIAM**: replace the placeholder with the real GUID before building.

```bash
# Find and replace the placeholder (macOS/Linux)
sed -i '' 's/EAI_CLI_CLIENT_ID_PLACEHOLDER/<real-guid-here>/g' src/commands/login.ts
```

Confirm the change:

```bash
grep DEFAULT_CLIENT_ID src/commands/login.ts
# Expected: const DEFAULT_CLIENT_ID = '<real-guid-here>';
```

> ⚠️ Do not commit the real GUID until EAI has officially provisioned the App Registration.

---

## Build

```bash
npm run build
```

Verify the build succeeds with no TypeScript errors. The compiled output lands in `dist/`.

Run the test suite to confirm no regressions:

```bash
npm test
```

---

## Key Files Changed

| File | Change |
|------|--------|
| `src/commands/login.ts` | Added `DEFAULT_CLIENT_ID` constant; removed `--client-id` flag; deleted 15-line clientId resolution block |
| `src/lib/auth.ts` | Bug fix — added `console.log(`\n${deviceCode.message}\n`)` after device code response |
| `src/commands/init.ts` | Removed `ENTRA_CLIENT_ID=...` and `ENTRA_CLIENT_SECRET=...` lines from `.env.local` template |
| `src/commands/verify.ts` | Removed `ENTRA_CLIENT_ID` from the `required[]` env var array |
| `src/commands/dev.ts` | Updated pre-flight check that previously blocked on absent `ENTRA_CLIENT_ID` |
| `src/lib/config.ts` | Removed or marked optional `EAIProjectConfig.entra.clientId` |

---

## Manual Test Scenarios

### US-01 — Zero-Config Login

**Goal**: `eai login` works on a machine with no Entra configuration.

```bash
# Ensure no ENTRA_CLIENT_ID is set
unset ENTRA_CLIENT_ID

# Run from a directory with no .env.local
cd /tmp/test-fresh
node /path/to/eai-cli/dist/index.js login
```

**Expected**:
- No error about missing client ID
- A device code message is printed (see US-01 / FR-04 check below)
- After completing browser authentication, a success message is displayed
- A valid access token is stored (`~/.eai/tokens` file exists and is non-empty)

---

### US-02 — Login Requires No Flags

**Goal**: `--client-id` no longer exists; `--help` is clean.

```bash
node /path/to/eai-cli/dist/index.js login --help
```

**Expected**:
- Output does NOT contain `--client-id`
- Output does NOT contain `ENTRA_CLIENT_ID`
- Output does NOT mention "App Registration"
- `--tenant-name`, `--tenant-id`, and `--scope` ARE present (NFR-06)

```bash
# Confirm --client-id is rejected as unknown
node /path/to/eai-cli/dist/index.js login --client-id abc123
```

**Expected**: Commander.js "unknown option '--client-id'" error, non-zero exit.

---

### US-03 — New Project Scaffold Has No Entra Client Config

**Goal**: `eai init` does not write `ENTRA_CLIENT_ID` or `ENTRA_CLIENT_SECRET` to `.env.local`.

```bash
mkdir /tmp/test-init && cd /tmp/test-init
node /path/to/eai-cli/dist/index.js init
```

Follow any prompts to completion, then inspect the generated file:

```bash
cat .env.local
```

**Expected**:
- `ENTRA_TENANT_NAME` is present
- `ENTRA_TENANT_ID` is present
- `ENTRA_SCOPES` is present
- `ENTRA_CLIENT_ID` is **absent**
- `ENTRA_CLIENT_SECRET` is **absent**

Quick grep check:

```bash
grep -E "ENTRA_CLIENT_ID|ENTRA_CLIENT_SECRET" .env.local
# Expected: no output (exit code 1)
```

---

### US-04 — Platform Verification Ignores Client ID

**Goal**: `eai verify` passes without `ENTRA_CLIENT_ID`.

```bash
cd /tmp/test-init  # directory from US-03 (no ENTRA_CLIENT_ID in .env.local)
node /path/to/eai-cli/dist/index.js verify
```

**Expected**:
- No error or warning about `ENTRA_CLIENT_ID` being missing
- Verification completes normally

Also confirm the source: `ENTRA_CLIENT_ID` must not appear in the `required[]` array in `src/commands/verify.ts`:

```bash
grep -n "ENTRA_CLIENT_ID" src/commands/verify.ts
# Expected: no output
```

---

### US-05 — Local Dev Server Starts Without Entra Client Config

**Goal**: `eai dev` pre-flight does not block on absent `ENTRA_CLIENT_ID`.

```bash
cd /tmp/test-init
node /path/to/eai-cli/dist/index.js dev
```

**Expected**:
- No pre-flight error about `ENTRA_CLIENT_ID`
- Server startup proceeds (may fail for other unrelated reasons such as missing `BASE_URL_PUBLIC_API`, which is out of scope)

Confirm the source change:

```bash
grep -n "ENTRA_CLIENT_ID" src/commands/dev.ts
# Expected: no output
```

---

### US-06 — Power-User Tenant Overrides Still Work

**Goal**: `--tenant-name`, `--tenant-id`, and `--scope` flags still function.

```bash
node /path/to/eai-cli/dist/index.js login --help
```

**Expected**: All three flags are listed in the help output.

Live override test (requires real GUID and a valid non-prod tenant):

```bash
node /path/to/eai-cli/dist/index.js login \
  --tenant-name myothertenant \
  --tenant-id <other-tenant-id> \
  --scope "openid profile email"
```

**Expected**: Device code flow initiates against the overridden tenant.

---

## Device Code Message Display Fix (FR-04 / Bug Fix)

This is a targeted bug fix that runs as part of US-01. When `eai login` is executed:

1. The CLI posts to `/oauth2/v2.0/devicecode`
2. The response includes a `message` field like:
   > `To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate.`
3. **Before this fix**: the message was never printed — the CLI silently polled.
4. **After this fix**: the message is printed with surrounding newlines before polling begins.

**How to verify**:

```bash
node /path/to/eai-cli/dist/index.js login
```

**Expected terminal output (example)**:

```
Authenticating with Entra CIAM

To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate.

```

The URL and code must be visible. If only `Authenticating with Entra CIAM` appears and then the CLI hangs silently, the bug fix was not applied.

---

## Source-Level Checks

Run these greps on the final implementation to confirm the spec's success criteria:

```bash
# No ENTRA_CLIENT_ID references remaining in src/
grep -r "ENTRA_CLIENT_ID" src/
# Expected: no output

# DEFAULT_CLIENT_ID constant exists in login.ts
grep "DEFAULT_CLIENT_ID" src/commands/login.ts
# Expected: one line defining the constant

# --client-id option not present in login.ts
grep "client-id" src/commands/login.ts
# Expected: no output

# clientId field retained in StoredTokens (auth.ts)
grep "clientId" src/lib/auth.ts
# Expected: multiple lines (field declaration, refresh usage, storeTokens call)

# Device code message display is present
grep "deviceCode.message" src/lib/auth.ts
# Expected: one line with the console.log call
```

---

## Common Issues

### "No client ID provided" error still appears
The old resolution block was not fully removed, or you are running an old build. Rebuild with `npm run build` and confirm the `dist/` output is up to date.

### Login hangs silently with no URL shown
The device code message display fix (`console.log(`\n${deviceCode.message}\n`)`) was not applied to `src/lib/auth.ts`. Check line ~162–163 in that file.

### `eai login --client-id abc` does not error
The `--client-id` Commander option was not removed from `src/commands/login.ts`. Commander only rejects unknown options when `.allowUnknownOption()` is not set — confirm the option definition line was deleted.

### `eai verify` still flags `ENTRA_CLIENT_ID`
The `ENTRA_CLIENT_ID` entry was not removed from the `required[]` array in `src/commands/verify.ts:170`. Inspect that file directly.

### Placeholder GUID causes Entra errors
`EAI_CLI_CLIENT_ID_PLACEHOLDER` is not a valid GUID. Replace it with the real App Registration GUID from the EAI Platform Team before live testing (see [Prerequisites](#prerequisites) above).
