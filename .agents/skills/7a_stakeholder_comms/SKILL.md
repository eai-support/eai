---
name: 7a_stakeholder_comms
description: >-
  Generate stakeholder communications package including release notes, demo
  script, change management brief, and success metrics
arguments:
  - name: feature
    description: Feature name or description
    required: false
result_schema:
  type: object
  properties:
    output:
      type: string
      description: Path to generated artifact or execution summary
    status:
      type: string
      enum:
        - success
        - error
---


# Gofer Stakeholder Communications

You are generating a **stakeholder communications package** after a feature has
been validated. This is a **post-pipeline stage** that translates technical
implementation into business-friendly deliverables.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `validation-report.md` — Feature validated (PASS) from $ $1
- `problem-brief.md` — Original business problem (from /0a_problem_validation)
- `spec.md` — Feature specification (from $ $1)
- `spec-summary.md` — Executive summary (from $ $1)
- `assumptions.md` — Tracked assumptions

If `validation-report.md` doesn't exist or shows FAIL, do NOT generate comms.
Instead, inform the user that validation must pass first.

---

## Outline

1. Context health check
2. Load all feature context
3. Spawn comms-writer agent
4. Spawn business-metrics-analyzer agent
5. Generate stakeholder communications package
6. Generate business metrics dashboard
7. Final assumption review
8. Completion summary

---

## Step 0: Context Health Check

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Use sub-agents heavily
- If **> 70%**: Run `$ $1` first

---

## Step 1: Load Feature Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --require-tasks
   ```

   Parse JSON for FEATURE_DIR

2. **Load all business artifacts**:
   - `problem-brief.md` — Original problem and business case
   - `discovery.md` — Business discovery context
   - `spec-summary.md` — Executive summary
   - `assumptions.md` — Assumption register
   - `validation-report.md` — Quality verification results
   - `tasks.md` — Implementation status

3. **Verify validation passed**:
   - Check `validation-report.md` for `status: PASS`
   - If FAIL: "Validation must pass before generating communications. Current
     score: [N]/100. Run $ $1 first."

---

## Step 2: Spawn Parallel Agents

Launch both agents **in parallel**:

### Agent 1: Communications Writer

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the comms-writer analysis in each., model="sonnet"
Prompt: "Generate stakeholder communications for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read and use:
- problem-brief.md for original problem context
- discovery.md for business discovery findings
- spec.md for what was specified
- spec-summary.md for business summary
- validation-report.md for quality status
- assumptions.md for tracked assumptions

Generate:
1. Executive summary (3 sentences)
2. Non-technical release notes
3. 5-minute demo script with talking points
4. Change management brief with rollout plan
5. Success metrics with baseline and targets
6. Communication timeline

Return structured report (<2000 tokens)."
```

### Agent 2: Business Metrics Analyzer

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the business-metrics-analyzer analysis in each., model="sonnet"
Prompt: "Analyze pipeline metrics for business reporting.

Feature directory: {FEATURE_DIR}
Logs directory: .specify/logs/

Read pipeline logs and feature artifacts to produce:
1. Feature velocity (delivery time for this feature)
2. Stage duration breakdown
3. Quality metrics (validation score, iterations)
4. Cost analysis (token usage)
5. Portfolio status (all features in .specify/specs/)
6. Scope health indicators

