# Discovery: CLI First-Party Auth

## Problem

The CLI no longer uses a per-project `ENTRA_CLIENT_ID` or the legacy auth UX.
The shipped implementation is first-party browser sign-in using authorization
code flow with PKCE and a localhost callback. The feature artifacts had drifted
from that implementation, which caused validation and traceability failures.

## Current Implementation

- `eai login` uses a built-in first-party public client ID.
- The command opens the Entra CIAM authorize URL in the browser.
- A localhost HTTP callback receives the authorization code.
- The CLI exchanges the code for tokens at `/oauth2/v2.0/token`.
- Tokens are stored locally in `~/.eai/tokens.json`.
- `--client-id` is intentionally unsupported.

## Expected User Outcome

- A clean machine can run `eai login` without project auth configuration.
- If automatic browser launch fails, the CLI surfaces a manual URL.
- `eai init`, `eai verify`, and `eai dev` do not require CLI-specific client ID
  configuration.
- The repo tests and feature artifacts align with the shipped PKCE flow.

## Validation Focus

- `login.ts` help and option surface
- `auth.ts` PKCE browser callback flow
- encrypted token storage and refresh compatibility
- `init`, `verify`, and related docs no longer implying device flow
- executable integration coverage for login and contract audit paths
