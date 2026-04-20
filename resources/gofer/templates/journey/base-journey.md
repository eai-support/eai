---
id: { { journey-id } }
name: { { journey-name } }
featureId: { { feature-id } }
status: draft
created: { { created-date } }
modified: { { modified-date } }
---

# Customer Journey: {{journey-name}}

## Overview

{{journey-description}}

---

## Actors

| ID  | Name | Type | Role |
| --- | ---- | ---- | ---- |

{{#each actors}} | {{id}} | {{name}} | {{type}} | {{role}} | {{/each}}

### Actor Descriptions

{{#each actors}}

#### {{name}} ({{type}})

{{role}}

{{/each}}

---

## Journey Steps

{{#each steps}}

### Step {{stepNumber}}: {{action}}

**Actor**: {{actorId}}

{{action}}

{{#if outcome}} **Expected Outcome**: {{outcome}} {{/if}}

{{#if notes}} **Notes**: {{notes}} {{/if}}

{{/each}}

---

## Journey Diagram

```mermaid
sequenceDiagram
    {{#each actors}}
    participant {{id}} as {{name}}
    {{/each}}

    {{#each steps}}
    Note over {{actorId}}: Step {{stepNumber}}
    {{actorId}}->>{{actorId}}: {{action}}
    {{/each}}
```

---

## Touchpoints

| ID  | Type | Description | Actors | Steps |
| --- | ---- | ----------- | ------ | ----- |

{{#each touchpoints}} | {{id}} | {{type}} | {{description}} | {{actorIds}} |
{{stepNumbers}} | {{/each}}

---

## Confirmation Status

- [ ] Actors confirmed by stakeholder
- [ ] Steps confirmed by stakeholder
- [ ] Touchpoints identified
- [ ] Journey diagram reviewed

---

## Notes

_Add any additional notes or considerations here._
