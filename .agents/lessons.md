# Lessons

- Authentication assumptions must be verified against the current implementation and security posture; do not describe or analyze `eai login` as device flow when the CLI uses browser-based authorization code flow with PKCE.
- Public CLI errors must not expose implementation details behind the platform API. Do not print backend route names, service names, raw response bodies, tenant identifiers, stack errors, or internal exception text; map failures to product-safe guidance and stable support references.
- Treat `eai-support` as the canonical GitHub owner after the organization rename. Verify repository and GitHub Pages endpoints independently because repository redirects do not guarantee that old Pages URLs remain available.
- A compatibility gate must prove safe negotiation with the deployed receiver. Do not treat a preferred dry-run shape as deployed support. Block any fallback that would re-derive or change a historical stored slug.
- Verify installed AI surfaces with the repository detector before reporting success. Standard macOS application permissions and signed package-manager symlinks are valid inputs when signature and file-binding checks pass.
- Validate every caller-controlled recovery selector with one shared grammar before context, local authority lookup, or network access. A downstream API check is too late for command-level fail-closed behavior.
- Never exempt a symbolic link solely because it is directly below the filesystem root. Enumerate required system aliases, verify each exact target, and bind both alias and target identities for later revalidation.
