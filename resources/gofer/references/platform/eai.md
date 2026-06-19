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
  - `eai whoami`
  - `eai tenant list --format json`
- When the repo is already an EAI app project, also check:
  - `eai template check --format json`
  - `eai gofer refresh --check --format json`
  - `eai workflow readiness --format json` when advertised
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
the failure to a recovery path, record the blocked gate in
`.specify/specs/{feature}/eai-preflight.md`, and avoid inventing a new order.
