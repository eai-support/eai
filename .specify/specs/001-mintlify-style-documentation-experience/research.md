# Research Summary

## Existing delivery model

- Docusaurus builds from `.tech-docs`.
- Release generators create `llms.txt`, `llms-full.txt`, CLI help, and error guidance.
- GitHub Actions deploys the same output to GitHub Pages and opens a website-copy PR.

## Design decision

Keep Docusaurus because it preserves the owned source, release alignment, and static deployment model.

## Capability comparison

| Capability | This feature | Mintlify managed service |
| --- | --- | --- |
| Task-led landing page | Yes | Yes |
| Responsive documentation design | Yes | Yes |
| Keyword search | Local generated index | Managed semantic search options |
| Documentation assistant | Source-linked static helper | Model-backed assistant option |
| API exploration | Safe command builder | Hosted interactive API tooling option |
| Feedback | Configurable outbound URL | Managed analytics and feedback options |
| Agent-readable documentation | `llms.txt`, full bundle, JSON guidance | Managed MCP and agent tooling options |
| Git and release alignment | Existing first-party workflow | Managed Git integration |

## Decision boundary

The remaining material gaps need a backend, an external service, or both. They are not represented as complete in the rubric.
