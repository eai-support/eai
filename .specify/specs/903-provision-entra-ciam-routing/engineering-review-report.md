# Engineering Review Report: Provision Entra CIAM Routing

Date: 2026-04-13
Status: PASS
Cycles: 4

## Outcome

Approved for PR after iterative review and remediation. The implementation keeps
public CLI behavior stable, moves identity-boundary selection behind the
platform services, and prevents PublicAPI or AdminAPI internals from being
returned to public `eai` users.

## Cycle Findings

| Cycle | Severity | Finding | Status |
|---:|---|---|---|
| 1 | High | CIAM selection must not be controlled by a CLI request field because callers must not be able to target arbitrary identity boundaries. | Fixed by keeping CIAM routing backend-owned and documenting the contract. |
| 1 | High | PublicAPI could resolve AdminAPI URL too early and keep a stale or localhost fallback. | Fixed by resolving the AdminAPI URL at request time. |
| 1 | High | PublicAPI and CLI errors could relay raw downstream provisioning details. | Fixed with safe platform errors and regression tests. |
| 1 | Medium | AdminAPI Graph settings used dev-named fields, obscuring environment ownership. | Fixed with generic CIAM Graph settings plus legacy fallback. |
| 1 | Medium | AdminAPI service singletons could retain config loaded before App Configuration. | Fixed by resetting the Entra service singleton after config load. |
| 2 | High | CLI membership/provisioning helpers could use stale `publicApiUrl` from stored token metadata instead of the active profile. | Fixed by resolving PublicAPI URL fresh from active profile, `.env.local`, environment, or production default. |
| 2 | High | CLI could accept a malformed successful provisioning response without a usable client ID. | Fixed with response validation and no-credential-write regressions. |
| 2 | High | PublicAPI could treat malformed AdminAPI success or race responses as valid. | Fixed with server-side client ID validation and safe 503 responses. |
| 3 | Medium | Quickstart and help wording still implied login metadata controlled provisioning routing. | Fixed by updating CLI help, README, quickstart, API surface docs, and profile docs. |
| 4 | Medium | `tests/integration/whoami.test.ts` retained an unused import after the whoami regression was added. | Fixed and rechecked with build, targeted tests, and no-emit compile. |

## Verification After Fixes

| Repo | Verification | Result |
|---|---|---|
| eai | `npm run build && npm run typecheck && npm test && npm run lint:no-placeholder && npm run lint -- --max-warnings=0` | PASS |
| eai | `npm run build && npx vitest run tests/integration/provision.test.ts tests/integration/whoami.test.ts && npx tsc -p tsconfig.json --noEmit` | PASS |
| eai docs | `npm run build` in `docs` | PASS |
| PublicAPI | `uv run pytest` | PASS, 756 passed, 4 skipped |
| PublicAPI | Targeted ruff checks on changed files | PASS |
| AdminAPI | `uv run pytest` | PASS, 343 passed |
| AdminAPI | Targeted provisioning/config tests, ruff checks, and `pre-commit run --all-files` | PASS |

## Compatibility Review

- Existing CLI provisioning request shape is preserved. No CIAM selector fields
  were added to the public request contract.
- Existing profile behavior is preserved except that stale token metadata no
  longer overrides the current profile/environment API URL.
- Existing AdminAPI legacy `azure_dev_*` configuration remains a fallback while
  production, test, and dev environments migrate to generic CIAM Graph keys.
- PublicAPI and AdminAPI continue returning stable provisioning outcomes while
  removing backend, route, tenant, and Graph implementation details from public
  errors.
- ResourceAPI remains outside the app-registration creation path and is not
  changed.

## Residual Risks

- Azure App Configuration must contain the correct per-environment `ADMIN_API_URL`
  values for PublicAPI and generic CIAM Graph settings for AdminAPI.
- Legacy `azure_dev_*` settings should be removed after all deployed
  environments have migrated to generic keys.
