# Public Platform Reference Pack

This folder contains public-safe fallback references for eai-gofer workflows
that need platform, template, service-selection, or deployment guidance while
offline.

These files are intentionally generic and public-safe. Private repositories can
replace or extend them with organization-specific references, but private
platform internals must not be copied into public templates or generated app
guidance.

## References

- `eai.md`: CLI command guidance.
- `eai-app-template.md`: canonical app template guidance.
- `eai-config-driven-ui.md`: config-driven UI, component registry, store
  binding, and override guidance.
- `eai-service-patterns.md`: service-selection matrix for resources, storage,
  documents, search, chat, and PublicAPI.
- `deployment-repo.md`: deployment readiness guidance.
