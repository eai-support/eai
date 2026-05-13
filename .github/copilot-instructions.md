# Copilot Instructions

## Project Overview

**eai-cli** is a TypeScript project. Package manager: npm.

## Available Commands

### Gofer Integration

This project uses Gofer for structured feature development. Gofer prompts are
available in `.github/prompts/` and `.github/instructions/` for use with GitHub
Copilot Chat.

Key Gofer artifacts are stored in `.specify/specs/{feature}/` and include:
research.md, spec.md, plan.md, and tasks.md.

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
- Verify the public static registry explicitly:
  - `curl https://eai-tools.github.io/eai-cli/registry/@eai-tools/cli`
- Preferred user setup is `npm config set @eai-tools:registry https://eai-tools.github.io/eai-cli/registry/ --location=user`
- Install or update the CLI with `npm install -g @eai-tools/cli`
- `eai update` upgrades the installed CLI package only
- `eai gofer refresh --check` previews safe Gofer-managed repo updates
- `eai doctor --check-updates` reports CLI, Gofer, and template drift
- `eai template check` previews vertical-template and UI drift before manual updates
