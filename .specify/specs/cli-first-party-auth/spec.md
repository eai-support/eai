---
id: cli-first-party-auth
title: 'CLI First-Party Authentication'
status: ready-for-plan
created: '2026-03-26T00:00:00.000Z'
updated: '2026-03-26T00:00:00.000Z'
author: Claude
---

# Specification: CLI First-Party Authentication

## 1. Overview

The `eai` CLI currently requires every user to obtain and configure their own
Entra App Registration before `eai login` will succeed. A brand-new user who
installs `@eai-tools/cli` and immediately runs `eai login` is met with an error:

> _"No client ID provided. Use --client-id or set ENTRA_CLIENT_ID in .env.local"_

This is a significant onboarding barrier that breaks the "install and go"
experience the CLI is supposed to provide.

This feature removes that barrier entirely. The CLI ships with its own
hardcoded App Registration — a **public client** registered by EAI in its Entra
CIAM tenant. Users install the CLI, run `eai login`, and authenticate
immediately with no configuration required. This is the same approach used by
`az login` (Azure CLI) and `gh auth login` (GitHub CLI): first-party CLIs own
their App Registration; users supply only their identity credentials.

The `ENTRA_CLIENT_ID` environment variable, `--client-id` CLI flag, and all
related scaffolding are removed from the codebase. This simplifies the
onboarding surface and eliminates an entire class of configuration errors.

---

## 2. User Stories

### P1 — Must Have

**US-01: Zero-config login**
As an eai CLI user,
I want to run `eai login` immediately after installation,
So that I can authenticate without any prior configuration steps.

Acceptance criteria:
- [ ] `eai login` succeeds on a machine with no `.env.local` file and no `ENTRA_CLIENT_ID` environment variable set
- [ ] The user is directed to a browser-accessible URL with a user code displayed in the terminal
- [ ] The verification URL and user code are visibly printed so the user knows where to go and what to enter
- [ ] Authentication completes and a success message is displayed
- [ ] A valid access token is stored for subsequent commands

**US-02: Login requires no flags**
As an eai CLI user,
I want `eai login` to work without any flags,
So that I do not need to know what a Client ID is.

Acceptance criteria:
- [ ] Running `eai login` with no arguments succeeds
- [ ] The `--client-id` flag no longer exists on the `login` command
- [ ] `eai login --help` does not mention `--client-id` or `ENTRA_CLIENT_ID`

**US-03: New project scaffold has no Entra client config**
As an eai CLI user initialising a new project with `eai init`,
I want the generated `.env.local` file to omit `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`,
So that I am not misled into thinking I need to configure my own App Registration.

Acceptance criteria:
- [ ] The `.env.local` file created by `eai init` does not contain `ENTRA_CLIENT_ID`
- [ ] The `.env.local` file created by `eai init` does not contain `ENTRA_CLIENT_SECRET`
- [ ] All other scaffolded environment variables remain unchanged

---

### P2 — Should Have

**US-04: Platform verification ignores client ID**
As an eai CLI user running `eai verify` (or `eai doctor`),
I want the verification check to pass without `ENTRA_CLIENT_ID` being present,
So that the tool does not report a false configuration error.

Acceptance criteria:
- [ ] `eai verify` does not list `ENTRA_CLIENT_ID` as a required environment variable
- [ ] A project without `ENTRA_CLIENT_ID` in `.env.local` passes verification without warnings or errors related to Entra client configuration

**US-05: Local dev server starts without Entra client config**
As an eai CLI user running `eai dev`,
I want the local development server pre-flight check to succeed without `ENTRA_CLIENT_ID`,
So that I can start developing immediately after `eai login`.

Acceptance criteria:
- [ ] `eai dev` does not halt or warn when `ENTRA_CLIENT_ID` is absent from the environment
- [ ] The pre-flight check that previously validated `ENTRA_CLIENT_ID` is updated or removed

---

### P3 — Nice to Have

