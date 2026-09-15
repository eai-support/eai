---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
---

# Reuse-Before-Create Scan: {{feature-name}}

## Scan Scope

| Asset Type                     | Search Performed                  | Result     |
| ------------------------------ | --------------------------------- | ---------- |
| Existing specs                 | {{paths-or-query}}                | {{result}} |
| Object types                   | {{paths-or-query}}                | {{result}} |
| APIs/events                    | {{paths-or-query}}                | {{result}} |
| Workflows/journeys             | {{paths-or-query}}                | {{result}} |
| Modules/components             | {{paths-or-query}}                | {{result}} |
| UI blocks/packages             | {{eai-blocks-or-storybook-query}} | {{result}} |
| Theme override points          | {{tokens-slots-css-vars-query}}   | {{result}} |
| source-platform coupling paths | {{imports-or-runtime-query}}      | {{result}} |
| EnterpriseAI references        | {{paths-or-query}}                | {{result}} |

## Decisions

| Candidate     | Evidence              | Decision                    | Rationale | Owner     |
| ------------- | --------------------- | --------------------------- | --------- | --------- |
| {{candidate}} | {{path-or-reference}} | Reuse / Extend / Create New | {{why}}   | {{owner}} |

## Block Porting And Package Profile Decisions

| Candidate Block | Package Lane | Storybook Story ID | Coupling Status     | Decision                        | Public-Readiness Impact |
| --------------- | ------------ | ------------------ | ------------------- | ------------------------------- | ----------------------- |
| {{block-id}}    | {{lane}}     | {{story-id-or-na}} | {{coupling-status}} | Reuse / Port / Custom Exception | {{impact-or-na}}        |

## Create-New Exceptions

Every create-new decision must include:

- Why reuse and extension are insufficient.
- Architecture owner approval.
- Data/security owner approval when object types, APIs/events, tenant
  boundaries, or sensitive data are affected.
- Acceptance tests proving the new contract is required and working.
