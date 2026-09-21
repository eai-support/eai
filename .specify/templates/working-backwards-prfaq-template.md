---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
updated: '{{ISO-timestamp}}'
status: draft
stage: '{{gofer-stage}}'
primary_customer: '{{primary-customer-or-persona}}'
business_owner: '{{business-owner}}'
source_inputs:
  - problem-brief.md
  - discovery.md
  - research.md
  - spec.md
  - plan.md
  - tasks.md
  - validation-report.md
  - .specify/memory/brand-profile.json
---

# Working Backwards PR/FAQ: {{feature-name}}

This is the running product release PR/FAQ for the feature. It starts as a
launch-day fiction and becomes evidence-backed as Gofer moves through research,
specification, planning, implementation, and validation.

## Branding And Presentation

Use `.specify/memory/brand-profile.json` for approved organization name,
prepared-by line, header/footer text, confidentiality label, and presentation
style. Keep the PR/FAQ plain-language and evidence-backed; branding must never
hide uncertainty or change scope.

## Press Release

### Headline

{{customer-outcome-headline}}

### Subheadline

{{one-sentence-who-benefits-and-what-changes}}

### Dateline

{{future-launch-date-and-location-or-planning-fiction}}

### Customer Problem

{{plain-language-pain-frequency-cost-risk-or-missed-opportunity}}

### The Launch

{{what-is-now-available-and-how-the-customer-experiences-it}}

### Customer Benefit

{{before-after-outcome-measurable-improvement-and-business-value}}

### Customer Quote

> "{{target-user-quote-about-value}}"

### Company Quote

> "{{business-or-product-owner-quote-about-why-this-matters-now}}"

### How To Get Started

{{first-user-action-matching-the-product-journey}}

## External FAQ

### Who is this for?

{{target-customer-and-user-personas}}

### What problem does it solve?

{{business-problem-and-user-pain}}

### What changes in the user's process?

{{process-change-and-user-journey-summary}}

### What does the user need to do?

{{new-actions-or-approvals-required}}

### What is not included?

{{scope-exclusions-and-deferred-capabilities}}

### How will success be measured?

{{success-metrics-baseline-target-review-cadence}}

### What happens if something goes wrong?

{{fallback-support-rollback-or-escalation-path}}

## Internal FAQ

### Business Owner

- **Business scenario**: {{scenario}}
- **Process changes**: {{process-changes}}
- **Business case**: {{value-cost-risk-and-ROI-summary}}
- **Assumptions needing review**: {{assumptions}}

### CTO / Architecture

- **Architecture direction**: {{architecture-summary}}
- **EAI Platform fit**: {{eai-platform-components-and-template-use}}
- **Azure fit**: {{azure-services-and-why}}
- **Auth, tenancy, data, integration**: {{auth-tenant-data-contract-summary}}

### CISO / Risk

- **Data handled**: {{data-classification-and-sensitive-data}}
- **Identity and access controls**: {{authn-authz-tenant-controls}}
- **Residual risks**: {{residual-risk-and-open-security-questions}}
- **Evidence**: {{security-validation-evidence-links}}

### Delivery / Operations

- **Build plan**: {{delivery-sequence}}
- **Dependencies**: {{dependencies-and-blockers}}
- **Launch gates**: {{quality-security-release-gates}}
- **Rollback and support**: {{rollback-support-and-observability}}

## Evidence Links

| Evidence                 | Path                          | Status                       |
| ------------------------ | ----------------------------- | ---------------------------- |
| Business brief           | `problem-brief.md`            | {{draft-or-validated-or-na}} |
| Discovery                | `discovery.md`                | {{draft-or-validated-or-na}} |
| Research                 | `research.md`                 | {{draft-or-validated-or-na}} |
| Specification            | `spec.md`                     | {{draft-or-validated-or-na}} |
| Architecture plan        | `plan.md`                     | {{draft-or-validated-or-na}} |
| Contracts                | `contract-pack.md`            | {{draft-or-validated-or-na}} |
| Business owner summary   | `business-owner-summary.md`   | {{draft-or-validated-or-na}} |
| CTO architecture summary | `cto-architecture-summary.md` | {{draft-or-validated-or-na}} |
| CISO security summary    | `ciso-security-summary.md`    | {{draft-or-validated-or-na}} |
| Validation               | `validation-report.md`        | {{pending-or-pass-or-fail}}  |

## Stage Change Log

| Stage                | What changed in this PR/FAQ               | Evidence | Review ask |
| -------------------- | ----------------------------------------- | -------- | ---------- |
| `/0_gofer_start`     | {{initial-problem-and-launch-promise}}    | {{path}} | {{ask}}    |
| `/1_gofer_research`  | {{research-learning-and-options}}         | {{path}} | {{ask}}    |
| `/2_gofer_specify`   | {{product-behavior-and-scope}}            | {{path}} | {{ask}}    |
| `/3_gofer_plan`      | {{architecture-and-platform-summary}}     | {{path}} | {{ask}}    |
| `/4_gofer_tasks`     | {{delivery-sequence-and-risk}}            | {{path}} | {{ask}}    |
| `/5_gofer_implement` | {{implemented-behavior-and-deltas}}       | {{path}} | {{ask}}    |
| `/6_gofer_validate`  | {{validation-security-release-readiness}} | {{path}} | {{ask}}    |

## Review Ask

| Reviewer           | Decision needed                                                     | Status                   | Notes     |
| ------------------ | ------------------------------------------------------------------- | ------------------------ | --------- |
| Business Owner     | Approve business scenario, value case, process, success measures    | {{approve-revise-defer}} | {{notes}} |
| CTO / Architecture | Approve EAI Platform/Azure architecture, auth, tenancy, integration | {{approve-revise-defer}} | {{notes}} |
| CISO / Risk        | Approve security posture, controls, residual risk, launch gates     | {{approve-revise-defer}} | {{notes}} |
| Delivery           | Approve delivery plan, dependencies, rollout, support path          | {{approve-revise-defer}} | {{notes}} |