**US-06: Power-user tenant overrides still work**
As an eai CLI power user or platform engineer,
I want to override the tenant name, tenant ID, and scopes via flags,
So that I can authenticate against non-production environments.

Acceptance criteria:
- [ ] `--tenant-name`, `--tenant-id`, and `--scope` flags remain available on `eai login`
- [ ] These flags continue to behave as they do today when provided
- [ ] No new override flags for client ID are introduced

---

## 3. Functional Requirements

### FR-01: CLI ships with a hardcoded first-party Client ID
The CLI must embed a single, EAI-owned Client ID constant used for all device
code login flows. This value must require no user action to activate.

- Must follow the same constant declaration pattern already used for
  `DEFAULT_TENANT_NAME`, `DEFAULT_TENANT_ID`, and `DEFAULT_SCOPE`
- During development the placeholder string `EAI_CLI_CLIENT_ID_PLACEHOLDER` is
  used. It must be clearly identifiable for easy substitution.
- Before any release to end users, the placeholder must be replaced with the
  real GUID of a Public Client App Registration in EAI's `eaidevmyentepriseai`
  Entra CIAM tenant. A CI lint check (e.g., `grep EAI_CLI_CLIENT_ID_PLACEHOLDER src/`)
  must fail the build if the placeholder is still present.

### FR-02: `--client-id` flag is removed from `eai login`
The `login` command must not accept or document a `--client-id` option.

- Passing `--client-id` to `eai login` must result in an "unknown option" error
  (standard Commander.js behaviour for unrecognised flags)
- No runtime fallback to `ENTRA_CLIENT_ID` environment variable or `.env.local` file

### FR-03: Runtime clientId resolution block is removed
The 15-line block in `login.ts` that reads `--client-id` → `.env.local` →
`ENTRA_CLIENT_ID` → `process.exit(1)` must be deleted entirely.

- The login action must use the hardcoded constant directly, with no conditional
  resolution logic
- The `out.info(`Client: ...`)` line that previously printed the resolved clientId
  must be removed; the hardcoded value is an implementation detail, not user-facing information

### FR-04: Device code verification URL and user code are displayed
When the device code flow is initiated, the terminal must print the message
returned by the Entra CIAM device code endpoint so the user knows which URL to
visit and which code to enter.

- The message must be printed before polling begins, with a blank line before
  and after it (i.e., not "e.g. newlines" — blank lines are required)
- If the `message` field on the device code response is absent or empty, the
  implementation must fall back to printing the `verification_uri` and
  `user_code` fields individually in a human-readable format
- This corrects an existing bug where the display call was omitted

### FR-05: `eai init` scaffold removes Entra client environment variables
The `.env.local` template generated by `eai init` must not include
`ENTRA_CLIENT_ID` or `ENTRA_CLIENT_SECRET`.

- `ENTRA_TENANT_NAME`, `ENTRA_TENANT_ID`, and `ENTRA_SCOPES` lines remain in
  the template unchanged

### FR-06: `eai verify` does not require `ENTRA_CLIENT_ID`
The platform verification command must not list `ENTRA_CLIENT_ID` in its set of
required environment variables.

- All other required variable checks remain unchanged

### FR-07: `eai dev` pre-flight Entra check is removed
The pre-flight check block in `dev.ts` that reads `env.ENTRA_CLIENT_ID &&
env.ENTRA_TENANT_ID` must be removed entirely. No warning about Entra auth
configuration is shown; the CLI no longer requires this from the project.

- The entire `if (env.ENTRA_CLIENT_ID && env.ENTRA_TENANT_ID) { ... } else { warn(...) }`
  block at `dev.ts:64-68` is deleted
- `eai dev` emits no warning and does not halt when `ENTRA_CLIENT_ID` is absent

### FR-08: Project config interface and resolver are updated
`EAIProjectConfig.entra.clientId` in `config.ts` is marked optional (`clientId?: string`).
The `resolveProjectConfig()` function body at `config.ts:232` that reads
`env.ENTRA_CLIENT_ID` is also removed or updated.

