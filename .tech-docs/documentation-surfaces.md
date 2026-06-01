---
generated: true
generated_at: "2026-06-01T09:00:09.000Z"
source_commit: "5a2b88a3a98c40d9b88476b34bd8fc66aa2d5037"
---
# Documentation Surfaces

## Standard Source Of Truth

The central nightly `tech-docs` process treats `.tech-docs/` as the canonical generated snapshot for this repository.

| Path | Role | Central nightly aggregation |
|---|---|---|
| `.tech-docs/` | Generated technical snapshot derived from code and repo metadata | Yes |

## Additional Repo-Local Documentation Surfaces

| Path | Role | Central nightly aggregation |
|---|---|---|
| `docs-site/` | Docs-site framework project | No; should be summarized into `.tech-docs/` |
| `docs-site/static/llms.txt` | Release-facing AI documentation index generated from `.tech-docs/` and current CLI help | No; generated in this repo |
| `docs-site/static/llms-full.txt` | Full release-facing AI documentation bundle generated from `.tech-docs/` and current CLI help | No; generated in this repo |
| `docs-site/static/cli-help.txt` | Current CLI help snapshot generated from the built CLI | No; generated in this repo |

## Documentation Workflows

| Workflow | Triggers | Purpose |
|---|---|---|
| `.github/workflows/docs.yml` | push, manual | Repo-local docs publishing or pages deployment |
| `.github/workflows/release.yml` | release dispatch, manual | Registry, release assets, docs/help bundles, and release notifications |

## Consolidation Status

- Repo: `tech-docs`
- Canonical nightly-generated surface: `.tech-docs/`
- Public docs site source: `.tech-docs/`
- Review pages included in docs site: `.tech-docs/review/code-quality.md`, `.tech-docs/review/patterns.md`
- Release-facing AI bundle includes review pages through `scripts/generate-release-docs.cjs`
- Additional surfaces detected: 4
- Additional docs/release workflows detected: 2
