---
generated: true
generated_at: "2026-09-21T22:03:01.864Z"
source_commit: "8bc76a23ee69066b54726e8040fa51cadde58e6b"
---
# Patterns and Technical Debt

## Identified Patterns

| Pattern | File reference | Use |
|---|---|---|
| Command composition | `src/index.ts`, `src/commands/*.ts` | Separates CLI surface from reusable libraries |
| Facade/client wrapper | `src/lib/api.ts` | Presents typed platform operations over authenticated HTTP |
| Profile-scoped state | `src/lib/profile.ts`, `src/lib/auth.ts` | Keeps default and named environments isolated |
| Contract validation | `src/lib/config.ts`, `runtime-contract.ts`, `object-type-identifiers.ts` | Rejects invalid identifiers and deployment metadata before writes |
| Fail-closed allow-list | `src/lib/api.ts` | Restricts arbitrary public API calls to approved v4 domains |
| Adapter-style output | `src/lib/output.ts` and command format options | Supports human-readable and machine-readable automation |

## Anti-patterns and Debt

| Item | Severity | Location | Recommendation |
|---|---|---|---|
| Large multi-domain API client | Medium | `src/lib/api.ts` | Extract domain clients behind a shared transport |
| Local encrypted token store is not an OS keychain | Medium | `src/lib/auth.ts` | Adopt a platform keychain where available, with an explicit fallback |
| Public docs and generated release assets require synchronized checks | Low | `scripts/`, `.github/workflows/` | Keep checks mandatory and document ownership of generated artifacts |
| No repository-local database contract | Informational | Repository-wide | Continue treating platform schemas as external; link versioned public contracts when available |

## Spec Alignment

`.specify/` contains reusable Gofer scripts, templates, and references but no
active `.specify/specs/` feature directory in this checkout. Feature-level
requirements and implementation alignment are therefore not determined from
codebase.
