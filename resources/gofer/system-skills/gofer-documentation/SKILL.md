---
name: gofer-documentation
description:
  'Write or update customer-facing delivery documentation and generate its
  PublicAPI-capped lineage diagram. Use for Markdown, requirements,
  architecture, decisions, plans, validation evidence, or documentation graphs
  in a Gofer workspace.'
---

# Gofer Documentation And Lineage

Use this skill whenever an agent creates or changes delivery documentation in a
Gofer workspace. The durable outputs are human-readable Markdown plus
`.specify/specs/{feature}/delivery-lineage.json`.

## Trust Boundary

Gofer is customer-side. Read `.specify/references/delivery-lineage.md` before
writing and enforce all of its export rules.

- Use `plane: customer`.
- Stop EAI dependencies at a `public-api-capability` node from `PublicAPI`.
- Never name or link internal EAI services, repositories, policies,
  infrastructure, `tech-docs`, or personal absolute paths.
- Do not create an internal graph and rely on a viewer filter. The persisted
  graph itself must be safe for the customer.
- Record concise rationale and evidence, never hidden chain-of-thought.

## Write The Markdown

1. Preserve the repository's existing documentation conventions. For a new
   durable document, use frontmatter with a stable `doc_id`, `title`, `status`,
   `owners`, and `updated` date.
2. Keep the stable `doc_id` when the title or path changes. Mark replaced
   documents `superseded` and link their replacement.
3. Use descriptive headings so graph sources can point to exact anchors.
4. Separate requirements, decisions, considered options, concise rationale,
   acceptance evidence, and outcomes. Do not present a plan as delivered fact.
5. Use repository-relative links and paths. Include a Git commit and SHA-256
   content hash in lineage sources when known.

## Record The Selected Decision

Use one explicit heading for each material outcome so the viewer can separate
the accepted path from alternatives:

- `## Selected Approach`, `## Approved Direction`, `## Chosen Option`, or
  `## Architecture Decision` for an accepted choice;
- `## Rejected Alternative` or `## Declined Option` for an option not taken;
- `## Superseded Decision` when a later choice replaced it.

State the decision itself in the first paragraph below the heading. Keep the
concise rationale and consequences below it. The viewer records the heading as
an anchored decision node, shows the latest current accepted decision as the
**Final selected decision**, and highlights the current customer delivery path
while fading rejected, superseded, or unhealthy evidence.

## Update The Graph

1. Resolve the active feature under `.specify/specs/`.
2. Create `delivery-lineage.json` from
   `.specify/templates/delivery-lineage-template.json` if it is missing.
3. Preserve node and edge IDs. Add or update nodes for the changed documents,
   requirements, decisions, work orders, code, tests, outcomes, and published
   PublicAPI capabilities.
4. Link evidence with the narrowest accurate relation. Mark stale or unresolved
   sources `suspect`, `anchor-lost`, `broken`, or `superseded`; do not silently
   drop them.
5. Run the repository lineage tests before declaring the graph valid.

## Generate Or Show The Diagram

Run:

```bash
node .specify/scripts/node/render-delivery-lineage.mjs \
  --input .specify/specs/{feature}/delivery-lineage.json
```

This writes `delivery-lineage.md` beside the manifest with a portable Mermaid
graph. When the Gofer VS Code extension is active, run **Gofer: Show Delivery
Lineage** (`gofer.showDeliveryLineage`) for the interactive graph. In a
terminal-only host, show the Mermaid block in chat when supported and always
return links to both generated files.

## Completion Check

- Markdown claims have exact source anchors.
- The persisted graph contains no private EAI visibility.
- All edges resolve to existing nodes.
- The diagram was regenerated after the final graph change.
- The final selected decision and selected delivery path are visible.
- The summary names documentation changed and evidence still non-current.
