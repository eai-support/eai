---
template: bounded-context-map
version: 1.0
---

# Bounded Context Map: {{FEATURE_NAME}}

```mermaid
flowchart TB
    subgraph BC1[{{CONTEXT_1}}]
        E1[{{ENTITY_1}}]
    end
    subgraph BC2[{{CONTEXT_2}}]
        E2[{{ENTITY_2}}]
    end
    BC1 -->|{{INTEGRATION_TYPE}}| BC2
```

**Integration Patterns**: {{PATTERNS}}
