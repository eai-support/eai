# Threat Model

| Risk | Control | Evidence |
| --- | --- | --- |
| Prompt abuse or traffic flood | Per-IP and per-session rate limit; bounded request size | Integration test |
| Private corpus leakage | Approved-source allowlist and citation validation | Negative retrieval test |
| Browser token exposure | Server-side broker only; short-lived Test scope | Static scan and scope test |
| Feedback identification | Explicit consent; hashed session; no raw text by default | Schema and retention test |
| MCP overreach | Read-only public tools; deny-by-default allowlist | Tool enumeration test |
| Preview data exposure | Isolated preview environment and public corpus only | Workflow receipt |
