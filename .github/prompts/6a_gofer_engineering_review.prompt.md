---
description:
  Post-implementation engineering review with iterative fix cycles (up to 5)
---

# Gofer Engineering Review

You are performing a **post-implementation engineering review** that
cross-checks the actual code against spec, research, tasks, and validation
artifacts. This stage runs **after** `/6_gofer_validate` passes and performs 1-5
iterative "review → fix → re-review" cycles until all findings are resolved or 5
cycles complete.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)
- `plan.md` - Implementation plan (from /3_gofer_plan)
- `tasks.md` - Task breakdown (from /4_gofer_tasks)
- `validation-report.md` - Validation results (from /6_gofer_validate, PASS)
- Implemented code (from /5_gofer_implement)

---

## Outline

1. Load context and artifacts
2. Perform 3 review analyses (sequentially in Copilot Chat)
3. Run build/test/lint verification
4. Synthesize findings
5. Fix Red and Yellow findings
6. Loop or complete (up to 5 cycles)
7. Generate engineering review report

---

## Step 1: Load Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --require-tasks
   ```

   Parse JSON for FEATURE_DIR

2. **Load all artifacts**:
   - spec.md (user stories, acceptance criteria)
   - research.md (codebase patterns, technology context)
   - plan.md (architecture, file structure, tech stack)
   - tasks.md (task completion status, file paths)
   - validation-report.md (validation results from stage 6)

3. **Initialize cycle counter**: `CYCLE = 1`

4. **Initialize findings history**: Empty array to accumulate across cycles

---

## Step 2: Perform 3 Review Analyses (Cycle N of 5)

> **Copilot Chat note**: In Claude Code, these run as parallel sub-agents. In
> Copilot Chat, perform each analysis sequentially inline.

### Analysis 1: Spec↔Plan↔Tasks↔Research Alignment

Cross-reference all pipeline artifacts:

1. Verify spec completeness against research.md — are all research findings
   addressed in the spec?
2. Check all acceptance criteria are addressed in the actual code (not just
   tasks)
3. Verify research.md patterns were followed in implementation
4. For each acceptance criterion in spec.md, find the task AND the implementing
   code
5. Check plan.md phases match what was actually implemented

**Report findings** with Red/Yellow/Gray severity.

### Analysis 2: Code↔Tasks Verification

Verify implementation matches task breakdown:

1. Every task marked [x] in tasks.md has corresponding code changes — check file
   paths referenced in each task
2. Search for TODO/FIXME/HACK comments in files listed in tasks.md
3. Check for dead code or unused imports in changed files
4. Verify any API contracts/interfaces match their actual implementations
5. Check for inconsistencies between task descriptions and what was implemented

**Severity guide**:

- Red = task marked complete but no code found, or API contract mismatch
- Yellow = TODO/FIXME comments, unused imports, minor inconsistencies
- Gray = style suggestions, optional improvements

### Analysis 3: Correctness Re-verification

Focused re-check after validation passed:

1. Edge cases from spec that may not have explicit tests
2. Error handling completeness — are all failure modes covered?
3. Race conditions or concurrency issues in async code
4. Input validation at system boundaries
5. Any acceptance criteria that are technically 'covered' by tests but the
   implementation doesn't fully satisfy the spirit of the requirement

**Severity guide**:

- Red = acceptance criterion not genuinely satisfied, critical error path
  missing
- Yellow = edge case not covered, partial error handling
- Gray = potential improvement, defensive coding suggestion

---

## Step 3: Run Build/Test/Lint Verification

Execute verification commands and capture results:

```bash
cd extension && npm run compile
cd extension && npm test
cd extension && npm run lint
```

Record results:

```
| Check  | Command              | Result      |
|--------|----------------------|-------------|
| Build  | npm run compile      | PASS / FAIL |
| Tests  | npm test             | PASS / FAIL |
| Lint   | npm run lint         | PASS / FAIL |
```

**If any check FAILS**: Record as a Red finding.

---

## Step 4: Synthesize Findings

Collect all analysis results and build/test/lint results. Classify each:

- **Red** (blocking): Task marked complete but no code, API contract mismatch,
  acceptance criterion not genuinely satisfied, build/test/lint failure
- **Yellow** (should fix): TODO/FIXME comments, unused imports, edge cases not
  covered, partial error handling
- **Gray** (informational): Style suggestions, optional improvements

### Compile Finding Table

```
| # | Finding | Severity | Analysis | File | Line | Status |
|---|---------|----------|----------|------|------|--------|
| 1 | [desc]  | Red      | [which]  | [file] | [line] | OPEN |
```

### Decision Logic

- If **NO Red or Yellow findings** → PASS → proceed to Step 7 (Report)
- If **Red or Yellow findings exist** → proceed to Step 5 (Fix)

---

## Step 5: Fix Findings

For each Red and Yellow finding:

1. Read the affected file at the specified line
2. Apply the fix directly
3. Mark the finding as FIXED

### Fix Priority

1. Red findings first (blocking)
2. Yellow findings second (should fix)
3. Gray findings are logged but NOT auto-fixed

### After Fixing

Re-run build/test/lint:

```bash
cd extension && npm run compile && npm test && npm run lint
```

---

## Step 6: Loop or Complete

Increment `CYCLE = CYCLE + 1`.

- If `CYCLE <= 5` AND findings were fixed → **Go to Step 2** (re-review)
- If `CYCLE > 5` AND Red/Yellow remain → Generate escalation, pipeline complete
  with warnings
- If all clear → Pipeline complete

---

## Step 7: Generate Engineering Review Report

Write to `{FEATURE_DIR}/engineering-review-report.md`:

```markdown
---
feature: [Feature Name]
reviewed: [ISO timestamp]
reviewer: Claude
status: [PASS/PASS_WITH_WARNINGS/ESCALATED]
cycles: [N]
total_findings: [N]
resolved_findings: [N]
---

