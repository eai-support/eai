---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
status: draft
---

# UI Preview Brief: {{feature-name}}

## Goal

- **Smallest useful MVP to show first**: {{mvp-slice}}
- **Primary users**: {{users}}
- **Workflow goal**: {{workflow-goal}}

## Preview Scope

| Area                                      | Requirement      |
| ----------------------------------------- | ---------------- |
| Must-have screens                         | {{screens}}      |
| Must-have interactions                    | {{interactions}} |
| Explicitly out of scope for first preview | {{out-of-scope}} |

## Package Profile

| Field | Decision |
| ----- | -------- |
| Profile choice | {{external-internal-hybrid}} |
| Package lane | {{public-package-internal-app-hybrid-adapter-app-local}} |
| Coupling status | {{daisy-coupled-daisy-decoupled-hybrid-adapter}} |
| Public-readiness target | {{required-deferred-not-applicable}} |

## Vertical Template Constraints

| Constraint                    | Decision                                          |
| ----------------------------- | ------------------------------------------------- |
| Default layout / blocks       | {{approved-template-blocks}}                      |
| Block catalog evidence        | {{eai-blocks-list-and-describe-evidence}}         |
| Resource bindings             | {{eai-resources-schema-bindings}}                 |
| Storybook story IDs           | {{storybook-story-ids-or-exceptions}}             |
| Theme override points         | {{theme-presentation-copy-data-action-overrides}} |
| Allowed create-new exceptions | {{approved-exceptions-or-none}}                   |
| Accessibility baseline        | {{expectation}}                                   |

## Block Porting And DAISY Decoupling

| Block ID | Package Lane | Storybook Story ID | Coupling Status | Porting Decision | Theme Override Points | Custom-Block Exception |
| -------- | ------------ | ------------------ | --------------- | ---------------- | --------------------- | ---------------------- |
| {{block-id}} | {{lane}} | {{story-id-or-na}} | {{status}} | Reuse / Port / Custom Exception | {{tokens-slots-css-vars}} | {{none-or-approval-path}} |

## Branding Inputs

| Input                | Status              |
| -------------------- | ------------------- |
| Logo / marks         | {{provided-or-not}} |
| Colors / styling     | {{provided-or-not}} |
| Voice / copy tone    | {{provided-or-not}} |
| Corporate references | {{provided-or-not}} |

## Preview Validation Before Presentation

- [ ] Local render proof captured
- [ ] Screenshot or Playwright-style self-review captured
- [ ] Brief-to-preview mismatch list recorded
- [ ] Open visual risks called out before stakeholder review
