# Plan: 011 - Install Gofer

Date: 2026-04-13

## Architecture

- Add a Gofer installer library responsible for resource discovery, copying, generated skill content, generated setup docs, and idempotent file updates.
- Wire the installer into `eai init` after the existing template customization and `CLAUDE.md` generation steps.
- Keep a `--no-gofer` option to preserve the previous bare scaffold behavior.
- Vendor Gofer resources in the npm package and verify package contents with `npm pack`.
- Extend integration tests to cover default installation and opt-out behavior.
- Update CLI help, README, Starlight docs, and static registry release artifacts.

## Files

- `src/lib/gofer-installer.ts`
- `src/commands/init.ts`
- `src/index.ts`
- `tests/integration/init.test.ts`
- `resources/gofer/**`
- `package.json`
- `package-lock.json`
- `README.md`
- `docs/src/content/docs/getting-started/*.mdx`
- `docs/src/content/docs/reference/commands/init.mdx`
- `docs/public/registry/**`
- `scripts/verify-registry.sh`

## Verification

- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `cd docs && npm run build`
- `node dist/index.js --version`
- `node dist/index.js --help`
- `node dist/index.js init --help`
- `npm pack --dry-run`
- `bash scripts/verify-registry.sh`

