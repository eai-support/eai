---
generated: true
generated_at: "2026-05-10T11:17:59.756Z"
source_commit: "f628173b70d1400907cfb654ebabeacf95eb8117"
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

## Documentation Workflows

| Workflow | Triggers | Purpose |
|---|---|---|
| `.github/workflows/docs.yml` | push, manual | Repo-local docs publishing or pages deployment |

## Consolidation Status

- Repo: `eai-cli`
- Canonical nightly-generated surface: `.tech-docs/`
- Additional surfaces detected: 1
- Additional docs workflows detected: 1
