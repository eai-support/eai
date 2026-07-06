# Platform CLI Reference

Use this fallback when external CLI documentation is unavailable.

## Version Pinning Rule

- Detect the installed CLI version.
- Record the `major.minor` version in generated plan and task artifacts.
- Avoid pinning implementation guidance to patch-specific behavior.

## Command Guidance Contract

- Use live CLI discovery before assuming syntax:
  - `eai update --check`
  - `eai --describe`
  - `eai agent guide --format json` when advertised
  - `eai whoami`
  - `eai tenant list --format json`
- When the repo is already an EAI app project, also check:
  - `eai template check --format json`
  - `eai gofer refresh --check --format json`
  - `eai workflow readiness --format json` when advertised
  - `eai provision entra` when identity callback or Entra registration setup is
    in scope
- When any `eai` command fails, run
  `eai errors explain <code-or-reason> --format json` when advertised and use
  its public-safe reasons and next commands before guessing remediation.
- Treat every EAI failure as a recovery loop:
  1. capture the command shape, status, server code, and request ID when present
     without writing secrets or raw private debug output;
  2. prefer live `eai errors explain` guidance for the code or reason;
  3. if live guidance is unavailable, match
     `.specify/references/platform/eai-error-catalog.yaml`;
  4. run read-only diagnostics before mutating fixes;
  5. stop at the retry or escalation condition instead of looping.
- Include scaffolding or setup commands only when they are supported by the
  target project.
- Include deployment commands only when the target repository documents a
  deployment path.
- Add a user-visible notice when fallback references were used.

## Ordered EAI App Delivery Sequence

Unless the live CLI advertises a different dependency order:

1. Confirm template ownership or initialize with `eai init`
2. Install dependencies
3. Confirm login and tenant selection
4. Confirm or create/select the app
5. Provision app resources
6. Run object-type validation and publish
7. Verify schema, storage, and workflow readiness
8. Start preview or dev runtime

Do not treat provisioning, object-type publish, schema/storage health, workflow
readiness, and preview as interchangeable states.

## Error Recovery

When commands fail, consult `eai-error-catalog.yaml` in the same folder. Match
the failure to a recovery path, then use
`eai errors explain <code-or-reason> --format json` when the CLI advertises it.
Record the blocked gate in `.specify/specs/{feature}/eai-preflight.md`, and
avoid inventing a new order.

For tenant member or admin changes, use EAI CLI membership commands first. If
`eai user invite` fails with `EXTERNAL_SERVICE_ERROR`, a 5xx status, or the
`user_invite_external_service_existing_member` reason, check whether the person
already exists with
`eai user list --tenant <tenant-id> --search <email> --format json`. If a direct
member exists and the user approves the role change, use
`eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json`,
verify the read-back, then tell the affected app user to sign out and sign back
in because Auth.js session or JWT role data may be cached. Do not use direct
database edits or cloud portal changes unless EAI guidance reports an
operator-only block.

If a browser sign-in flow reports `AADSTS50011` or a Microsoft Entra redirect
URI mismatch, do not start with manual Azure Portal edits. Confirm the EAI login
and tenant, confirm the callback URI from the failing authorize request in the
active session, then run the advertised
`eai provision entra --force --redirect-uri <confirmed-callback-uri>` path and
retry sign-in. Record only a redacted callback route in Gofer artifacts. Use
`--debug` only with explicit user approval, and redact private hostnames, tenant
IDs, client IDs, tokens, and raw debug output before writing artifacts.
