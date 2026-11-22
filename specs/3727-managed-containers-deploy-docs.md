# Managed Containers Deployment Docs

Issue: [#3727](https://github.com/enterpriseaigroup/Issues2025/issues/3727)

## Goal
Explain the supported EAI Managed Containers CLI deployment command before the third-party hosting options.

## Contract
- Validate the local app source with `eai deploy source validate --format json`.
- Deploy with `eai deploy app <app-key> --target eai` and the owning and runtime tenant IDs.
- State that the same tenant ID is used for both options when the app runs in its owning workspace.
- Keep the generated company website copy aligned with the CLI source documentation.

## Validation
- Run the docs experience asset consistency check.
- Build the docs site and verify the rendered command.
- Verify the website's generated page matches the CLI docs build.

## Release Boundary
Documentation only. No deployment environment or customer data changes.
