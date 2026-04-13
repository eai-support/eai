# Plan: Provision Entra CIAM Routing

Date: 2026-04-13

## Implementation Plan

1. Keep CLI provisioning request shape unchanged except for product-safe error handling.
2. Fix production default API URL and internal profile docs so prod, test, and dev URLs match deployed platform URLs.
3. Add a CLI regression test proving named profile `publicApiUrl` overrides local `.env.local` for provisioning.
4. Change PublicAPI provisioning to resolve `ADMIN_API_URL` from env/App Configuration at request time.
5. Map PublicAPI downstream provisioning failures to product-safe public error messages.
6. Change AdminAPI settings to expose generic `ciam_tenant_id`, `graph_client_id`, and `graph_client_secret` properties.
7. Keep legacy `azure_dev_*` values as fallbacks during migration.
8. Update AdminAPI Graph credential creation, token validation JWKS URI, and App Configuration reset/guard logic to use the generic properties.
9. Add PublicAPI and AdminAPI regression tests for environment routing and CIAM credential selection.
10. Update CLI help and public docs to describe environment-owned CIAM routing.

## Risk Controls

- No CLI-supplied CIAM selector is introduced.
- PublicAPI no longer relays raw AdminAPI failure bodies.
- CLI no longer prints raw provisioning response details.
- AdminAPI startup refuses to serve if App Configuration loads but critical CIAM Graph settings are empty.

## Verification

- `npx vitest run tests/integration/provision.test.ts`
- `uv run pytest src/tests/unit/test_provision.py` in `PublicAPI`
- `uv run pytest tests/test_services/test_entra_service.py` in `AdminAPI`
- `npm run build`
- `npm run lint`
- `uv run ruff check src/app/routers/v3/provision.py src/tests/unit/test_provision.py` in `PublicAPI`
- `uv run ruff check src/core/config.py src/core/security.py src/core/azure_config.py src/services/entra_service.py tests/test_services/test_entra_service.py tests/integration/test_graph_api.py tests/conftest.py` in `AdminAPI`
