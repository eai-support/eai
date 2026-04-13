# Tasks: Provision Entra CIAM Routing

Date: 2026-04-13

## Implementation

- [x] Confirm CLI profile routing behavior and environment URL precedence.
- [x] Confirm PublicAPI owns the public provisioning route and forwards to AdminAPI.
- [x] Confirm AdminAPI owns Microsoft Graph app registration creation.
- [x] Confirm ResourceAPI does not participate in app registration creation.
- [x] Update default production platform API URL.
- [x] Update PublicAPI/AdminAPI fallback environment defaults to production.
- [x] Update internal profile docs for dev/test platform API URLs.
- [x] Keep provisioning CIAM selection out of the CLI request body.
- [x] Sanitize CLI provisioning errors with stable support references.
- [x] Resolve CLI tenant membership lookups through the current PublicAPI URL instead of stale token metadata.
- [x] Reject malformed provisioning success responses that omit a usable client ID.
- [x] Resolve PublicAPI AdminAPI URL at request time from active environment config.
- [x] Sanitize PublicAPI downstream provisioning failures.
- [x] Reject malformed AdminAPI provisioning responses in PublicAPI before returning success to CLI callers.
- [x] Add generic AdminAPI CIAM Graph config properties.
- [x] Keep legacy AdminAPI dev-named Graph config as fallback.
- [x] Reset AdminAPI app-registration service singleton after App Configuration load.
- [x] Sanitize AdminAPI external dependency and duplicate-registration errors.
- [x] Update CLI help and docs for profile-owned platform routing and platform-owned CIAM selection.

## Tests

- [x] CLI profile URL override regression.
- [x] CLI default production URL fallback regression.
- [x] CLI dev profile URL override regression.
- [x] CLI current-profile membership lookup regression.
- [x] CLI malformed provisioning response regression.
- [x] CLI product-safe 404/501 provisioning error regressions.
- [x] PublicAPI active environment AdminAPI URL regression.
- [x] PublicAPI downstream detail sanitization regression.
- [x] PublicAPI malformed success response regressions.
- [x] AdminAPI generic CIAM Graph credential regression.
- [x] AdminAPI legacy fallback regression.
- [x] AdminAPI default production environment-label regression.
- [x] AdminAPI external service and duplicate-registration sanitization regressions.
- [x] Full validation and lint pass.
