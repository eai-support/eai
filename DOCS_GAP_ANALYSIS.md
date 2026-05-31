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

## Anti-drift recommendation (open follow-up)

`.tech-docs/api-reference.md` carries `generated: true` frontmatter but is **not
produced by any committed generator** — [`scripts/generate-release-docs.cjs`](scripts/generate-release-docs.cjs)
only bundles `.tech-docs/*` into `llms*.txt`/`cli-help.txt`, and
[`scripts/update-release-doc-metadata.cjs`](scripts/update-release-doc-metadata.cjs)
only re-stamps overview/changelog/architecture/dependencies. That is why the
reference silently drifted from `/v3/*` to `/v4/*` across a PublicAPI migration.

Recommended fix (not yet implemented): add `scripts/generate-api-reference.cjs`
that renders `.tech-docs/api-reference.md` from `node dist/index.js --describe`
plus the `PlatformAPIClient` route map in `src/lib/api.ts`, and wire it into the
existing `--check` gate in [`.github/workflows/release.yml`](.github/workflows/release.yml)
so a stale reference fails CI. Keep `release.sh`, `release.yml`, and `docs.yml`
in sync per `AGENTS.md`.
