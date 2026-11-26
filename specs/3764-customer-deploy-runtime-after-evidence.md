# Customer-owned deploy sets up the runtime after build evidence

Issue [#3764](https://github.com/enterpriseaigroup/Issues2025/issues/3764)

## Problem

`eai deploy app <key> --source customer-owned` asked PublicAPI for the runtime
identity before it dispatched the workflow. The service refuses that request
until the workflow's build evidence is accepted, and TenantInfra stores runtime
configuration only for a deployment it has already registered. Every hosted
run stopped with `RUNTIME_BOOTSTRAP_FAILED` and no workflow run.

The service order is: the workflow submits evidence, the deployment is
registered and held as `awaiting-runtime`, the runtime identity is set up, and
the held deployment is released.

## Acceptance criteria

- AC-1. A new deployment, and a retry of an undispatched one, dispatches the
  workflow first and sends no runtime request before build evidence is accepted.
- AC-2. While following a dispatched operation, the CLI sets up the runtime
  identity once, when the operation reports `awaiting-runtime`. A failed or
  mismatched runtime response still stops the command. The integration fake
  refuses an early runtime request with the service's own 409, so a wrong
  order fails the test.
- AC-3. `--resume` stays read-only. It stops waiting when the deployment is
  held for its runtime identity and names the `--retry` command that moves it
  on. `--no-wait` prints the same `--retry` command.
- AC-4. The runtime request fits the service: it allows first-time setup up
  to 180 seconds, a timeout stops with `RUNTIME_BOOTSTRAP_TIMEOUT` and the
  `--retry` command, and PublicAPI's reply is accepted when its `tenantId` is
  the target tenant (it sends no `targetTenantId`).

## Out of scope

PublicAPI, AdminAPI and TenantInfra keep their rules. Accepted-evidence
retries still use the existing deployment handoff. The EAI-maintained source
path is unchanged.

## Config keys added

None.
