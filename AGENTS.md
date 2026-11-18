# eai CLI — Agent Instructions

## Role & Stack

`eai` (`eai-support/eai`, published as `eai-cli` / `@enterpriseai/cli`) is the Enterprise AI CLI for
scaffolding, authenticating, deploying and operating EAI apps against the regional PublicAPI.
TypeScript (strict, ESM), Node, Commander.js, npm, Vitest. Do not use the workspace `./eai` path in
`eai-stack`; that repo owns the `eai` command name.

## Commands

- `npm run build` (tsc), `npm run lint`, `npm run typecheck`, `npm test` (vitest), `npm run test:coverage`
- `npm run test:eai-cli:ci`: focused suite behind the `ci/eai-cli-tests` check (SRP evidence for the CLI)
- `npm run release:check`: release preflight. `./release.sh <patch|minor|major> "Message"` is the
  canonical human release entrypoint.

## Key Structure

- `src/index.ts` program entry; `src/commands/` one module per command (init, dev, login, whoami, tenant,
  types, resources, deploy, verify, gofer, template, update, eai-managed-*); `src/lib/` shared modules
  (`api.ts` PlatformAPIClient, `auth.ts` Entra CIAM, `config.ts`, `error-codes.ts`, `output.ts`,
  `gofer-refresh.ts`, `update-check.ts`, `schema-builder.ts`).
- `tests/unit`, `tests/integration`; `docs-site/` Docusaurus site published from `.tech-docs`;
  `resources/gofer/` bundled Gofer assets shipped to users (product content, not this repo's instructions).

## Code Conventions

- Strict TS, ESM `import`/`export` only, explicit return types on public functions, `unknown` over `any`,
  `readonly` where possible, interfaces for object shapes.
- Commands use Commander with `--format <text|json>`, `--simple` and `--no-color` support. Fail with
  `exitWithError(ErrorCode.Exxx, ctx, format)`; print via `lib/output.ts`; call APIs via `createAPIClient`.
- Never commit secrets or add dependencies without justification; keep changes within project scope.

## Object Type Identifier Contract (mandatory for CLI code, docs, scaffolds, bundled Gofer text)

- Keep the PascalCase model `name` (`BoardAppUser`) distinct from its explicit lowercase kebab-case
  transport `slug` (`board-app-user`). Emitted `linkTypes[].targetObjectType`, runtime `target_type`, path
  parameters and governed v4 query fields hold exact stored slugs.
- Resolve a same-manifest PascalCase relationship target through the target's declared `slug` before diffing
  or seeding; reject unresolved names instead of guessing. Never re-derive, normalize, alias or rename
  historical stored slugs. App code uses the shared SDK for routes; the CLI must not encourage hand-written
  v4 paths or app-local slugifiers.

## Testing Conventions

- Update owned tests in the same PR as behavior changes; run `npm test` and `npm run lint` before commit.
- CLI auth, tenant context, command schema, error envelope, PublicAPI and preview-lifecycle behavior must keep
  `ci/eai-cli-tests` green; add new test files to `test:eai-cli:ci` when they cover those surfaces.
- Browser journeys, provider edge cases and login/session UI belong in the owning frontend/provider repo.
  `enterpriseaigroup/vanguard` (formerly `eai-testing-dev`) owns only deployed PublicAPI V4+ black-box CRUD
  and read-only PROD smoke; deployed CLI canaries stay read-only. Keep CI check names, coverage mappings and
  release evidence in sync.

## Workflow & Release

- Feature PRs link an `enterpriseaigroup/Issues2025` issue and add `specs/<issue>-<slug>.md` (<=60 lines,
  #3688). The PR body also carries a `Plan:` line for the advisory `plan-gate` workflow (`Plan: exempt —
  <reason>` or a `.specify(-pro)/specs/<feature>/plan.md` path) until spec-check replaces it. Conventional
  commits; feature branches; never push to `main` directly.
- Keep `release.sh`, `.github/workflows/release.yml`, `.github/workflows/docs.yml`, `src/commands/update.ts`,
  `src/lib/update-check.ts` and `README.md` aligned. Each release refreshes `docs-site/static/llms.txt`,
  `llms-full.txt` and `cli-help.txt`.
- npmjs is the primary channel (`npm install -g eai-cli`; canonical `@enterpriseai/cli`); the GitHub Pages
  registry `https://eai-support.github.io/eai/registry/` is the fallback. Before changing release behavior,
  verify both: `npm view eai-cli version --registry=https://registry.npmjs.org/` and
  `curl https://eai-support.github.io/eai/registry/@enterpriseai/cli`.
- `eai update` upgrades only the CLI package. `eai gofer refresh --check`, `eai doctor --check-updates` and
  `eai template check` are read-only previews; template/UI drift is reviewed and copied manually.
- Core release flow: `enterpriseaigroup/eai-stack` `docs/interim-cicd-runbook.md`. This repo's release workflow keeps its own style.
- `CLAUDE.md` is a symlink to this file; edit only `AGENTS.md`.
