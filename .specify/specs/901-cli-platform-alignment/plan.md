# Plan: CLI Platform Alignment

## Tech Stack

- TypeScript CLI
- Commander.js
- Vitest
- Astro docs

## Design Notes

- Keep transport decisions centralized in `src/lib/api.ts`.
- Keep tenant membership normalization centralized in `src/lib/tenant-context.ts`.
- Let command files stay thin: they should consume normalized membership/user APIs rather than embedding backend-shape assumptions.
- Prefer a single current platform contract:
  - PublicAPI direct routes where available
  - PublicAPI orchestration to AdminAPI where required

## Validation Strategy

- `npm run build`
- `npm run lint`
- `npm test`
- `npm --prefix docs run build`

## Artifact Strategy

- Archive completed historical feature folders.
- Keep this folder as the merged current feature artifact for platform-alignment work.
