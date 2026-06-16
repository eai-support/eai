---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
status: draft
---

# Service Fit Matrix: {{feature-name}}

## Package And Coupling Fit

| Field                   | Decision                                                             | Evidence   |
| ----------------------- | -------------------------------------------------------------------- | ---------- |
| Profile choice          | External / Internal / Hybrid                                         | {{source}} |
| Package lane            | {{public-package-internal-app-hybrid-adapter-app-local}}             | {{source}} |
| Coupling status         | {{source-platform-coupled-source-platform-decoupled-hybrid-adapter}} | {{source}} |
| Public-readiness target | {{required-deferred-not-applicable}}                                 | {{source}} |

## App Stack Policy

| Stack Layer        | Decision                                                          | Evidence   |
| ------------------ | ----------------------------------------------------------------- | ---------- |
| Primary substrate  | EAI Platform, including EAI app template                          | {{source}} |
| Cloud/support      | Azure or EAI-compatible Azure service                             | {{source}} |
| Non-EAI technology | Not used / integration / migration reference / approved exception | {{source}} |

| Capability  | User Need | Evidence Source    | Status                                 | Selected Direction | Notes     |
| ----------- | --------- | ------------------ | -------------------------------------- | ------------------ | --------- |
| {{service}} | {{need}}  | {{command-or-doc}} | Accessible / Purchasable / Unavailable | {{decision}}       | {{notes}} |
