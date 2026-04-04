# Research: CLI First-Party Browser Auth

## Code Findings

### `src/commands/login.ts`

- embeds `DEFAULT_CLIENT_ID`
- exposes `--tenant-name`, `--tenant-id`, and `--scope`
- calls `browserLogin(...)`
- intentionally has no `--client-id` flag

### `src/lib/auth.ts`

- implements browser auth with authorization code flow and PKCE
- starts a localhost callback server on an ephemeral port
- opens the authorize URL via OS-specific browser launch commands
- exchanges the returned code at `/oauth2/v2.0/token`
- stores encrypted tokens locally

### `src/commands/init.ts`

- scaffolds project env/config without a CLI `ENTRA_CLIENT_ID` requirement

### `src/commands/verify.ts`

- `verify` checks connectivity and auth state
- `verify calls` audits real CLI contract assumptions across platform endpoints

## Test Findings

- direct shelling to bare `eai` made integration tests depend on a global PATH
- auth tests shared the real home directory, which caused cross-test token
  interference under parallel runs
- interactive `init` prompts were not reliable through piped stdin for list and
  confirm prompts

## Decisions

1. Treat browser PKCE as the source of truth.
2. Keep `--client-id` unsupported.
3. Add executable login tests around `browserLogin()`.
4. Isolate auth storage per test environment.
5. Invoke the interactive `init` branch by mocking `inquirer.prompt` rather
   than depending on a pseudo-terminal.
6. Resolve auth storage paths dynamically so tests and alternate HOME contexts
   work correctly after module import.
