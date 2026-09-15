---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
---

# Audit History: {{feature-name}}

## Finding Register

| Finding ID | Source     | Severity            | Status                              | Recurrence | Owner     | Expiry           | Evidence |
| ---------- | ---------- | ------------------- | ----------------------------------- | ---------- | --------- | ---------------- | -------- |
| AUD-001    | {{source}} | Red / Yellow / Gray | Open / Fixed / Accepted / Escalated | {{count}}  | {{owner}} | {{date-or-none}} | {{path}} |

## Accepted Exceptions

| Finding ID     | Decision Owner | Reason     | Compensating Control | Expiry   | Review Cadence |
| -------------- | -------------- | ---------- | -------------------- | -------- | -------------- |
| {{finding-id}} | {{owner}}      | {{reason}} | {{control}}          | {{date}} | {{cadence}}    |

## Recurring Finding Escalation

Recurring red findings must escalate to the persona with decision rights for the
affected area:

| Area                              | Decision Owner          |
| --------------------------------- | ----------------------- |
| Business value or adoption        | Business owner          |
| Architecture or platform fit      | Enterprise architecture |
| Identity, security, residual risk | CISO                    |
| Data model, lineage, quality      | Data architecture       |
| Delivery readiness                | Internal delivery       |
| Operating model                   | CIO / COO               |
| Financial risk or value tracking  | CFO                     |
| Policy exception                  | Risk/compliance         |
