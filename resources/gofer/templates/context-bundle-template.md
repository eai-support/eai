---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
audience: downstream-agents
workflowProfile: enterpriseai
---

# Context Bundle: {{feature-name}}

## Compact Summary

{{one-paragraph-business-and-platform-context}}

## Selected Scenario

| Item                  | Detail                            |
| --------------------- | --------------------------------- |
| Business outcome      | {{outcome}}                       |
| Primary users         | {{users}}                         |
| Value metric          | {{metric}}                        |
| EnterpriseAI vertical | {{vertical-app}}                  |
| App classification    | {{app-or-non-app-with-rationale}} |
| Pipeline mode         | {{shared-stages-app-or-non-app}}  |

## AI-Augmented Journey Summary

For application delivery, keep the customer/business process to four steps or
fewer by using generative AI to combine, prefill, guide, validate, or automate
unnecessary manual work. For non-app work, record "Not applicable" with the
rationale.

| Step | Business Goal | AI Assistance | Context Used | Completion Signal |
| ---- | ------------- | ------------- | ------------ | ----------------- |
| 1    | {{goal}}      | {{assist}}    | {{context}}  | {{signal}}        |
| 2    | {{goal}}      | {{assist}}    | {{context}}  | {{signal}}        |
| 3    | {{goal}}      | {{assist}}    | {{context}}  | {{signal}}        |
| 4    | {{goal}}      | {{assist}}    | {{context}}  | {{signal}}        |

## Carry-Forward Context

| Source                     | Why It Matters                   | Keep / Skip |
| -------------------------- | -------------------------------- | ----------- |
| `discovery.md`             | {{business-context}}             | Keep        |
| `journeys/base-journey.md` | {{ai-augmented-process-context}} | Keep / N/A  |
| `ui-preview-brief.md`      | {{preview-scope-and-branding}}   | Keep / N/A  |
| `ui-approval.md`           | {{approved-ui-gate}}             | Keep / N/A  |
| `service-fit-matrix.md`    | {{capability-selection}}         | Keep / N/A  |
| `research.md`              | {{implementation-context}}       | Keep        |
| `reuse-scan.md`            | {{reuse-evidence}}               | Keep        |
| `contract-pack.md`         | {{delivery-contracts}}           | Keep        |

## EnterpriseAI Platform Context

| Area                | Decision / Assumption  | Evidence              |
| ------------------- | ---------------------- | --------------------- |
| Object types        | {{object-types}}       | {{path-or-reference}} |
| Tenant boundaries   | {{tenant-boundaries}}  | {{path-or-reference}} |
| APIs/events         | {{api-event-surfaces}} | {{path-or-reference}} |
| Deployment target   | {{target-env}}         | {{path-or-reference}} |
| Validation criteria | {{criteria}}           | {{path-or-reference}} |

## Next Agent Instructions

- Use this bundle before opening large source files.
- Preserve the user vocabulary from discovery and research.
- Do not create new platform concepts until `reuse-scan.md` has evidence.
