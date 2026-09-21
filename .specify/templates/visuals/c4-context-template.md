---
template: c4-context
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# C4 Context — {{FEATURE_NAME}}

<!-- preamble: ≥30 ≤200 words plain-language explanation of system context -->

This C4 Context diagram shows the system boundary and the external actors and
systems it interacts with. The single central box represents the system being
built; surrounding entities are people who use it (Person) or external services
it integrates with (System_Ext). Arrows show direction of interaction and label
the high-level purpose of each integration. This is the highest-level
architectural view: it tells you who needs the system, what it depends on, and
what it depends on having available. Reading this diagram is sufficient to
understand integration scope without needing to read the implementation plan.
Use it as a checklist when planning integration work, security reviews, or
onboarding documentation: every external dependency must show up here, and every
persona who interacts with the system must be represented as a Person box.

## Diagram

```mermaid
C4Context
    title System Context for {{FEATURE_NAME}}

    Person({{PRIMARY_PERSONA}}, "{{PERSONA_DESCRIPTION}}")
    Person({{SECONDARY_PERSONA}}, "{{SECONDARY_PERSONA_DESCRIPTION}}")

    System({{SYSTEM_NAME}}, "{{SYSTEM_DESCRIPTION}}")

    System_Ext({{EXT_SYSTEM_1}}, "{{EXT_DESCRIPTION_1}}")
    System_Ext({{EXT_SYSTEM_2}}, "{{EXT_DESCRIPTION_2}}")

    Rel({{PRIMARY_PERSONA}}, {{SYSTEM_NAME}}, "{{PRIMARY_REL}}")
    Rel({{SECONDARY_PERSONA}}, {{SYSTEM_NAME}}, "{{SECONDARY_REL}}")
    Rel({{SYSTEM_NAME}}, {{EXT_SYSTEM_1}}, "{{EXT_REL_1}}")
    Rel({{SYSTEM_NAME}}, {{EXT_SYSTEM_2}}, "{{EXT_REL_2}}")
```

## Notes

{{NOTES}}
