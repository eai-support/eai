# Specification: Provision Entra Diagnostics

Date: 2026-04-13

## User Story

As a developer running `eai provision entra`, I want provisioning failures to return safe, actionable guidance without exposing backend routes, implementation details, tenant identifiers, or raw platform errors.

## Acceptance Criteria

- AC-001: `eai provision entra` does not print raw platform error bodies when provisioning fails.
- AC-002: A `404` response returns product-safe unavailable guidance with a support reference.
- AC-003: A `501` response returns product-safe unavailable guidance with a support reference.
- AC-004: Failure output does not include backend route URLs, backend names, backend error codes, tenant identifiers, or raw implementation messages.
- AC-005: Regression tests cover `404` and `501` failures and assert that internal details do not leak.
- AC-006: CLI help and public documentation describe product-safe provisioning diagnostics.

## Non-Goals

- Deploying platform services.
- Changing Entra app registration creation behavior.
- Rotating secrets for existing app registrations.
