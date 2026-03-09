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