Return structured report (<2000 tokens)."
```

**Run both agents in parallel.**

---

## Step 3: Generate Stakeholder Communications

Write to `{FEATURE_DIR}/stakeholder-comms.md` using the template at
`.specify/templates/stakeholder-comms-template.md`.

Populate with comms-writer agent findings. Ensure:

- **All language is non-technical** — no jargon, no acronyms without explanation
- **Impact is quantified** — use numbers from problem-brief.md
- **Demo script is actionable** — someone could run the demo from this document
- **Change management is realistic** — phased rollout with success criteria
- **Metrics are tied to problem** — connect back to original business case

---

## Step 4: Generate Business Metrics Dashboard

Write to `{FEATURE_DIR}/business-metrics.md` using the template at
`.specify/templates/business-metrics-template.md`.

Populate with business-metrics-analyzer agent findings.

---

## Step 5: Final Assumption Review

Spawn the assumption-tracker agent to do a final review:

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the assumption-tracker analysis in each., model="haiku"
Prompt: "Final assumption review for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read assumptions.md and cross-reference against:
- validation-report.md (did implementation reveal any disproven assumptions?)
- tasks.md (any tasks that changed because of assumption issues?)

Update assumption statuses based on implementation evidence.
Flag any assumptions that remain UNVALIDATED and could affect launch.

Return structured report (<2000 tokens)."
```

### Update Assumptions

Based on agent findings, update `{FEATURE_DIR}/assumptions.md`:

- Mark assumptions validated by implementation as `VALIDATED`
- Mark assumptions disproven during development as `DISPROVEN`
- Flag remaining `UNVALIDATED` assumptions with recommended verification actions

---

## Step 6: Generate Scope Creep Report (If problem-brief exists)

If `{FEATURE_DIR}/problem-brief.md` exists, run scope creep detection:

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the scope-creep-detector analysis in each., model="haiku"
Prompt: "Analyze scope creep for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Compare the final implementation (tasks.md, spec.md) against the original
problem brief (problem-brief.md). Calculate scope creep score.

Return structured report (<2000 tokens)."
```

If scope creep score > 25%, include a "Scope Evolution" section in the
stakeholder communications explaining what changed and why.

---

## Step 7: Completion Summary

```
════════════════════════════════════════════════════════════════
  STAKEHOLDER COMMUNICATIONS COMPLETE: [Feature Name]
════════════════════════════════════════════════════════════════

  Deliverables:
  - {FEATURE_DIR}/stakeholder-comms.md
  - {FEATURE_DIR}/business-metrics.md
  - {FEATURE_DIR}/assumptions.md (updated)

  Package includes:
  - Executive Summary
  - Release Notes (non-technical)
  - Demo Script (5-minute walkthrough)
  - Change Management Brief
  - Success Metrics & KPIs
  - Communication Timeline
  - Business Metrics Dashboard
  - Assumption Status Report

  Scope Creep Score: [N]% ([Healthy/Warning/Alert])
  Assumptions: [N] validated, [N] unvalidated, [N] disproven

════════════════════════════════════════════════════════════════
  FEATURE PIPELINE COMPLETE!

  Full Pipeline Summary:
  0a. /0a_problem_validation  ✓ (Problem validated)
  1.  $ $1        ✓ (Codebase + market research)
  2.  $ $1         ✓ (Spec + business summary)
  3.  $ $1            ✓ (Technical architecture)
  4.  $ $1           ✓ (Task breakdown)
  5.  $ $1       ✓ (Implementation)
  6.  $ $1        ✓ (Quality: [score]/100)
  7a. /7a_stakeholder_comms    ✓ (Communications package)

  The feature is ready for stakeholder review and deployment.
════════════════════════════════════════════════════════════════
```

---

## Step 8: Observability Logging

```bash
.specify/scripts/bash/log-stage.sh 7a_stakeholder_comms --complete --tokens [N] --compactions [N]
```

---

## Important Notes

- **Every output must be copy-pasteable** — consultants share these as-is
- **No technical jargon** — write for business executives
- **Connect to business case** — always reference problem-brief.md impact
  metrics
- **Be honest about limitations** — known issues build trust
- **Include timelines** — consultants need to plan around dates
- **Quantify everything** — numbers > adjectives
- **Demo script must work** — test it mentally before writing

---

## LLM Council Integration

When council mode is configured in `.specify/memory/council-config.yaml` for
stakeholder communications:

1. Multiple LLMs draft communications independently
2. Chairman synthesizes best elements from each
3. Ensures diverse writing styles and perspectives
4. Usage logged to `.specify/logs/council-usage.jsonl`
