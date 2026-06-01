# Lessons

- Authentication assumptions must be verified against the current implementation and security posture; do not describe or analyze `eai login` as device flow when the CLI uses browser-based authorization code flow with PKCE.
- Public CLI errors must not expose implementation details behind the platform API. Do not print backend route names, service names, raw response bodies, tenant identifiers, stack errors, or internal exception text; map failures to product-safe guidance and stable support references.
