# Validation Report: Provision Entra CIAM Routing

Date: 2026-04-13
Status: PASS
Score: 100/100

## Scope

Validated the end-to-end `eai provision entra` routing change across the CLI,
PublicAPI, and AdminAPI. The change keeps CIAM selection platform-owned, routes
the CLI through the active profile's PublicAPI URL, defaults missing profile
configuration to production, and prevents backend or CIAM implementation details
from being returned to public CLI users.

## Context

- Context health was healthy at approximately 2 percent when validation began.
- The Gofer prerequisite helper could not infer the feature folder from the
  branch name pattern, so `.specify/specs/903-provision-entra-ciam-routing/`
  was used directly.
- This is a no-UI feature. UI/E2E points were redistributed to functional
  correctness and test authenticity according to the rubric.

## Acceptance Criteria Trace

- AC-001: PASS. With no active named profile, the CLI resolves
  `https://api.ae.myenterprise.ai/public`; PublicAPI and AdminAPI fallback
  environment labels resolve to production.
- AC-002: PASS. A named `test` profile `publicApiUrl` overrides `.env.local`
  during provisioning.
- AC-003: PASS. A named `dev` profile follows the same profile-first resolution
  path and ignores stale local API configuration.
- AC-004: PASS. Provisioning requests include tenant, vertical name, redirect
  URIs, and idempotency only. They do not include CIAM tenant, CIAM environment,
  or Graph credential selector fields.
- AC-005: PASS. PublicAPI resolves `ADMIN_API_URL` from active environment or App
  Configuration at request time.
- AC-006: PASS. PublicAPI maps downstream AdminAPI and malformed success
  responses to safe provisioning failures without relaying raw details.
- AC-007: PASS. AdminAPI Graph credential creation uses generic
  environment-specific CIAM settings.
- AC-008: PASS. Legacy `azure_dev_*` settings remain supported as fallbacks.
- AC-009: PASS. AdminAPI App Configuration load resets the app-registration
  service singleton.
- AC-010: PASS. CLI help, README, quickstart docs, API surface docs, and internal
  profile docs explain profile-owned platform routing and platform-owned CIAM
  selection.

## Automated Checks

| Repo | Check | Command | Result |
|---|---|---|---|
| eai-cli | Build | `npm run build` | PASS |
| eai-cli | Type check | `npm run typecheck` | PASS |
| eai-cli | Full tests | `npm test` | PASS, 13 files, 87 tests |
| eai-cli | Placeholder guard | `npm run lint:no-placeholder` | PASS |
| eai-cli | Lint | `npm run lint -- --max-warnings=0` | PASS |
| eai-cli | Targeted provision/whoami | `npx vitest run tests/integration/provision.test.ts tests/integration/whoami.test.ts` | PASS, 16 tests |
| eai-cli | No-emit compile | `npx tsc -p tsconfig.json --noEmit` | PASS |
| eai-cli docs | Docs build | `npm run build` in `docs` | PASS |
| PublicAPI | Full tests | `uv run pytest` | PASS, 756 passed, 4 skipped |
| PublicAPI | Lint | `uv run ruff check src/app/routers/v3/provision.py src/tests/unit/test_provision.py src/app/config.py src/tests/unit/test_config_environment.py` | PASS |
| PublicAPI | Production alias regression | `APP_ENVIRONMENT=production uv run pytest src/tests/unit/test_orchestrator_service.py src/tests/unit/test_user_service.py -q` | PASS, 40 tests |
| AdminAPI | Full tests | `uv run pytest` | PASS, 343 passed |
| AdminAPI | Targeted provisioning/config tests | `uv run pytest tests/test_fixes.py tests/test_ciam.py tests/test_azure_config.py tests/test_services/test_entra_service.py` | PASS, 61 tests |
| AdminAPI | Lint | `uv run ruff check src/api/routes/ciam.py src/core/exceptions.py src/core/config.py src/core/security.py src/core/azure_config.py src/services/entra_service.py tests/test_azure_config.py tests/test_ciam.py tests/test_fixes.py tests/test_services/test_entra_service.py` | PASS |

## Rubric

| Category | Points | Result |
|---|---:|---|
| Functional Correctness | 20 | PASS |
| Test Authenticity | 20 | PASS |
| UI/E2E Verification | N/A | No UI surface; points redistributed |
| Security Posture | 10 | PASS |
| Integration Reality | 10 | PASS |
| Error Path Coverage | 10 | PASS |
| Architecture Compliance | 10 | PASS |
| Performance Baseline | 5 | PASS |
| Code Hygiene | 10 | PASS |
| Specification Traceability | 5 | PASS |

## Validation Findings Resolved

| Finding | Resolution |
|---|---|
| Default/no-profile routing lacked explicit production fallback coverage. | Added CLI regression coverage for stale stored API URL plus production default fallback. |
| Dev profile routing was not independently covered. | Added dev profile regression proving profile URL wins over local env. |
| CLI and PublicAPI error paths risked returning backend implementation details. | Added safe `PlatformAPIRequestError`, sanitized CLI output, sanitized PublicAPI downstream handling, and no-leak assertions. |
| `whoami` could use stale token metadata for membership lookups. | Resolved membership lookup through the current profile/environment PublicAPI URL and added MSW regression coverage. |
| Successful provisioning responses without a valid client ID could be accepted. | Added CLI and PublicAPI response validation plus malformed response regressions. |
| AdminAPI dependency failures and duplicate conflicts could expose internal details. | Sanitized `ExternalServiceError` API responses and duplicate app-registration conflict details. |
| AdminAPI service singleton reset coverage missed the Entra service. | Added reset assertion for the Entra service singleton. |
| Quickstart/help text still implied stale login-metadata routing. | Updated help and docs to describe profile-owned API routing and platform-owned CIAM routing. |

## Notes

- PublicAPI emitted existing third-party/Pydantic warnings during the full test
  suite. They did not fail the run.
- One intermediate integration-review result referenced a stale sibling
  checkout outside the submodule path. The actual `PublicAPI` and `AdminAPI`
  submodules were verified directly with their full test suites and targeted
  provisioning tests.
