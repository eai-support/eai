# Tasks: Provision Entra Diagnostics

Date: 2026-04-13

- [x] Inspect `eai provision entra` command behavior and the platform provisioning client call.
- [x] Keep failed provisioning request errors sanitized at the API client boundary.
- [x] Render product-safe diagnostics for `404`, `501`, `403`, `409`, and generic provisioning failures.
- [x] Update command help with provisioning diagnostics.
- [x] Add regression tests for `404` and `501` failures that must not leak backend details.
- [x] Update README and Starlight docs for the provisioning command and API contract.
- [x] Run focused provision tests.
- [x] Run build, lint, full tests, and docs build.