- Marking optional (rather than removing) is the safe default: it prevents
  breakage in any external consumers while reflecting that the CLI no longer
  requires the value
- After this change, `grep -r ENTRA_CLIENT_ID src/` must return no results

---

## 4. Non-Functional Requirements

### NFR-01: Security — Public Client safety
The hardcoded Client ID is not a secret. Public clients authenticate via the
resource owner's identity (device code flow), not via a client credential. The
Client ID may be visible in source code, compiled binaries, and network traffic.
This is safe and is the standard pattern for CLI authentication tools.

- No `client_secret` must ever be embedded in the CLI binary or source code

### NFR-02: Backward compatibility — existing `.env.local` files
Users who have an existing `.env.local` containing `ENTRA_CLIENT_ID` must
experience no breakage. The variable is silently ignored after this change.

- No migration script or warning is required

### NFR-03: Backward compatibility — token storage
The `clientId` field in `StoredTokens` (used by `refreshAccessToken()`) must be
retained. Existing stored tokens will continue to be read correctly.

### NFR-04: Discoverability — `--help` output
`eai login --help` must not mention `ENTRA_CLIENT_ID`, `--client-id`, or any
reference to App Registration configuration.

### NFR-05: User experience — terminal feedback during authentication
Between initiating the device code request and completing authentication, the
user must see actionable output: specifically the URL to visit and the code to
enter. Silent polling is not acceptable.

### NFR-06: Compatibility — existing flags preserved
The `--tenant-name`, `--tenant-id`, and `--scope` flags on `eai login` must
continue to work without modification.

---

## 5. Success Criteria

| Criterion | Target | How to Measure |
|-----------|--------|----------------|
| Steps required to achieve first successful login on a fresh install | 1 (`eai login`) | Manual test on clean machine |
| Configuration required before login | 0 environment variables, 0 flags | Code review + manual test |
| `ENTRA_CLIENT_ID` references remaining in CLI source | 0 | `grep -r ENTRA_CLIENT_ID src/` returns no results |
| `--client-id` flag present in `eai login --help` | Not present | Command output inspection |
| `ENTRA_CLIENT_ID` in `eai init`-generated `.env.local` | Not present | Run `eai init`, inspect file |
| `eai verify` flagging absent `ENTRA_CLIENT_ID` as an error | Does not flag | Run `eai verify` on project without `ENTRA_CLIENT_ID` |
| Device code URL and user code displayed in terminal | Yes | Manual login test |
| Existing tests pass without modification | All passing | `npm test` green |

---

## 6. Assumptions

1. **EAI will create a dedicated Public Client App Registration** for the CLI in
   the `eaidevmyentepriseai` CIAM tenant before the feature is shipped to users.
   The implementation will use a named placeholder until the GUID is provided.

2. **The hardcoded tenant values remain correct.** `DEFAULT_TENANT_NAME`,
   `DEFAULT_TENANT_ID`, and `DEFAULT_SCOPE` in `login.ts` are assumed to be
   stable and do not need to change as part of this feature.

3. **`ENTRA_CLIENT_SECRET` in `.env.local` is CLI-login-specific.** Removing it
   from the init template is safe. If any vertical app scaffold needs it for
   server-side auth flows, that is a separate concern outside this feature's scope.

4. **Existing stored tokens remain valid.** No token migration or invalidation is
   required because the stored `clientId` field is used for refresh, not for
   initial authentication.

5. **The `deviceCodeLogin()` function signature in `auth.ts` is correct.**
   It accepts a `clientId` parameter, which will now always receive the hardcoded
   constant. No signature change is required.

6. **`EAIProjectConfig.entra.clientId` in `config.ts` is used only by the CLI
   login flow**, not by vertical app runtime code. If this assumption is false,
   the field must be marked optional rather than removed.
   _[NEEDS CLARIFICATION — see FR-08]_

