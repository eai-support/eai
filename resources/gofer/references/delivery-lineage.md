# Customer Delivery Lineage

Every active feature maintains `.specify/specs/{feature}/delivery-lineage.json`
using schema `eai.delivery_lineage.v1`. The manifest is the machine-readable
graph consumed by the documentation viewer; Markdown remains the human-readable
evidence.

Gofer operates in the customer trust plane. The graph must use `plane: customer`
and may contain only `customer` and `public-contract` visibility. Never give the
viewer a larger internal graph and rely on the UI to hide nodes.

## PublicAPI Boundary

EAI dependencies terminate at a published capability node:

- kind: `public-api-capability`
- visibility: `public-contract`
- capability ID: `eai.publicapi.capability.{name}.v{major}`
- source repository: `PublicAPI`
- source path and commit: from the published capability contract

Do not name or reference services, repositories, policies, infrastructure, or
documentation behind PublicAPI. Customer projections must reject AdminAPI,
ResourceAPI, Configurator, Authz, AzureAPI, AICore, GeoService, Infra2025,
`eai-testing-dev`, `tech-docs`, personal absolute paths, and repositories not on
the explicit export allowlist.

## Stage Updates

| Stage            | Required lineage update                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Start / Research | Customer need, research artifacts, owners, public capabilities, and evidence links                            |
| Specify          | Requirements, acceptance outcomes, and the research evidence that supports or constrains them                 |
| Plan             | Customer architecture, explicit decisions, concise rationale summaries, approvers, and PublicAPI dependencies |
| Tasks            | Work-order nodes and links from requirements and decisions                                                    |
| Implement        | Actual customer code, documentation, and test files changed                                                   |
| Validate         | Planned-versus-actual reconciliation, test/outcome links, and honest current/suspect/broken/superseded status |

Each source location must use a repository-relative path and should include an
exact Markdown anchor, Git commit, and SHA-256 content hash when known. Record
the decision, considered options, concise rationale, evidence, owner, and
approval; never record hidden chain-of-thought.

Use `.specify/templates/delivery-lineage-template.json` when the feature does
not have a manifest. Preserve existing IDs and history when updating it. The
headless `validateDeliveryLineage`, `projectCustomerDeliveryLineage`, and
`serializeDeliveryLineage` contracts are authoritative for integrity,
fail-closed customer projection, and deterministic output.
