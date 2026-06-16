---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
audience: business-stakeholders
validation-score: '{{score}}/100'
---

# Stakeholder Communications: {{feature-name}}

## Executive Summary

{{3-sentences: what-was-built, why-it-matters, key-business-outcome}}

---

## Release Notes

### What's New

- **{{capability-1}}**: {{one-sentence-user-perspective-description}}
- **{{capability-2}}**: {{one-sentence-user-perspective-description}}

### What Changed

- **{{change-1}}**: {{what-users-will-notice-is-different}}

### Known Limitations

- {{limitation-1}}: {{planned-resolution-if-applicable}}

---

## Demo Script (5-Minute Walkthrough)

### Setup

- Environment: {{where-to-demo}}
- Test data: {{what-data-to-have-ready}}
- Audience: {{who-this-demo-is-for}}

### Walkthrough

| Step | Action          | Talking Point                                    | Duration |
| ---- | --------------- | ------------------------------------------------ | -------- |
| 1    | {{navigate-to}} | "Notice how {{benefit}}..."                      | 30s      |
| 2    | {{click-on}}    | "This solves {{problem}} by..."                  | 60s      |
| 3    | {{enter-data}}  | "Previously this took {{X}}, now it takes {{Y}}" | 60s      |
| 4    | {{show-result}} | "The key value here is {{metric}}"               | 60s      |
| 5    | Q&A             | See prepared answers below                       | 90s      |

### Prepared Q&A

| Question                        | Answer                  |
| ------------------------------- | ----------------------- |
| "{{likely-question-1}}?"        | "{{prepared-answer-1}}" |
| "{{likely-question-2}}?"        | "{{prepared-answer-2}}" |
| "What if something goes wrong?" | "{{failsafe-answer}}"   |

### Demo Fallback

If the demo environment is unavailable:

- {{fallback-plan: screenshots, video, or local environment}}

---

## Architecture Overview

The architecture diagram below is rendered inline as a Mermaid block. When the
stakeholder pack is assembled (`/7a_stakeholder_comms`), this section is
populated automatically from the C4 Context diagram in `visuals/`.

```mermaid
{{ARCHITECTURE_DIAGRAM}}
```

If `mmdc` (the Mermaid CLI) is available, an accompanying PNG is exported
alongside this Markdown so the diagram renders in tools that don't support
inline Mermaid (FR-029, NFR-006).

---

## AI-Augmented 4-Step Journey

For app delivery, summarize the four-step-or-fewer process and how generative AI
helps the user complete each step. For non-app work, state the classification
rationale and omit app-specific controls.

| Step | Business Goal | AI Help    | User Control / Evidence |
| ---- | ------------- | ---------- | ----------------------- |
| 1    | {{goal}}      | {{assist}} | {{control}}             |
| 2    | {{goal}}      | {{assist}} | {{control}}             |
| 3    | {{goal}}      | {{assist}} | {{control}}             |
| 4    | {{goal}}      | {{assist}} | {{control}}             |

---

## Marp Presentation Deck (Optional, Recommended for EnterpriseAI)

If this run enables Marp output, generate `{FEATURE_DIR}/presentation.marp.md`
and the persona deck pack in `{FEATURE_DIR}/presentations/`. Standard Gofer is
the public default; EnterpriseAI Marp guidance is migration-only and used only
when explicitly requested.

The general deck uses this required structure:

````markdown
---
marp: true
theme: default
paginate: true
title: '{{feature-name}} Stakeholder Presentation'
---

# Problem Statement

- {{problem-summary}}
- {{who-is-impacted}}
- {{why-now}}

---

# EnterpriseAI Solution Overview

- {{solution-summary}}
- {{enterpriseai-fit}}
- {{expected-business-outcome}}

---

# AI-Augmented 4-Step Journey

| Step | Business Goal | AI Help    | Completion Signal |
| ---- | ------------- | ---------- | ----------------- |
| 1    | {{goal}}      | {{assist}} | {{signal}}        |
| 2    | {{goal}}      | {{assist}} | {{signal}}        |
| 3    | {{goal}}      | {{assist}} | {{signal}}        |
| 4    | {{goal}}      | {{assist}} | {{signal}}        |

---

# Architecture Diagram Reference

```mermaid
{{ARCHITECTURE_DIAGRAM}}
```
````

- Diagram: {{architecture-diagram-path-or-link}}
- Components: {{vertical-app}} -> {{eai-services}} -> {{deployment-target}}
- Decision rationale: {{why-this-architecture}}

---

# Demo Script Summary

1. {{demo-step-1}}
2. {{demo-step-2}}
3. {{demo-step-3}}
4. {{demo-step-4}}

---

# Success Metrics

- {{metric-1}}: baseline {{current}} -> target {{target}}
- {{metric-2}}: baseline {{current}} -> target {{target}}
- {{metric-3}}: review cadence {{cadence}}

