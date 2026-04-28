---
template: data-model-erd
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# Data Model — Entity Relationship Diagram

<!-- preamble: ≥30 ≤200 words plain-language explanation of entity relationships -->

This diagram describes the data entities involved in this feature and how they
relate to each other. Each entity (box) represents a logical group of data
fields the system stores or processes. Lines between entities show relationships
such as ownership, association, and cardinality. Use this diagram to understand
the persistence model and to identify cross-entity invariants the implementation
must preserve. Reading this diagram requires no specialized expertise; it
summarizes the same information that lives in the data-model.md file but at a
glance. The implementing developer should be able to derive table-per-entity or
document-per-entity layouts from this view, and should not need to chase the
technical plan to learn what data shapes are required.

## Entities

```mermaid
erDiagram
    {{ENTITY_1}} ||--o{ {{ENTITY_2}} : "{{RELATIONSHIP_1}}"
    {{ENTITY_1}} {
        string id PK
        string {{FIELD_1}}
    }
    {{ENTITY_2}} {
        string id PK
        string {{FK_TO_ENTITY_1}} FK
        string {{FIELD_2}}
    }
```

## Notes

{{NOTES}}
