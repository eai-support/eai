---
name: 6a_gofer_engineering_review
description: Post-implementation engineering review with iterative fix cycles (up to 5)
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


# Gofer Engineering Review

You are performing a **post-implementation engineering review** that
cross-checks the actual code against spec, research, tasks, and validation
artifacts. This stage runs **after** `$ $6_gofer_validate` passes and performs 1-5
iterative "review → fix → re-review" cycles until all findings are resolved or 5
cycles complete.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from $ $1_gofer_research)
- `spec.md` - Feature specification (from $ $2_gofer_specify)
- `plan.md` - Implementation plan (from $ $3_gofer_plan)
- `tasks.md` - Task breakdown (from $ $4_gofer_tasks)
- `validation-report.md` - Validation results (from $ $6_gofer_validate, PASS)
- Implemented code (from $ $5_gofer_implement)

---

## Outline

1. Load context and artifacts
2. Spawn 3 parallel review agents (per cycle)
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

## Step 2: Spawn 3 Parallel Review Agents (Cycle N of 5)

Launch all 3 agents **in parallel** using the Task tool. Each agent receives the
feature context and returns structured findings.

### Agent 1: Engineer Review (Spec↔Plan↔Tasks↔Research Alignment)

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the engineer-review analysis in each., model="sonnet"
Prompt: "Post-implementation engineering review for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Spec: {FEATURE_DIR}/spec.md
Plan: {FEATURE_DIR}/plan.md
Tasks: {FEATURE_DIR}/tasks.md
Research: {FEATURE_DIR}/research.md

This is a POST-IMPLEMENTATION review (code is already written).
In addition to your standard spec↔plan↔tasks alignment checks:
1. Verify spec completeness against research.md — are all research findings addressed?
2. Check all acceptance criteria are addressed in the actual code (not just tasks)
3. Verify research.md patterns were followed in implementation

Return findings in your standard report format (<2000 tokens)."
```

### Agent 2: Codebase Analyzer (Code↔Tasks Verification)

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the codebase-analyzer analysis in each., model="sonnet"
Prompt: "Post-implementation code verification for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Tasks: {FEATURE_DIR}/tasks.md

Verify the following:
1. Every task marked [x] in tasks.md has corresponding code changes — check file paths
2. Search for TODO/FIXME/HACK comments in files listed in tasks.md
3. Check for dead code or unused imports in changed files
4. Verify any API contracts/interfaces match their actual implementations
5. Check for inconsistencies between task descriptions and what was implemented

Return findings with Red/Yellow/Gray severity (<2000 tokens).
Red = task marked complete but no code found, or API contract mismatch
Yellow = TODO/FIXME comments, unused imports, minor inconsistencies
Gray = style suggestions, optional improvements"
```

### Agent 3: Correctness Re-verification

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the validation-correctness analysis in each., model="sonnet"
Prompt: "Post-implementation correctness re-verification for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Spec: {FEATURE_DIR}/spec.md
Plan: {FEATURE_DIR}/plan.md

This is a focused re-check after validation passed. Look for issues that
rubric-based validation might miss:
1. Edge cases from spec that may not have explicit tests
2. Error handling completeness — are all failure modes covered?
3. Race conditions or concurrency issues in async code
4. Input validation at system boundaries
5. Any acceptance criteria that are technically 'covered' by tests but
   the implementation doesn't fully satisfy the spirit of the requirement

Return findings with Red/Yellow/Gray severity (<2000 tokens).
Red = acceptance criterion not genuinely satisfied, critical error path missing
Yellow = edge case not covered, partial error handling
Gray = potential improvement, defensive coding suggestion"
```

**Run all 3 agents in parallel.** Collect all results before proceeding.

---

## Step 3: Run Build/Test/Lint Verification

Execute verification commands and capture results:

### Build Check

```bash
cd extension && npm run compile
```

### Test Check

```bash
cd extension && npm test
```

### Lint Check

```bash
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

Collect all agent reports and build/test/lint results. Classify each finding:

- **Red** (blocking): Task marked complete but no code, API contract mismatch,
  acceptance criterion not genuinely satisfied, build/test/lint failure,
  critical error path missing
- **Yellow** (should fix): TODO/FIXME comments, unused imports, edge cases not
  covered, partial error handling, minor inconsistencies
- **Gray** (informational): Style suggestions, optional improvements, defensive
  coding suggestions

### Compile Finding Table

```
| # | Finding | Severity | Agent | File | Line | Status |
|---|---------|----------|-------|------|------|--------|
| 1 | [desc]  | Red      | [agent] | [file] | [line] | OPEN |
| 2 | [desc]  | Yellow   | [agent] | [file] | [line] | OPEN |
```

### Decision Logic

- If **NO Red or Yellow findings** → PASS → proceed to Step 7 (Report)
- If **Red or Yellow findings exist** → proceed to Step 5 (Fix)

---

## Step 5: Fix Findings

For each Red and Yellow finding from the current cycle:

