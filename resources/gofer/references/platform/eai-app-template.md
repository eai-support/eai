# EAI App Template Reference

Use `https://github.com/eai-support/eai-app-template` as the canonical public
app template for EnterpriseAI app-delivery work.

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
3. For workspace-scoped PublicAPI calls, the BFF or server helpers forward the
   `tenant` and `X-Tenant-Id` headers from server-validated workspace context,
   and attach auth and correlation headers.
4. The frontend never receives direct downstream database, blob, search, or
   PublicAPI credentials.
5. Use the published PublicAPI route family through the template SDK, named
   `eai` commands, or an approved server-side helper.

## Implementation Contract

For EAI-maintained source, include all customer-authored app files in the
managed-source upload: UI and backend code, custom runners, tests, scripts,
documentation, assets, and supported dot configuration. EAI-owned
authentication, platform-service, deployment, and workflow controls remain
protected. Credentials and local-tool metadata remain excluded. Read the
installed CLI's `eai deploy source validate --help` for its normalized source
boundary. Do not maintain a second allowlist in Gofer.

After selecting EAI-maintained source, run the read-only managed-source check
before implementation, after source changes, and before claiming readiness:

```bash
node .specify/scripts/node/eai-app-template-readiness.mjs --root . --source eai-managed --json
```

If the app uses an explicitly selected CLI executable, add `--cli <executable>`
to preserve that selection and its private profile. A missing validator,
unsupported edit, or malformed result blocks managed-source readiness. The
checker never publishes, changes the app, or replaces deployment evidence.
Preserve the complete customer app source on failure. An unsupported custom
runtime is an explicit failure; resolve its compatibility through the owning
template or a supported runtime. Never omit business changes or customer app
files, restore files automatically, or weaken protected EAI controls to pass.
Local-only and customer-owned source retain their own validation paths.

- Use Object Types as the data model contract.
- Keep PascalCase model names separate from the exact stored `slug`. Use
  lowercase kebab-case slugs in runtime paths and links; never re-derive or
  rename a historical stored slug.
- Use the template SDK and hooks for resources, documents, and chat.
- Use config slots with `{ components: [...] }`, not stale array-only slot
  examples.
- Use `storeBindings` for data-driven props and code-level overrides for
  callbacks, auth actions, analytics hooks, render props, and React nodes.
- Use the CLI for setup and verification:
  - `eai login`
  - `eai workspace select <workspace-slug>`
  - `eai types validate --tenant-key <key> --tenant-id <tenant-id>`
  - `eai types seed --tenant-key <key> --tenant-id <tenant-id>`
  - `eai types diff --tenant-key <key> --tenant-id <tenant-id>`
  - `eai resources schema --tenant-id <tenant-id>`
  - `eai verify calls --tenant-id <tenant-id> --resource-type <type>`

Do not describe retired templates as canonical scaffolds. The surviving public
scaffold is the EAI App Template.
