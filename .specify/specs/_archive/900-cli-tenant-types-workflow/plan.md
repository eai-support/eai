# Plan: CLI Tenant and Types Workflow

## Tech Stack

- TypeScript CLI
- Commander.js
- Vitest
- Astro docs

## Architecture Notes

- Keep command logic in `src/commands/*`.
- Expose small pure helpers for tenant-admin filtering and tenant resolution so tests can cover platform-shape compatibility directly.
- Align tenant-resolution rules with app/runtime conventions observed in `eai-council-roi-dash` and tenant-admin membership shapes observed in `com.enterpriseaigroup`.

## Validation Strategy

- Unit/integration-style tests for helper functions.
- Build, lint, typecheck, targeted tests, and docs build.
- Manual review against the referenced app/platform patterns.

## No UI

This is a CLI/docs feature with no browser UI or E2E frontend surface.
