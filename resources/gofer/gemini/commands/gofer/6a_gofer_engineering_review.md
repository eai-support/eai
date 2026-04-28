---
description:
  Backwards-compat stub — engineering review is now Phase C of /6_gofer_validate
---

# Gofer Engineering Review (Back-Compat Stub)

> **NOTE**: This command was consolidated into `/6_gofer_validate` (Phase C). It
> remains in the pipeline sequence and `ENTERPRISE_AI_REFERENCE_COMMANDS` set
> for backwards compatibility with existing `pipeline-state.json` files,
> orchestration logs, and any callers that still reference it by name.
>
> All engineering-review logic now lives in **Phase C** of
> `.claude/commands/6_gofer_validate.md`. This stub is a thin router.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `validation-report.md` — from `/6_gofer_validate` Phase A+B (status PASS)
- `blast-radius-report.md` — from `/6_gofer_validate` Phase B
- Optionally `engineering-review-report.md` — from `/6_gofer_validate` Phase C
  (if Phase C has already run)

---

## Behavior

### Step 1: Detect Whether Phase C Already Ran

```bash
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks
```

Parse JSON for `FEATURE_DIR`. Then:

```bash
test -f "{FEATURE_DIR}/engineering-review-report.md"
```

### Step 2: Route

#### Case A — `engineering-review-report.md` exists (Phase C already ran)

Phase C was executed inline by `/6_gofer_validate`. This stub has nothing to do.
Read the existing report, emit the appropriate completion banner that matches
the report's `status` field, and exit.

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW: [Feature Name]
════════════════════════════════════════════════════════════════

  Status: [PASS | PASS_WITH_WARNINGS | ESCALATED]
  Cycles used: [N] of 5
  Report: {FEATURE_DIR}/engineering-review-report.md

  Phase C of /6_gofer_validate has already executed.
  Nothing further to do from the /6a stub.
════════════════════════════════════════════════════════════════
```

Do NOT re-run the review agents. Do NOT mutate the report. Do NOT write new
files. This is a pure no-op redirect.

#### Case B — `engineering-review-report.md` is absent (legacy caller)

A legacy caller invoked `/6a` directly without running the new consolidated
`/6_gofer_validate`. Delegate to `/6_gofer_validate` Phase C by invoking the
Skill tool:

```
Skill: skill="/6_gofer_validate", args="--phase-c-only"
```

If your CLI does not support phase-scoped invocation, run `/6_gofer_validate` in
full — it will detect an existing `validation-report.md` with `status: PASS` and
`score: 100` (legacy) or `score: 110` (new) and skip straight to Phase C.

---

## Rationale for the Consolidation

The former `/6a_gofer_engineering_review` was always auto-chained from `/6` and
shared the same feature directory, same prerequisites, and same cycle concept.
Splitting them into two commands created:

- Duplicated context loading
- Two separate pipeline-state transitions where one logical quality gate existed
- Ambiguity about where Phase B (blast-radius) findings should flow

Consolidating into a 3-phase `/6_gofer_validate` (Rubric → Blast Radius →
Engineering Review Loop) gives:

- One artifact trail: `validation-report.md` + `blast-radius-report.md` +
  `engineering-review-report.md`
- One context load
- One place to reason about which findings block merge
- Clear seeding: Phase B Yellow/Gray findings become Phase C inputs

Nothing was removed. Every Phase C agent (engineer-review, codebase-analyzer,
validation-correctness) and every cycle-management rule (5-cycle cap, Red-
before-Yellow fix priority, re-verify after fixes, escalation on exhaustion) is
preserved verbatim inside `/6_gofer_validate` Phase C.

---

## Observability Logging

When this stub runs (either case), log:

```bash
.specify/scripts/bash/log-stage.sh 6a_engineering_review --complete --note "stub-delegated-to-6"
```

This keeps the stage-completion log contract unchanged for downstream tools that
read `.specify/logs/stage-completions.jsonl`.

---

## Key Rules

- **Never re-run Phase C agents when the report already exists** — that would
  double-count findings and break attribution logs
- **Never write `engineering-review-report.md` from this stub** — only
  `/6_gofer_validate` Phase C writes it
- **Always log stage completion** — even for no-op runs — so pipeline-state
  progression stays coherent
- **This file is intentionally thin** — all review logic lives in
  `/6_gofer_validate`. If you're reading this stub looking for review behavior,
  open `.claude/commands/6_gofer_validate.md` Phase C instead.