```

When Marp is not enabled, keep producing `release-notes.md` and `demo-script.md`
outputs.

### Persona Marp Deck Pack

Generate a persona-specific executive summary deck for every enterprise
decision-rights audience:

| Deck | Audience | What They Need To Know |
| ---- | -------- | ---------------------- |
| `presentations/executive.marp.md` | Executive committee | Strategic value, funding gate, risk appetite |
| `presentations/business.marp.md` | Business owner | User journey, operational value, adoption path |
| `presentations/internal-delivery.marp.md` | Internal delivery | Delivery sequence, red/green loop, implementation risk |
| `presentations/enterprise-architecture.marp.md` | Enterprise architecture | Platform fit, context bundle, contract pack, reuse decisions |
| `presentations/ciso.marp.md` | CISO | Identity, tenant boundaries, controls, residual risk |
| `presentations/data-architecture.marp.md` | Data architecture | Object types, lineage, data quality, governance |
| `presentations/cio.marp.md` | CIO | Platform strategy, operating model, reusable capability roadmap |
| `presentations/cfo.marp.md` | CFO | Investment case, benefit tracking, delivery and run cost |
| `presentations/coo.marp.md` | COO | Process change, rollout readiness, support model |
| `presentations/risk-compliance.marp.md` | Risk/compliance | Obligations, evidence pack, exceptions, audit trail |

Each persona deck must include:

- Executive Summary.
- Decision Focus.
- Problem Statement.
- EnterpriseAI Solution Overview.
- Architecture Diagram Reference with Mermaid.
- Context Bundle.
- Contract Pack.
- Reuse-Before-Create.
- Audit History.
- Red/Green Validation Loop.
- Demo Script Summary.
- Success Metrics.
- Persona-specific value/risk table and controls table.

---

## Change Management Brief

### Impact Assessment

| Dimension         | Level         | Details                     |
| ----------------- | ------------- | --------------------------- |
| User Impact       | Low/Med/High  | {{who-affected-and-how}}    |
| Process Change    | Low/Med/High  | {{what-workflows-change}}   |
| Training Required | None/Self/Led | {{what-training-is-needed}} |
| Support Impact    | Low/Med/High  | {{expected-ticket-changes}} |

### Rollout Recommendation

| Phase   | Scope             | Timing   | Success Criteria      |
| ------- | ----------------- | -------- | --------------------- |
| Phase 1 | {{pilot-group}}   | {{when}} | {{what-must-be-true}} |
| Phase 2 | {{broader-group}} | {{when}} | {{what-must-be-true}} |
| Phase 3 | {{all-users}}     | {{when}} | {{what-must-be-true}} |

### Communication Plan

| When       | What            | Audience       | Channel |
| ---------- | --------------- | -------------- | ------- |
| Pre-launch | Announcement    | All users      | Email   |
| Launch day | How-to guide    | Affected users | In-app  |
| Week 1     | Feedback survey | Early adopters | Email   |
| Month 1    | Metrics review  | Stakeholders   | Meeting |

---

## Training Materials Outline

### Self-Serve Resources

1. **Quick Start Guide** (5 min read)
   - {{key-workflow-steps}}

2. **FAQ Document**
   - {{common-questions-and-answers}}

### Facilitated Training (if required)

| Session   | Duration | Audience | Content          |
| --------- | -------- | -------- | ---------------- |
| {{title}} | {{time}} | {{who}}  | {{what-covered}} |

---

## Success Metrics (Post-Launch)

| Metric       | Baseline (Before) | Target (After) | Source               | Review Cadence |
| ------------ | ----------------- | -------------- | -------------------- | -------------- |
| {{metric-1}} | {{current}}       | {{target}}     | {{where-to-measure}} | Weekly         |
| {{metric-2}} | {{current}}       | {{target}}     | {{where-to-measure}} | Monthly        |

### 30-Day Review Checklist

- [ ] Adoption rate: {{target}}% of target users active
- [ ] Error rate: Below {{threshold}}
- [ ] User feedback: NPS > {{target}}
- [ ] Performance: Within {{SLA}} targets
- [ ] Support tickets: Below {{threshold}}/week

---

## Quality Assurance Summary

**Validation Score**: {{score}}/100 (PASS)

| Category                  | Result | Plain English                      |
| ------------------------- | ------ | ---------------------------------- |
| Works correctly           | PASS   | All features verified working      |
| Tests are reliable        | PASS   | High confidence in test coverage   |
| Security checked          | PASS   | No security vulnerabilities found  |
| Integrations working      | PASS   | Connects properly with other tools |
| Error handling            | PASS   | Graceful behavior on failures      |
| Follows project standards | PASS   | Consistent with existing codebase  |
| Performance acceptable    | PASS   | No slow or blocking operations     |
| Code is clean             | PASS   | No shortcuts or temporary code     |

---

_Generated by Gofer Pipeline — {{ISO-timestamp}}_ _Problem Brief:
`problem-brief.md` | Spec: `spec.md` | Validation: `validation-report.md`_
```
