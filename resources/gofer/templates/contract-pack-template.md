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

## UI Preview And Approval

For app delivery, capture the preview-first gate here. For non-app work, mark
this section "Not applicable" and link to the classification rationale in
`discovery.md`.

| Artifact | Purpose | Required For Completion |
| -------- | ------- | ----------------------- |
| `ui-preview-brief.md` | {{preview-brief-purpose}} | {{yes-or-na}} |
| `ui-review-log.md` | {{preview-iteration-evidence}} | {{yes-or-na}} |
| `ui-approval.md` | {{explicit-approval-gate}} | {{yes-or-na}} |

## AI-Readable Blocks Bridge Contract

| Field | Decision | Evidence |
| ----- | -------- | -------- |
| Profile choice | External / Internal / Hybrid | {{source}} |
| Package lane | {{public-package-internal-app-hybrid-adapter-app-local}} | {{source}} |
| Coupling status | {{daisy-coupled-daisy-decoupled-hybrid-adapter}} | {{source}} |
| Storybook story IDs | {{story-ids-or-exceptions}} | {{source}} |
| Theme override points | {{tokens-slots-css-vars}} | {{source}} |
| Custom-block exceptions | {{none-or-approval-path}} | {{source}} |
| Public-readiness target | {{required-deferred-not-applicable}} | {{source}} |
| Block porting / DAISY decoupling | {{reuse-port-adapter-exception}} | {{source}} |

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

## EnterpriseAI Service Fit

For app delivery, record how the approved UI maps to platform capabilities. For
non-app work, mark this section "Not applicable".

| Capability | Evidence Source | Status | Selected Direction |
| ---------- | --------------- | ------ | ------------------ |
| {{service}} | {{path-or-command}} | Accessible / Purchasable / Unavailable | {{decision}} |

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
