# Documentation Gap Analysis for CLI Help Enhancement — RESOLVED

> **Status (2026-06-01): Resolved.** The gaps below were closed during the
> v4 API-reference refresh. This file is retained as a short record; the
> original "missing docs" task list is no longer accurate and has been removed.

## What was wrong

This analysis was written against an **Astro Starlight** layout
(`docs/src/content/docs/reference/...`, per-command `*.mdx` pages,
`global-options.mdx`, `error-codes.mdx`). That layout does **not** exist in this
repo. The docs site is **Docusaurus** and sources flat Markdown from
[`.tech-docs/`](.tech-docs/) — see [`docs-site/docusaurus.config.js`](docs-site/docusaurus.config.js)
(`docs.path: '../.tech-docs'`). There are no per-command pages; the command
reference is a single page, [`.tech-docs/api-reference.md`](.tech-docs/api-reference.md).

## How each gap was closed

| Original gap | Resolution |
|--------------|------------|
| Global options (`--describe`, `--simple`, `--no-color`, `--color`, `--profile`) not documented | Documented in the **Global Flags** section of `.tech-docs/api-reference.md` |
| Structured error codes (E001–E305) not documented | Documented in full (codes, messages, suggestions, JSON envelope) in the **Error Codes** section of `.tech-docs/api-reference.md` |
| `--format json` machine-readable output not documented | Covered by the **Machine-Readable Output** section of `.tech-docs/api-reference.md` |
| Per-command `*.mdx` pages need global-options links | Not applicable — single-page reference, no per-command pages in this layout |

## Anti-drift guard (implemented)

`.tech-docs/api-reference.md` carries `generated: true` frontmatter but is **not
produced by any committed generator** — [`scripts/generate-release-docs.cjs`](scripts/generate-release-docs.cjs)
only bundles `.tech-docs/*` into `llms*.txt`/`cli-help.txt`, and
[`scripts/update-release-doc-metadata.cjs`](scripts/update-release-doc-metadata.cjs)
only re-stamps overview/changelog/architecture/dependencies. That is why the
reference silently drifted from `/v3/*` to `/v4/*` across a PublicAPI migration.

The fix is a **route-drift verifier**, not a full-document generator: the docs
are hand-curated (per-command "what it does", behavior notes, error tables) and
regenerating them from `--describe` would discard that prose. The recurrence
risk was specifically *route* drift, so [`scripts/verify-api-reference.cjs`](scripts/verify-api-reference.cjs)
extracts the authoritative API version + domain prefixes from the
`PlatformAPIClient` route constants in `src/lib/api.ts` and fails if any
`.tech-docs/*` reference uses a version or domain the code no longer exposes.

- `npm run docs:verify-api` — local check (`--check`)
- `node scripts/verify-api-reference.cjs` — check + summary
- `node scripts/verify-api-reference.cjs --print-endpoints` — list current routes

Wired into [`ci.yml`](.github/workflows/ci.yml) (every PR/push), the release gate
in [`release.yml`](.github/workflows/release.yml), and
[`scripts/release-preflight.sh`](scripts/release-preflight.sh) (`npm run release:check`).