# Engineering Review Report: [Feature Name]

## Summary

- **Status**: [PASS / PASS_WITH_WARNINGS / ESCALATED]
- **Review cycles**: [N] of 5 max
- **Total findings**: [N] (Red: [N], Yellow: [N], Gray: [N])
- **Resolved**: [N] findings fixed across [N] cycles
- **Remaining**: [N] findings (if any)

## Cycle History

### Cycle 1

| #   | Finding | Severity | Analysis | File   | Line   | Resolution   |
| --- | ------- | -------- | -------- | ------ | ------ | ------------ |
| 1   | [desc]  | [sev]    | [which]  | [file] | [line] | [FIXED/OPEN] |

## Remaining Findings (if any)

| #   | Finding | Severity | File | Line | Reason Not Fixed |
| --- | ------- | -------- | ---- | ---- | ---------------- |

## Recommendations

### Must Address Before Merge

- [Any remaining Red/Yellow findings]

### Future Improvements

- [Gray findings and suggestions]
```

---

## Step 8: Output Completion Banner

### If PASS:

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW PASSED: [Feature Name]
════════════════════════════════════════════════════════════════

  FEATURE PIPELINE COMPLETE!

  All Gofer stages finished:
  1. /1_gofer_research ✓
  2. /2_gofer_specify ✓
  3. /3_gofer_plan ✓
  4. /4_gofer_tasks ✓
  5. /5_gofer_implement ✓
  6. /6_gofer_validate ✓
  6a. /6a_gofer_engineering_review ✓

  The feature is ready for review and merge.
════════════════════════════════════════════════════════════════
```

### If ESCALATED:

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW ESCALATED: [Feature Name]
════════════════════════════════════════════════════════════════

  This feature requires human review of remaining findings.
  Report: {FEATURE_DIR}/engineering-review-report.md
════════════════════════════════════════════════════════════════
```

---

## Next Steps (Manual Chaining — Copilot Chat)

This is the **final stage** of the Gofer pipeline. When complete, the feature is
ready for review and merge. No further stages to run.

---

## Key Rules

- **5 cycles maximum** — hard cap to prevent infinite loops
- **Fix Red before Yellow** — priority ordering matters
- **Re-verify after fixes** — always re-run build/test/lint after changes
- **Gray findings are logged, not auto-fixed** — they go in the report
- **Be specific** — cite file paths and line numbers for all findings
- **This stage is the pipeline terminal** — "PIPELINE COMPLETE" only appears
  here
