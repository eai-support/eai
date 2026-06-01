---
template: erd
version: 1.0
---

# Entity Relationship Diagram: {{FEATURE_NAME}}

```mermaid
erDiagram
    {{ENTITY_1}} ||--o{ {{ENTITY_2}} : has
    {{ENTITY_1}} {
        string id
        string {{FIELD_1}}
    }
    {{ENTITY_2}} {
        string id
        string {{FIELD_2}}
    }
```
