---
feature: 001-cli-consolidation
created: 2026-03-09T11:00:00Z
status: complete
---

# Plan: CLI Consolidation & Org Migration

## Architecture

No architectural changes — the CLI structure remains the same:

```
src/
├── index.ts              # Entry point, command registration
├── lib/
│   ├── api.ts            # PublicAPI client
│   ├── auth.ts           # Device code auth + token storage
│   ├── config.ts         # Config loader (eai.config.ts, .env.local)
│   └── output.ts         # Formatting utilities
└── commands/
    ├── init.ts           # PRIMARY CHANGES HERE
    ├── dev.ts
    ├── login.ts
    ├── env.ts
    ├── types.ts
    ├── tenant.ts
    ├── resources.ts
    ├── chat.ts
    ├── docs.ts
    ├── deploy.ts
    ├── verify.ts
    └── whoami.ts
```

## Changes by File

### `package.json`
- Rename `@enterpriseaigroup/cli` → `@eai-tools/cli`

### `src/commands/init.ts`
- Update `TEMPLATE_REPO` constant → `https://github.com/eai-tools/Vertical-Template.git`
- Update `GITHUB_ORG` constant → `eai-tools`
- Enhance `generateEnvFile()` — add `TENANT_KEYS`, improve comments
- Enhance `generateObjectTypesScaffold()` — richer example with all field types
- Add `generateClaudeMd()` — project-specific CLAUDE.md
- Enhance `generateDeployWorkflow()` — add `build:object-types` step, `target-path`
- Update "Next steps" output to reference eai-tools org

### `src/commands/deploy.ts`
- Update `generateWorkflow()` — add `build:object-types` step, `target-path`

### `README.md`
- Update all `enterpriseaigroup` references to `eai-tools`

### `docs/research.md`
- Already correct (references Platform SDK patterns, not org-specific)

## Testing Strategy

1. Build (`npx tsc`) — must compile cleanly
2. `eai --help` — all commands listed
3. `eai types validate` (from Vertical-Template) — must pass
4. `eai doctor` (from Vertical-Template) — must detect project
5. Manual review of generated scaffolds (env, types, workflow, CLAUDE.md)

## Phases

Single phase — all changes are in the CLI repo, no external dependencies.
