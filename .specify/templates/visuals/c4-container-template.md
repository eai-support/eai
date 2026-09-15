---
template: c4-container-template
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# C4 Container: {{FEATURE_NAME}}

<!-- preamble: ≥30 ≤200 words plain-language explanation of containers and their interactions -->

This C4 Container diagram shows the runnable units that make up the system
implementing this feature. Each container is a separately deployable or
independently runnable process, application, data store, or service. The arrows
describe how containers communicate at runtime and which protocol or message
style they use. Reading this diagram tells a developer where to put new code,
which container owns which responsibility, and which integrations cross a
process boundary. Use this view together with the C4 Context diagram (one level
higher) and the data-model ERD (one level deeper) to keep the architectural
intent consistent across documents and reviews.

```mermaid
C4Container
    title Containers for {{FEATURE_NAME}}

    Person({{PRIMARY_PERSONA}}, "{{PERSONA_DESCRIPTION}}")
    Container_Boundary(c1, "{{SYSTEM_NAME}}") {
        Container({{CONTAINER_1}}, "{{TYPE_1}}", "{{DESCRIPTION_1}}")
        Container({{CONTAINER_2}}, "{{TYPE_2}}", "{{DESCRIPTION_2}}")
    }

    Rel({{PRIMARY_PERSONA}}, {{CONTAINER_1}}, "Uses")
    Rel({{CONTAINER_1}}, {{CONTAINER_2}}, "Calls")
```

## Notes

{{NOTES}}
