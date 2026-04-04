---
feature: CLI First-Party Browser Auth
validated: 2026-03-30T22:03:14Z
validator: Codex GPT-5
status: PASS
score: 100/100
iteration: 2
has_ui: false
---

# Validation Report: CLI First-Party Browser Auth

## Rubric Score

| # | Category | Points | Score | Status | Evidence |
|---|---|---:|---:|---|---|
| 1 | Functional Correctness | 20 | 20 | PASS | Browser-PKCE login flow implemented; auth storage fix verified; full test suite passes |
| 2 | Test Authenticity | 20 | 20 | PASS | 16/16 tests pass; no skips; interactive init path covered deterministically |
| 3 | UI/E2E Verification | 0 | N/A | SKIP | No UI feature; points redistributed |
| 4 | Security Posture | 10 | 10 | PASS | No device flow, no runtime client-ID override, encrypted local token storage retained |
| 5 | Integration Reality | 10 | 10 | PASS | Contract audit exercises platform call shapes; login integration covers callback and token exchange |
| 6 | Error Path Coverage | 10 | 10 | PASS | Login failure and token exchange failure are tested; silent auth catches removed from touched path |
| 7 | Architecture Compliance | 10 | 10 | PASS | Implementation, tests, and feature artifacts now all describe browser PKCE |
| 8 | Performance Baseline | 5 | 5 | PASS | No new sync hot-path regressions; auth path change is lightweight |
| 9 | Code Hygiene | 10 | 10 | PASS | Build/lint/typecheck clean; touched code has no placeholder logic or empty catch blocks |
| 10 | Specification Traceability | 5 | 5 | PASS | Spec, plan, tasks, quickstart, contracts, and tests map to shipped behavior |
| | **TOTAL** | **100** | **100** | **PASS** | |

## Automated Check Results

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✅ PASS |
| Lint | `npm run lint` | ✅ PASS |
| TypeCheck | `npm run typecheck` | ✅ PASS |
| Tests | `npm test` | ✅ PASS (16/16 tests) |
| Login Help | `node dist/index.js login --help` | ✅ PASS (`--client-id` absent) |
| Login Override Rejection | `node dist/index.js login --client-id abc123` | ✅ PASS (unknown option) |

## Key Evidence

- `src/lib/auth.ts` now resolves token storage paths dynamically from the active
  home directory, which removed cross-test and alternate-HOME inconsistency.
- `tests/helpers/action-dsl.ts` routes `eai` commands through the local built
  CLI entrypoint instead of requiring a global installation.
- `tests/integration/login.test.ts` covers successful browser callback login and
  token-exchange failure.
- `tests/integration/verify-calls.test.ts` validates the contract-audit command
  with authenticated and unauthenticated cases.
- `.specify/specs/cli-first-party-auth/` now documents browser PKCE rather than
  the removed device-code flow.
- `docs/src/content/docs/concepts/architecture.mdx`,
  `docs/src/content/docs/concepts/security-model.mdx`, and
  `docs/src/content/docs/reference/glossary.mdx` now reflect the shipped CLI
  auth model.

## Findings

### Red

None.

### Yellow

None blocking this feature validation pass.

### Gray

- Some broader docs still mention `ENTRA_CLIENT_ID` for web-application auth
  configuration, which is valid outside the CLI login path.

## Conclusion

**Status**: PASS

The feature now validates cleanly. The implementation, automated coverage, and
feature artifacts are aligned around first-party browser login with PKCE, and
the repo passes build, lint, typecheck, and full test execution.
