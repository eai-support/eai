# Discovery: Provision Entra CIAM Routing

Date: 2026-04-13

## Scenario

`eai provision entra` must create the vertical app registration in the CIAM tenant that matches the active platform environment.

## Stakeholders

- EAI platform users running `eai provision entra` after `eai init`.
- EAI platform administrators operating dev, test, and production environments.
- Public EAI customers who must not receive implementation details from platform failures.

## Business Problem

Provisioning is currently ambiguous when the CLI profile changes environment. The CLI can select a platform API URL, but the actual app registration is created by backend services. If those services use stale or globally named CIAM settings, a test or dev profile can still create or check registrations in the wrong CIAM.

The failure mode is high risk because it affects authentication, tenant isolation, and customer trust.

## Desired Outcome

- Default/no profile provisions through production and creates the app registration in production CIAM.
- `--profile test` provisions through test and creates the app registration in test CIAM.
- `--profile dev` provisions through dev and creates the app registration in dev CIAM.
- The CLI does not expose or control CIAM selection directly.
- User-facing errors remain product-safe and do not reveal backend routes, service names, tenant identifiers, stack errors, or raw platform responses.

## Success Metrics

- CLI profile routing test proves named profile `publicApiUrl` overrides local env for provisioning.
- PublicAPI test proves AdminAPI URL is resolved from active environment config at request time.
- AdminAPI test proves Graph credentials prefer generic environment-specific CIAM settings over legacy dev-named settings.
- PublicAPI and CLI tests prove raw downstream error detail is not returned to users.
