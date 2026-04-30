---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
---

# EnterpriseAI Contract Pack: {{feature-name}}

## Actors

| Actor     | Role     | Decision / Permission      |
| --------- | -------- | -------------------------- |
| {{actor}} | {{role}} | {{permission-or-decision}} |

## Object Types

| Object Type     | Reuse Decision              | Owner     | Data Notes                           |
| --------------- | --------------------------- | --------- | ------------------------------------ |
| {{object-type}} | Reuse / Extend / Create New | {{owner}} | {{classification-lineage-retention}} |

## Workflows And Journeys

| Flow Type              | Name        | Trigger     | Outcome     |
| ---------------------- | ----------- | ----------- | ----------- |
| User journey           | {{journey}} | {{trigger}} | {{outcome}} |
| Internal orchestration | {{flow}}    | {{trigger}} | {{outcome}} |

## AI Assistance Contract

For app delivery, the user-facing process should be four steps or fewer. If the
feature is non-app work, mark this section "Not applicable" and link to the
classification rationale in `discovery.md`.

| Step | Business Goal | AI Mode                             | Context Used     | User Control             | Completion Signal |
| ---- | ------------- | ----------------------------------- | ---------------- | ------------------------ | ----------------- |
| 1    | {{goal}}      | {{chat-prefill-validate-translate}} | {{data-context}} | {{review-edit-escalate}} | {{signal}}        |
| 2    | {{goal}}      | {{chat-prefill-validate-translate}} | {{data-context}} | {{review-edit-escalate}} | {{signal}}        |
| 3    | {{goal}}      | {{chat-prefill-validate-translate}} | {{data-context}} | {{review-edit-escalate}} | {{signal}}        |
| 4    | {{goal}}      | {{chat-prefill-validate-translate}} | {{data-context}} | {{review-edit-escalate}} | {{signal}}        |

## Permissions And Tenant Boundaries

| Boundary     | Rule     | Evidence              |
| ------------ | -------- | --------------------- |
| {{boundary}} | {{rule}} | {{path-or-reference}} |

## APIs And Events

| Surface          | Contract          | Tests         |
| ---------------- | ----------------- | ------------- |
| {{api-or-event}} | {{contract-path}} | {{test-path}} |

## Deployment And Runtime

| Area          | Assumption                  | Validation |
| ------------- | --------------------------- | ---------- |
| Environment   | {{target}}                  | {{check}}  |
| Observability | {{logging-metrics-tracing}} | {{check}}  |
| Rollback      | {{rollback-path}}           | {{check}}  |

## Acceptance Tests

| Perspective  | Test     | Owner     |
| ------------ | -------- | --------- |
| Business     | {{test}} | {{owner}} |
| Security     | {{test}} | {{owner}} |
| Data         | {{test}} | {{owner}} |
| Architecture | {{test}} | {{owner}} |
| Operations   | {{test}} | {{owner}} |
