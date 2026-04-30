---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
---

# Reuse-Before-Create Scan: {{feature-name}}

## Scan Scope

| Asset Type              | Search Performed   | Result     |
| ----------------------- | ------------------ | ---------- |
| Existing specs          | {{paths-or-query}} | {{result}} |
| Object types            | {{paths-or-query}} | {{result}} |
| APIs/events             | {{paths-or-query}} | {{result}} |
| Workflows/journeys      | {{paths-or-query}} | {{result}} |
| Modules/components      | {{paths-or-query}} | {{result}} |
| EnterpriseAI references | {{paths-or-query}} | {{result}} |

## Decisions

| Candidate     | Evidence              | Decision                    | Rationale | Owner     |
| ------------- | --------------------- | --------------------------- | --------- | --------- |
| {{candidate}} | {{path-or-reference}} | Reuse / Extend / Create New | {{why}}   | {{owner}} |

## Create-New Exceptions

Every create-new decision must include:

- Why reuse and extension are insufficient.
- Architecture owner approval.
- Data/security owner approval when object types, APIs/events, tenant
  boundaries, or sensitive data are affected.
- Acceptance tests proving the new contract is required and working.