7. **The device code message returned by the Entra CIAM endpoint** contains a
   human-readable string in a `message` field on the JSON response. The fix
   outputs this field verbatim.

---

## 7. Dependencies

### Internal Code Dependencies

| Component | File | Nature of Change |
|-----------|------|-----------------|
| Login command — constants | `src/commands/login.ts:12-14` | Add `DEFAULT_CLIENT_ID` constant |
| Login command — option | `src/commands/login.ts` | Remove `--client-id` Commander option |
| Login command — resolution block | `src/commands/login.ts:23-37` | Delete 15-line clientId resolution block |
| Auth library — device code display | `src/lib/auth.ts:162-163` | Fix missing display call (bug fix) |
| Auth library — `deviceCodeLogin()` | `src/lib/auth.ts` | No signature change; receives hardcoded value |
| Auth library — `StoredTokens.clientId` | `src/lib/auth.ts` | No change; retained for token refresh |
| Init template | `src/commands/init.ts:265-268` | Remove `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET` lines |
| Verify command | `src/commands/verify.ts:170` | Remove `ENTRA_CLIENT_ID` from `required[]` array |
| Dev command | `src/commands/dev.ts:64-68` | Update pre-flight check that reads `env.ENTRA_CLIENT_ID` |
| Project config interface | `src/lib/config.ts:24` | Mark `entra.clientId` as optional (`clientId?: string`) |
| Project config resolver | `src/lib/config.ts:232` | Remove `env.ENTRA_CLIENT_ID` read from `resolveProjectConfig()` |
| Test helpers | `tests/helpers/setup-dsl.ts:50` | No change required; `clientId: 'test-client-id'` in fake token is unaffected |

### External Dependencies

| Dependency | Owner | Blocking? |
|------------|-------|-----------|
| EAI CLI App Registration (GUID) | EAI Platform Team | Yes — required before shipping to users; placeholder used during development |
| Entra CIAM tenant (`eaidevmyentepriseai`) | EAI Platform Team | Existing; no change required |

---

## 8. Out of Scope

- **Vertical app Entra configuration**: Server-side auth flows in deployed EAI
  verticals may require their own App Registration. This feature only removes
  the CLI's login-time dependency on `ENTRA_CLIENT_ID`; vertical app auth is
  a separate concern.

- **`ENTRA_CLIENT_SECRET` in vertical app runtime**: If any vertical uses
  `ENTRA_CLIENT_SECRET` for server-side auth (e.g., client credentials flow),
  that configuration is out of scope. This feature only removes it from the CLI
  `eai init` scaffold.

- **Override mechanism for `--client-id`**: No `--client-id` flag, no
  `ENTRA_CLIENT_ID` environment variable override. The decision is hardcoded
  only. No escape hatch is provided or planned.

- **Multi-tenant support**: Supporting multiple CIAM tenants via configuration
  is out of scope. The existing `--tenant-name` / `--tenant-id` power-user
  flags are preserved but not extended.

- **Token storage format changes**: Changes to how tokens are stored, encrypted,
  or rotated are out of scope.

- **`whoami` command display**: The `whoami` command may surface `clientId` from
  stored tokens. No change to its output is required.

- **`logout` command**: No changes to the logout flow are required.

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **Public Client** | An OAuth 2.0 client application that cannot keep a secret — e.g., a CLI tool or mobile app running on a user's device. Authenticates using only a `client_id`; no `client_secret` is used or required. |
| **Device Code Flow** | An OAuth 2.0 authorisation flow for devices that cannot open a browser directly. The CLI receives a short code and a URL; the user opens the URL in any browser, enters the code, and the CLI polls until authentication completes. |
| **App Registration** | A configuration entry in Microsoft Entra (Azure AD) that defines an application's identity, redirect URIs, permitted scopes, and client type. The EAI CLI requires its own dedicated registration. |
| **CIAM** | Customer Identity and Access Management. EAI uses Microsoft Entra External ID (CIAM) in the `eaidevmyentepriseai` tenant to manage user identities for the EAI platform. |
| **Hardcoded Client ID** | A `client_id` value embedded as a constant in the CLI source code and binary, shared by all users of the CLI. This is safe for public clients because the value is not a secret. |
| **First-Party Auth** | Authentication where the CLI authenticates on behalf of itself as the registered application (owned by EAI), rather than requiring each user or project to supply their own App Registration. |

