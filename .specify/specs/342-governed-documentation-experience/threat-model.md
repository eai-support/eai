# Threat Model

| Risk | Control | Evidence |
| --- | --- | --- |
| Prompt abuse or traffic flood | Per-IP and per-session rate limit; bounded request size | Integration test |
| Private corpus leakage | Approved-source allowlist and citation validation | Negative retrieval test |
| Feedback identification | Explicit consent; hashed session; no raw text by default | Schema and retention test |
| MCP overreach | Read-only public tools; deny-by-default allowlist | Tool enumeration test |
