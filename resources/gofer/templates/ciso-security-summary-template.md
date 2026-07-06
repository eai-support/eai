---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
updated: '{{ISO-timestamp}}'
audience: ciso-risk
source_inputs:
  - validation-report.md
  - audit-history.md
  - visuals/risk-heatmap.md
  - plan.md
  - contract-pack.md
  - eai-preflight.md
  - .specify/memory/brand-profile.json
---

# CISO Security Summary: {{feature-name}}

## Executive Summary

{{three-sentence-security-posture-summary}}

## Branding And Presentation

Apply only approved brand profile values. Do not include private screenshots,
tenant identifiers, secret names, customer-confidential diagrams, or unapproved
logos in CISO/Risk materials.

## Security Posture

| Area                     | Control summary                      | Evidence | Status           |
| ------------------------ | ------------------------------------ | -------- | ---------------- |
| Identity                 | {{identity-control}}                 | {{path}} | {{pass-open-na}} |
| Authorization            | {{authorization-control}}            | {{path}} | {{pass-open-na}} |
| Tenant isolation         | {{tenant-control}}                   | {{path}} | {{pass-open-na}} |
| Secrets handling         | {{secret-handling}}                  | {{path}} | {{pass-open-na}} |
| Data handling            | {{data-classification-and-controls}} | {{path}} | {{pass-open-na}} |
| Logging / audit          | {{audit-controls}}                   | {{path}} | {{pass-open-na}} |
| Dependency / CVE posture | {{dependency-posture}}               | {{path}} | {{pass-open-na}} |

## Residual Risks

| Risk     | Severity     | Compensating control | Owner     | Expiry / review |
| -------- | ------------ | -------------------- | --------- | --------------- |
| {{risk}} | {{severity}} | {{control}}          | {{owner}} | {{expiry}}      |

## Validation Evidence

| Evidence            | Path                      | Result                         |
| ------------------- | ------------------------- | ------------------------------ |
| Validation report   | `validation-report.md`    | {{pass-fail-pending}}          |
| Blast radius report | `blast-radius-report.md`  | {{contained-breached-pending}} |
| Audit history       | `audit-history.md`        | {{status}}                     |
| Risk heatmap        | `visuals/risk-heatmap.md` | {{status}}                     |
| Loop audit          | `loop-audit-report.md`    | {{pass-fail-pending}}          |

## Visual Security Evidence

| Visual                                  | Security question answered                                         | Public-safety check            | Freshness             |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------ | --------------------- |
| Risk heatmap: `visuals/risk-heatmap.md` | Which risks matter most and what controls reduce them?             | {{no-private-data-or-finding}} | {{fresh-stale-or-na}} |
| Auth/tenant flow visual, if applicable  | Where are identity, authorization, and tenant boundaries enforced? | {{no-private-data-or-finding}} | {{fresh-stale-or-na}} |
| Data-flow or ERD visual, if applicable  | What sensitive data moves or persists, and where?                  | {{no-private-data-or-finding}} | {{fresh-stale-or-na}} |

## CISO Review Ask

CISO / Risk should respond with one of:

- `approve`: controls and residual risks are acceptable for release.
- `revise <section>`: security posture needs correction.
- `defer <reason>`: release is blocked pending evidence or exception approval.