---

## 10. Research Traceability

The following matrix confirms that all findings from `research.md` are
addressed by a section of this specification.

| Research Finding | Spec Section(s) |
|------------------|----------------|
| `login.ts:12-14` — hardcoded constants pattern exists | FR-01, Dependencies |
| `login.ts:23-37` — 15-line clientId resolution block | FR-02, FR-03, US-01, US-02 |
| `auth.ts:deviceCodeLogin()` — signature unchanged | FR-01, Dependencies, Assumptions |
| `auth.ts:StoredTokens.clientId` — must be retained | NFR-03, Dependencies, Assumptions |
| `init.ts:265-268` — `.env.local` template lines to remove | FR-05, US-03, Dependencies |
| `verify.ts:170` — `ENTRA_CLIENT_ID` in `required[]` | FR-06, US-04, Dependencies |
| `dev.ts:64-68` — pre-flight reads `env.ENTRA_CLIENT_ID` | FR-07, US-05, Dependencies |
| `config.ts:24` — `EAIProjectConfig.entra.clientId` | FR-08, Dependencies, Assumptions |
| `tests/helpers/setup-dsl.ts:50` — fake token `clientId` | Dependencies (no change) |
| Bug: `auth.ts:162-163` — device code message never shown | FR-04, US-01, NFR-05 |
| Decision: Public Client, no secret | NFR-01, FR-01, Glossary |
| Decision: Hardcoded only, no override | FR-02, FR-03, Out of Scope |
| Decision: Remove `ENTRA_CLIENT_ID` from init | FR-05, US-03, Out of Scope |
| Constraint: EAI must register the App Registration | FR-01, Assumptions, Dependencies |
| Constraint: `ENTRA_CLIENT_SECRET` vertical scope | Assumptions, Out of Scope |
| Constraint: Existing `.env.local` users | NFR-02, Assumptions |
| Open Q: Real Client ID GUID | FR-01, Assumptions, Dependencies |
| Open Q: `ENTRA_CLIENT_SECRET` vertical runtime usage | Assumptions (6), Out of Scope |
| Open Q: `EAIProjectConfig.entra.clientId` consumers | FR-08, Assumptions (6) |

### Integration Points Coverage

| Integration Point | Addressed |
|-------------------|-----------|
| `src/lib/auth.ts:deviceCodeLogin()` | ✅ FR-01, FR-04 |
| `src/lib/auth.ts:StoredTokens` | ✅ NFR-03, Dependencies |
| `src/commands/init.ts:267-268` | ✅ FR-05, US-03 |
| `src/commands/verify.ts:170` | ✅ FR-06, US-04 |
| `src/commands/dev.ts:64-68` | ✅ FR-07, US-05 |
| `src/lib/config.ts:24` | ✅ FR-08 |
| `tests/helpers/setup-dsl.ts:50` | ✅ Dependencies (no change confirmed) |

### Constraints Coverage

| Constraint | Addressed |
|------------|-----------|
| Public client — no secret in binary | ✅ NFR-01, FR-01 |
| Hardcoded only — no override | ✅ FR-02, FR-03, Out of Scope |
| EAI must register App Registration | ✅ FR-01, Assumptions, Dependencies |
| Backward compat — existing `.env.local` | ✅ NFR-02 |
| Backward compat — token storage | ✅ NFR-03 |
| `ENTRA_CLIENT_SECRET` vertical scope | ✅ Assumptions, Out of Scope |