1. **Read the affected file** at the specified line
2. **Apply the fix** directly using Edit tool
3. **Mark the finding as FIXED** in the finding table

### Fix Priority

1. Red findings first (blocking issues)
2. Yellow findings second (should fix)
3. Gray findings are logged but NOT auto-fixed

### After Fixing

Re-run build/test/lint to verify fixes don't introduce regressions:

```bash
cd extension && npm run compile && npm test && npm run lint
```

If the verification fails after fixes, record new failures as Red findings for
the next cycle.

---

## Step 6: Loop or Complete

### Increment Cycle

```
CYCLE = CYCLE + 1
```

### Decision

- If `CYCLE <= 5` AND findings were fixed in the previous cycle → **Go to Step
  2** (re-review with fresh agent runs to verify fixes and catch any new issues)
- If `CYCLE > 5` AND Red/Yellow findings still remain → **Generate escalation
  section** in the report, declare pipeline complete with warnings
- If **all findings resolved** (no Red or Yellow) → **Declare pipeline
  complete** (proceed to Step 7)

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

**Agents**: engineer-review, codebase-analyzer, validation-correctness
**Build/Test/Lint**: [PASS/FAIL details]

| #   | Finding | Severity | Agent   | File   | Line   | Resolution   |
| --- | ------- | -------- | ------- | ------ | ------ | ------------ |
| 1   | [desc]  | [sev]    | [agent] | [file] | [line] | [FIXED/OPEN] |

### Cycle 2 (if applicable)

...

## Remaining Findings (if any)

| #   | Finding | Severity | Agent   | File   | Line   | Reason Not Fixed |
| --- | ------- | -------- | ------- | ------ | ------ | ---------------- |
| 1   | [desc]  | [sev]    | [agent] | [file] | [line] | [why]            |

## Recommendations

### Must Address Before Merge

- [Any remaining Red/Yellow findings]

### Future Improvements

- [Gray findings and suggestions]
```

---

## Step 8: Output Completion Banner

### If PASS (all findings resolved or no findings):

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW PASSED: [Feature Name]
════════════════════════════════════════════════════════════════

  Cycles: [N] of 5 max
  Findings: [N] found, [N] resolved
  Report: {FEATURE_DIR}/engineering-review-report.md

════════════════════════════════════════════════════════════════
  FEATURE PIPELINE COMPLETE!

  All Gofer stages finished:
  1. $ $1_gofer_research ✓
  2. $ $2_gofer_specify ✓
  3. $ $3_gofer_plan ✓
  4. $ $4_gofer_tasks ✓
  5. $ $5_gofer_implement ✓
  6. $ $6_gofer_validate ✓
  6a. /6a_gofer_engineering_review ✓

  The feature is ready for review and merge.
════════════════════════════════════════════════════════════════
```

### If PASS_WITH_WARNINGS (5 cycles exhausted, only Gray remaining):

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW PASSED (WITH WARNINGS): [Feature Name]
════════════════════════════════════════════════════════════════

  Cycles: 5 of 5 max
  Findings: [N] found, [N] resolved, [N] Gray remaining
  Report: {FEATURE_DIR}/engineering-review-report.md

  ⚠ Gray findings remain — see report for details.

════════════════════════════════════════════════════════════════
  FEATURE PIPELINE COMPLETE!

  All Gofer stages finished:
  1. $ $1_gofer_research ✓
  2. $ $2_gofer_specify ✓
  3. $ $3_gofer_plan ✓
  4. $ $4_gofer_tasks ✓
  5. $ $5_gofer_implement ✓
  6. $ $6_gofer_validate ✓
  6a. /6a_gofer_engineering_review ✓ (warnings)

  The feature is ready for review and merge (review Gray findings).
════════════════════════════════════════════════════════════════
```

### If ESCALATED (5 cycles exhausted, Red/Yellow remain):

```
════════════════════════════════════════════════════════════════
  ENGINEERING REVIEW ESCALATED: [Feature Name]
════════════════════════════════════════════════════════════════

  Cycles: 5 of 5 max (exhausted)
  Findings: [N] found, [N] resolved, [N] Red/Yellow remaining

  Remaining issues:
  ✗ [Finding] — [severity]: [brief reason]

  Report: {FEATURE_DIR}/engineering-review-report.md

  This feature requires human review of remaining findings
  before merging.

════════════════════════════════════════════════════════════════
```

---

## Step 9: Observability Logging

Log stage completion:

```bash
.specify/scripts/bash/log-stage.sh 6a_engineering_review --complete --tokens [N] --compactions [N]
```

---

## Key Rules

- **3 agents per cycle** — spawn all in parallel, do not serialize
- **5 cycles maximum** — hard cap to prevent infinite loops
- **Fix Red before Yellow** — priority ordering matters
- **Re-verify after fixes** — always re-run build/test/lint after changes
- **Gray findings are logged, not auto-fixed** — they go in the report
- **Be specific** — cite file paths and line numbers for all findings
- **This stage is the pipeline terminal** — "PIPELINE COMPLETE" only appears
  here
- Log stage completion for observability tracking
