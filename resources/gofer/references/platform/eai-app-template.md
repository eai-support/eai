# EAI App Template Reference

Use `https://github.com/eai-tools/eai-app-template` as the canonical public app
template for EnterpriseAI app-delivery work.

## Source Of Truth

- New apps are scaffolded with `eai init`, which defaults to the EAI App
  Template.
- Runnable service patterns live in the template, especially
  `docs/platform/config-driven-ui.md`, `docs/platform/eai-service-patterns.md`,
  `src/hooks`, and `packages/platform-sdk`.
- Config-driven UI composition lives in `src/eai.config/default.ts`,
  `src/eai.config/index.ts`, and `src/eai.blocks.tsx`.
- eai-gofer should use those public template patterns and the installed `eai`
  CLI instead of copying private platform documentation.

## App Boundary Contract

1. Browser code calls the local app BFF at `/api/eai/...`.
2. Browser streaming uses `/api/eai/stream/...`.
3. The BFF or server helpers attach auth, tenant, and correlation headers.
4. The frontend never receives direct downstream database, blob, search, or
   PublicAPI credentials.
5. Prefer PublicAPI V4 surfaces; v3 route-family mapping is compatibility glue.

## Implementation Contract

- Use Object Types as the data model contract.
- Use the template SDK and hooks for resources, documents, and chat.
- Use config slots with `{ components: [...] }`, not stale array-only slot
  examples.
- Use `storeBindings` for data-driven props and code-level overrides for
  callbacks, auth actions, analytics hooks, render props, and React nodes.
- Use the CLI for setup and verification:
  - `eai login`
  - `eai tenant select <tenant-slug>`
  - `eai types validate`
  - `eai types seed --tenant-key <key> --tenant-id <tenant-id>`
  - `eai types diff --tenant-key <key> --tenant-id <tenant-id>`
  - `eai resources schema --tenant-id <tenant-id>`
  - `eai verify calls --tenant-id <tenant-id> --resource-type <type>`

Do not describe retired templates as canonical scaffolds. The surviving public
scaffold is the EAI App Template.
