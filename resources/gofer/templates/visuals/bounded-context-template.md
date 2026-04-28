---
template: bounded-context-template
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# Bounded Context Map — {{FEATURE_NAME}}

<!-- preamble: ≥30 ≤200 words plain-language explanation of bounded contexts and integrations -->

This bounded-context map shows the logical domain partitions inside the system
and the named integration patterns between them. Each subgraph represents a
single bounded context: a region of the model with consistent language,
ownership, and responsibility. The arrows between contexts are not arbitrary
calls; they describe the relationship type, such as anti-corruption layer,
shared kernel, customer-supplier, or open-host service. Use this view to align
team boundaries with code boundaries and to spot integration patterns that might
leak domain concepts across contexts. Reading this diagram complements the C4
Container view by adding domain-driven design semantics on top of deployable
units, which is what reviewers and new joiners need to reason about
responsibility ownership.

## Diagram

```mermaid
flowchart TB
    subgraph BC1[{{CONTEXT_1}}]
        E1[{{ENTITY_1}}]
    end
    subgraph BC2[{{CONTEXT_2}}]
        E2[{{ENTITY_2}}]
    end
    subgraph BC3[{{CONTEXT_3}}]
        E3[{{ENTITY_3}}]
    end
    BC1 -->|{{INTEGRATION_TYPE_1}}| BC2
    BC2 -->|{{INTEGRATION_TYPE_2}}| BC3
```

## Integration Patterns

{{PATTERNS}}

## Notes

{{NOTES}}
