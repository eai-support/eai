# Copilot Instructions

## Project Overview

**eai** is a TypeScript project. Package manager: npm.

## Object Type Identifiers

Keep PascalCase model `name` separate from exact lowercase kebab-case transport
`slug`. Emitted relationship/runtime fields contain stored slugs. Resolve
same-manifest relationship names through the declared slug, reject unresolved
names, use the SDK for app routes, and never re-derive or rename historical
stored slugs.

## Available Commands

### Gofer Integration

This project uses Gofer for structured feature development. Gofer prompts are
available in `.github/prompts/` and `.github/instructions/` for use with GitHub
Copilot Chat.

The committed `.specify` directory contains reusable Gofer scripts and
templates. Generated feature specs, memory files, logs, checkpoints, and other
runtime state are local-only and ignored by git.

Never include secrets, private tenant data, customer data, private URLs, or
local `.env` files in generated Gofer output, issues, pull requests, commits,
or workflow logs.

## Code Quality

### TypeScript Conventions

- Use strict mode (`"strict": true` in tsconfig.json)
- Use ESM imports (`import`/`export`), never `require()`
- Add explicit return types to all public functions
- Prefer `unknown` over `any`; use proper type narrowing
- Use `readonly` for properties that should not be reassigned
- Prefer interfaces over type aliases for object shapes

## Release Workflow

- `./release.sh <patch|minor|major> "Message"` is the canonical release entrypoint
- Run `npm run release:check` before treating release work as complete
- Keep `release.sh`, `.github/workflows/release.yml`, `src/commands/update.ts`,
  `src/lib/update-check.ts`, and `README.md` aligned
- Verify npmjs and the public static fallback registry explicitly:
  - `npm view eai-cli version --registry=https://registry.npmjs.org/`
  - `npm view @enterpriseai/cli version --registry=https://registry.npmjs.org/ --@enterpriseai:registry=https://registry.npmjs.org/`
  - `curl https://eai-support.github.io/eai/registry/@enterpriseai/cli`
- Recommended install is `npm install -g eai-cli`
- Canonical package install is `npm install -g @enterpriseai/cli`
- Static fallback install is `npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/`
- Persistent static fallback setup is `npm config set @enterpriseai:registry https://eai-support.github.io/eai/registry/ --location=user`
- `eai update` upgrades the installed CLI package only
- `eai gofer refresh --check` previews safe Gofer-managed repo updates
- `eai doctor --check-updates` reports CLI, Gofer, and template drift
- `eai template check` previews app-template and UI drift before manual updates
