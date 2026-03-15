---
description:
  Validate implementation with 10-category engineering rubric (100 points)
---

# Gofer Validate

You are validating that the implementation meets engineering quality standards
using a **10-category rubric scored out of 100 points**. This is the **sixth
stage** of the unified Gofer pipeline.

A score of **100/100 is required to pass**. Any category scoring 0 triggers
failure and a brownfield restart loop.

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
- Implemented code (from /5_gofer_implement)

---

## Outline

1. Context health check
2. Load implementation context
3. Spawn 6 specialist validation agents in parallel
4. Run automated checks (build, test, lint, typecheck)
5. Mutation testing gate
6. Mock ratio analysis
7. Semantic slop detection
8. Score the 10-category rubric
9. Generate enhanced validation report
10. Determine PASS/FAIL outcome
11. Brownfield restart on failure
12. Attribution logging to JSONL
13. Memory update check

---

## The Engineering Quality Rubric

### 10-Category Scoring (100 Points)

| #   | Category                   | Points | Pass Criteria                                                                                        | Agent                                         |
| --- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Functional Correctness     | 15     | Every acceptance criterion in spec.md has a passing test exercising real code                        | validation-correctness                        |
| 2   | Test Authenticity          | 15     | Zero skips, zero placeholders, zero mock-only assertions. Mutation score >= 60% if Stryker available | validation-test-quality                       |
| 3   | UI/E2E Verification        | 10     | If feature has UI: real rendering tests pass. If no UI: points redistribute                          | N/A (automated check)                         |
| 4   | Security Posture           | 10     | Zero hardcoded secrets, no disabled security features, no client-side keys                           | validation-security                           |
| 5   | Integration Reality        | 10     | Integration tests use real dependencies where possible. Contract tests validate boundaries           | validation-integration                        |
| 6   | Error Path Coverage        | 10     | Public functions tested for failure modes. No empty catch blocks                                     | validation-correctness + validation-standards |
| 7   | Architecture Compliance    | 10     | File structure and patterns match plan.md and research.md                                            | validation-standards                          |
| 8   | Performance Baseline       | 5      | No synchronous I/O in async paths, no unbounded loops, no N+1 patterns                               | validation-performance                        |
| 9   | Code Hygiene               | 10     | Zero AI slop: no TODO placeholders, no redundant comments, no magic numbers                          | validation-standards                          |
| 10  | Specification Traceability | 5      | Every user story maps to tests, every test maps to code                                              | validation-correctness                        |

### Point Redistribution (No-UI Features)

When a feature has **no UI component** (no web pages, no frontend, no visual
interface), the 10 points from UI/E2E Verification are redistributed:

- **+5 to Functional Correctness** (total: 20 points)
- **+5 to Test Authenticity** (total: 20 points)

**Detection**: Check plan.md tech stack. If no UI framework (React, Vue,
Angular, Svelte) and no Playwright/Cypress tests exist, this is a no-UI feature.

### Scoring Rules

- Each category scores **full points** or **0**. There is no partial credit.
- A category scores 0 if its agent reports any **Red (blocking)** finding.
- A category scores 0 if its automated check fails.
- **Total score** = sum of all category scores.
- **PASS** = 100/100. Anything less = FAIL.

---

## Step 0: Context Health Check

Before starting validation, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Use sub-agents heavily, minimize main context
- If **> 70%**: Run `/7_gofer_save`, start new session, run `/8_gofer_resume`

Validation loads all artifacts and spawns 6 agents — context pressure is high.

---

## Step 1: Load Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --require-tasks
   ```

   Parse JSON for FEATURE_DIR

2. **Load all artifacts**:
   - spec.md (user stories, acceptance criteria)
   - plan.md (architecture, file structure, tech stack)
   - tasks.md (task completion status)
   - research.md (codebase patterns to follow)

3. **Detect iteration count**:
   - Check if `{FEATURE_DIR}/remediation-report.md` exists
   - If yes, read the iteration count from it
   - Track: `ITERATION = [1|2|3]` (first run = 1)

4. **Determine UI presence**:
   - Read plan.md tech stack
   - If UI framework present AND Playwright/Cypress tests exist: `HAS_UI = true`
   - Otherwise: `HAS_UI = false` → apply point redistribution

---

## Step 2: Spawn 6 Specialist Validation Agents

Launch all 6 agents **in parallel** using the Task tool. Each agent receives the
feature context and returns structured findings.

### Agent 1: Correctness Validator

```
Task: subagent_type="validation-correctness", model="sonnet"
Prompt: "Validate functional correctness for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Spec: {FEATURE_DIR}/spec.md
Plan: {FEATURE_DIR}/plan.md

Check every acceptance criterion in spec.md.
For each criterion, find the test that exercises it and verify it tests real code.
Return findings in your standard report format (<2000 tokens)."
```

### Agent 2: Security Validator

```
Task: subagent_type="validation-security", model="sonnet"
Prompt: "Validate security posture for feature [FEATURE_NAME].

Scan all new/modified files (from tasks.md file paths).
Check for: hardcoded secrets, disabled security, auth bypass, client-side keys.
Return findings with Red/Yellow/Gray severity (<2000 tokens)."
```

### Agent 3: Performance Validator

```
Task: subagent_type="validation-performance", model="haiku"
Prompt: "Validate performance characteristics for feature [FEATURE_NAME].

Scan all new/modified source files (from tasks.md file paths).
Check for: sync I/O in async paths, cyclomatic complexity > 12, unbounded loops.
Build scripts and test files are exempt.
Return findings with complexity scores (<2000 tokens)."
```

### Agent 4: Test Quality Validator

```
Task: subagent_type="validation-test-quality", model="haiku"
Prompt: "Validate test quality for feature [FEATURE_NAME].

Scan test files related to the feature.
Check for: placeholder assertions, skipped tests, mock ratio, mock-only tests.
VSCode API mocks marked '// mock-justified: VSCode API' are exempt from ratio.
Return findings with mock ratio calculation (<2000 tokens)."
```

### Agent 5: Integration Validator

```
Task: subagent_type="validation-integration", model="sonnet"
Prompt: "Validate integration contracts for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Check contracts/ directory if it exists.
Verify cross-component boundaries, type compatibility, integration test coverage.
Return findings with contract compliance status (<2000 tokens)."
```

### Agent 6: Standards Validator

```
Task: subagent_type="validation-standards", model="sonnet"
Prompt: "Validate standards compliance for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Check against constitution.md (if exists) and research.md patterns.
Detect AI slop: redundant comments, over-engineered abstractions, silent failures.
Check code hygiene: TODO/FIXME, magic numbers, unused imports.
Return findings with severity tiers (<2000 tokens)."
```

### Agent 7: Security Red Team (Optional — Multi-Perspective)

When the feature involves security-sensitive code (authentication,
authorization, user input handling, external APIs), run the security red team
strategy (#13):

```
# Diverge: 3 attack perspectives
Task: subagent_type="validate-security-red-team", model="sonnet"
Prompt: "Perspective 1: OWASP Top 10 attack analysis for feature [FEATURE_NAME].
Scan all new/modified files from tasks.md. Attack from OWASP perspective.
Return findings with exploit steps (<2000 tokens)."

Task: subagent_type="validate-security-red-team", model="sonnet"
Prompt: "Perspective 2: Business logic abuse analysis for feature [FEATURE_NAME].
Scan all new/modified files from tasks.md. Attack business logic.
Return findings with exploit steps (<2000 tokens)."

Task: subagent_type="validate-security-red-team", model="sonnet"
Prompt: "Perspective 3: CVE search for feature [FEATURE_NAME].
Check package.json dependencies for known CVEs.
Return findings with advisory references (<2000 tokens)."

# Converge: Judge synthesizes attack findings
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Synthesize 3 security red team perspectives for [FEATURE_NAME].
Perspective 1 (OWASP): [result]. Perspective 2 (Business Logic): [result].
Perspective 3 (CVE): [result].
Identify confirmed vulnerabilities vs false positives. Prioritize by exploitability."
```

**Run all 6 core agents in parallel.** Run Agent 7 (if applicable) in parallel
with the core agents. Collect all results before proceeding.

---

## Step 3: Run Automated Checks

Execute verification commands and capture results:

### Build Check

```bash
npm run build  # or appropriate build command
```

### Test Check

```bash
npm test  # or appropriate test command
```

### Lint Check

```bash
npm run lint  # or appropriate lint command
```

### Type Check (if TypeScript)

```bash
npm run typecheck  # or tsc --noEmit
```

Record results:

```
| Check     | Command          | Result        |
|-----------|------------------|---------------|
| Build     | npm run build    | PASS / FAIL   |
| Tests     | npm test         | PASS / FAIL   |
| Lint      | npm run lint     | PASS / FAIL   |
| TypeCheck | tsc --noEmit     | PASS / FAIL   |
```

**If Build or Tests FAIL**: Mark Functional Correctness as 0 immediately.

---

## Step 4: Mutation Testing Gate

Check if mutation testing tools are available:

```bash
npx stryker --version 2>/dev/null
```

### If Stryker is available:

1. Run mutation testing:
   ```bash
   npx stryker run --reporters clear-text 2>&1 | tail -50
   ```
2. Parse mutation score from output
3. Record: `MUTATION_SCORE = [N]%`
4. If score < 60%: contributes to Test Authenticity scoring 0

### If Stryker is NOT available:

1. Record: `MUTATION_SCORE = "unavailable"`
2. Log recommendation: "Install @stryker-mutator/core for mutation testing"
3. Test Authenticity is scored based on other criteria only (placeholders,
   skips, mock ratio)
4. Do NOT block on mutation score when Stryker is absent

---

## Step 5: Mock Ratio Analysis

Count mocking patterns vs real assertions across feature test files:

### Count Mock Calls

Use Grep to count in test files related to the feature:

- `vi.mock(` — module-level mocks
- `vi.fn(` — individual function mocks
- `jest.mock(` — Jest module mocks
- `jest.fn(` — Jest function mocks
- `.mockReturnValue(` — mock configurations
- `.mockResolvedValue(` — async mock configurations

### Count Real Assertions

Use Grep to count:

- `expect(` followed by `.toBe(`, `.toEqual(`, `.toContain(`, `.toThrow(`,
  `.toMatch(`, `.toBeGreaterThan(`, `.toBeLessThan(`, `.toBeDefined(`,
  `.toBeNull(`, `.toHaveLength(`, `.toHaveProperty(`

### Exclude Justified Mocks

Lines containing `// mock-justified:` are excluded from the mock count. This
allows VSCode API mocks and other unavoidable mocks to be documented and exempt.

### Calculate Ratio

```
MOCK_RATIO = mock_calls / (mock_calls + real_assertions)
```

### Evaluate

- If `MOCK_RATIO > 0.30` (30%): contributes to Test Authenticity scoring 0
- Report per-file ratios for the worst offenders

---

## Step 6: Semantic Slop Detection

### Automated Pattern Detection (Grep-based)

Run these checks on new/modified source files (not test files):

#### Red Severity (Blocks)

```
Pattern: expect(true).toBe(true)
Also: expect(1).toBe(1), expect('a').toBe('a')
Method: Grep for tautological assertions in test files
```

```
Pattern: test.skip / it.skip / describe.skip / xit / xdescribe
Method: Grep for skip patterns in feature-related test files
```

#### Yellow Severity (Must Address)

```
Pattern: TODO / FIXME / XXX / HACK in source code (not test helpers)
Method: Grep in new/modified .ts/.js/.py files
```

```
Pattern: Empty catch blocks — catch (e) {} or catch { }
Method: Grep for catch blocks with empty or whitespace-only bodies
```

#### Gray Severity (Informational)

Gray-level findings are reported by the specialist agents (Standards and Test
Quality). They include:

- Redundant comments restating code (agent: validation-standards)
- Over-engineered abstractions for one-time use (agent: validation-standards)
- Magic numbers without named constants (agent: validation-standards)
- Mock-only tests that verify wiring not behavior (agent:
  validation-test-quality)

### Consolidate Slop Findings

Combine automated Grep results with agent findings:

```
| # | Pattern | Severity | Source | Description | File | Line |
|---|---------|----------|--------|-------------|------|------|
| 1 | Placeholder test | Red | Grep | expect(true).toBe(true) | test.ts | 45 |
| 2 | Skipped test | Red | Grep | it.skip('should...') | spec.ts | 12 |
| 3 | TODO placeholder | Yellow | Grep | // TODO: implement | service.ts | 89 |
| 4 | Redundant comment | Yellow | Agent | "// create user" above createUser() | user.ts | 23 |
```

---

## Step 7: Score the 10-Category Rubric

Using agent reports, automated checks, and analysis from Steps 3-6, score each
category:

### Scoring Logic

**Category 1: Functional Correctness** ({15 or 20 if no UI} pts)

- Input: validation-correctness agent report + automated test results
- Score 0 if: Any Red finding from correctness agent, OR build/tests fail
- Score full if: All acceptance criteria verified with real tests

**Category 2: Test Authenticity** ({15 or 20 if no UI} pts)

- Input: validation-test-quality agent report + mutation score + mock ratio
- Score 0 if: Any placeholder assertion found, OR any test.skip found, OR mock
  ratio > 30%, OR mutation score < 60% (when Stryker available)
- Score full if: Zero placeholders, zero skips, mock ratio <= 30%

**Category 3: UI/E2E Verification** (10 pts, or 0 if redistributed)

- If `HAS_UI = false`: Skip (points already redistributed to Cat 1 & 2)
- If `HAS_UI = true`: Check for Playwright/Cypress test files that exercise real
  rendering. Score 0 if no real UI tests exist.

**Category 4: Security Posture** (10 pts)

- Input: validation-security agent report
- Score 0 if: Any Red finding from security agent
- Score full if: No Red or Yellow findings

**Category 5: Integration Reality** (10 pts)

- Input: validation-integration agent report
- Score 0 if: Any contract violation, OR critical boundary with zero tests
- Score full if: All contracts satisfied, integration tests use real deps

**Category 6: Error Path Coverage** (10 pts)

- Input: validation-correctness agent (error paths) + validation-standards agent
  (empty catch blocks)
- Score 0 if: Empty catch blocks found, OR public functions lack error path
  tests
- Score full if: Error paths tested, catch blocks handle errors properly

**Category 7: Architecture Compliance** (10 pts)

- Input: validation-standards agent report (architecture section)
- Score 0 if: File structure deviates from plan.md without justification
- Score full if: All files in expected locations, patterns followed

**Category 8: Performance Baseline** (5 pts)

- Input: validation-performance agent report
- Score 0 if: Sync I/O in async paths, OR complexity > 12, OR unbounded loops
- Score full if: No blocking performance findings

**Category 9: Code Hygiene** (10 pts)

- Input: validation-standards agent report (hygiene section) + slop detection
- Score 0 if: TODO placeholders in production code, OR > 5 redundant comments,
  OR silent error swallowing found
- Score full if: Clean code, no slop findings above Gray

**Category 10: Specification Traceability** (5 pts)

- Input: validation-correctness agent (criteria mapping)
- Score 0 if: User stories cannot be traced to tests and code
- Score full if: Every US has tests, every test maps to implementing code

### Calculate Total Score

```
TOTAL = Cat1 + Cat2 + Cat3 + ... + Cat10
```

Must equal 100 to PASS.

---

## Step 8: Generate Validation Report

Write to `{FEATURE_DIR}/validation-report.md`:

```markdown
---
feature: [Feature Name]
validated: [ISO timestamp]
validator: Claude
status: [PASS/FAIL]
score: [N]/100
iteration: [N]
has_ui: [true/false]
---

# Validation Report: [Feature Name]

## Rubric Score

| #   | Category                   | Points  | Score      | Status          | Evidence  |
| --- | -------------------------- | ------- | ---------- | --------------- | --------- |
| 1   | Functional Correctness     | [15/20] | [0/15/20]  | PASS/FAIL       | [summary] |
| 2   | Test Authenticity          | [15/20] | [0/15/20]  | PASS/FAIL       | [summary] |
| 3   | UI/E2E Verification        | [10/0]  | [0/10/N/A] | PASS/FAIL/SKIP  | [summary] |
| 4   | Security Posture           | 10      | [0/10]     | PASS/FAIL       | [summary] |
| 5   | Integration Reality        | 10      | [0/10]     | PASS/FAIL       | [summary] |
| 6   | Error Path Coverage        | 10      | [0/10]     | PASS/FAIL       | [summary] |
| 7   | Architecture Compliance    | 10      | [0/10]     | PASS/FAIL       | [summary] |
| 8   | Performance Baseline       | 5       | [0/5]      | PASS/FAIL       | [summary] |
| 9   | Code Hygiene               | 10      | [0/10]     | PASS/FAIL       | [summary] |
| 10  | Specification Traceability | 5       | [0/5]      | PASS/FAIL       | [summary] |
|     | **TOTAL**                  | **100** | **[N]**    | **[PASS/FAIL]** |           |

## Automated Check Results

| Check     | Command       | Result              |
| --------- | ------------- | ------------------- |
| Build     | npm run build | [PASS/FAIL]         |
| Tests     | npm test      | [PASS/FAIL]         |
| Lint      | npm run lint  | [PASS/FAIL + count] |
| TypeCheck | tsc --noEmit  | [PASS/FAIL]         |

## Mutation Testing

- **Stryker available**: [Yes/No]
- **Mutation score**: [N]% (target: >= 60%)

## Mock Ratio Analysis

- **Total mock calls**: [N]
- **Total real assertions**: [N]
- **Mock ratio**: [N]% (target: <= 30%)
- **Justified mocks excluded**: [N]

### Worst Offenders by File

| File   | Mocks | Assertions | Ratio | Status  |
| ------ | ----- | ---------- | ----- | ------- |
| [file] | [N]   | [N]        | [N]%  | OK/FAIL |

## Specialist Agent Findings

### Red (Blocking)

| #   | Category   | Finding       | File   | Line   |
| --- | ---------- | ------------- | ------ | ------ |
| [N] | [category] | [description] | [file] | [line] |

### Yellow (Must Address)

| #   | Category   | Finding       | File   | Line   |
| --- | ---------- | ------------- | ------ | ------ |
| [N] | [category] | [description] | [file] | [line] |

### Gray (Informational)

| #   | Category   | Finding       | File   | Line   |
| --- | ---------- | ------------- | ------ | ------ |
| [N] | [category] | [description] | [file] | [line] |

## AI Slop Detection Summary

| Pattern                      | Count | Severity |
| ---------------------------- | ----- | -------- |
| Placeholder assertions       | [N]   | Red      |
| Skipped tests                | [N]   | Red      |
| TODO/FIXME placeholders      | [N]   | Yellow   |
| Empty catch blocks           | [N]   | Yellow   |
| Redundant comments           | [N]   | Yellow   |
| Over-engineered abstractions | [N]   | Gray     |
| Magic numbers                | [N]   | Gray     |

## Spec Compliance

### [US1 Name]

- [x/] Acceptance criterion 1
- [x/] Acceptance criterion 2

### [US2 Name]

- [x/] Acceptance criterion 1

## Recommendations

### Before Merge (Must Fix)

- [Red and Yellow findings requiring action]

### Future Improvements (Informational)

- [Gray findings and suggestions]
```

---

## Step 9: Determine Outcome

### If TOTAL = 100: PASS

```
════════════════════════════════════════════════════════════════
  VALIDATION PASSED: [Feature Name]
════════════════════════════════════════════════════════════════

  Score: 100/100

  Rubric:
  ✓ Functional Correctness    [15/20]/[15/20]
  ✓ Test Authenticity          [15/20]/[15/20]
  ✓ UI/E2E Verification        [10/10 or N/A]
  ✓ Security Posture           10/10
  ✓ Integration Reality        10/10
  ✓ Error Path Coverage        10/10
  ✓ Architecture Compliance    10/10
  ✓ Performance Baseline       5/5
  ✓ Code Hygiene               10/10
  ✓ Specification Traceability 5/5

  Report: {FEATURE_DIR}/validation-report.md

════════════════════════════════════════════════════════════════
```

Proceed to **Step 12: Attribution Logging** then **Step 13: Memory Update
Check**.

## Next Steps (Manual Chaining — Copilot Chat)

After completing validation with a PASS, run the engineering review stage:

```
/6a_gofer_engineering_review
```

This performs post-implementation cross-checking with iterative fix cycles.

### If TOTAL < 100: FAIL

Proceed to **Step 10: Brownfield Restart**.

---

## Step 10: Brownfield Restart Loop

When validation fails (score < 100), generate a remediation report and signal
the orchestrator to restart the pipeline focused on failed areas.

### 10.1 Check Iteration Count

- If `ITERATION >= 3`: Generate **escalation report** instead (see 10.4)
- If `ITERATION < 3`: Generate **remediation report** and signal restart

### 10.2 Generate Remediation Report

Write to `{FEATURE_DIR}/remediation-report.md`:

```markdown
---
feature: [Feature Name]
iteration: [N]
score: [N]/100
generated: [ISO timestamp]
failed_categories: [list]
---

# Remediation Report: [Feature Name]

## Iteration [N] of 3

**Score**: [N]/100 **Status**: FAIL — Remediation Required

## Failed Categories

### [Category Name] (0/[points])

**Evidence**: [Specific findings from agent reports]

**Required Actions**:

1. [Specific action to fix this category]
2. [Another specific action]

**Files to modify**:

- `path/to/file.ts:line` — [what to change]

### [Next Failed Category]

...

## Remediation Scope

The following pipeline stages should re-run focused on these areas:

- **Research**: [Any new research needed, or "Not needed"]
- **Plan**: [Any plan updates, or "Not needed"]
- **Implement**: [Specific tasks to re-implement]
- **Validate**: Re-run after fixes

## Previous Iterations

| Iteration | Score   | Failed Categories | Date   |
| --------- | ------- | ----------------- | ------ |
| 1         | [N]/100 | [list]            | [date] |
| 2         | [N]/100 | [list]            | [date] |
```

### 10.3 Signal Orchestrator

Output the routing instruction:

```
════════════════════════════════════════════════════════════════
  VALIDATION FAILED: [Feature Name]
════════════════════════════════════════════════════════════════

  Score: [N]/100
  Iteration: [N] of 3

  Failed categories:
  ✗ [Category] — 0/[points]: [brief reason]
  ✗ [Category] — 0/[points]: [brief reason]

  Remediation report: {FEATURE_DIR}/remediation-report.md

  REMEDIATION REQUIRED: [feature-name]
  Failed categories: [list]
  Iteration: [N] of 3
  Route: /5_gofer_implement → focused on [failed areas]

════════════════════════════════════════════════════════════════
```

Then proceed to **Step 11: Attribution Logging**.

### 10.4 Escalation (Iteration 3 Failure)

If this is the 3rd iteration and validation still fails, generate
`{FEATURE_DIR}/escalation-report.md`:

```markdown
---
feature: [Feature Name]
iteration: 3
final_score: [N]/100
escalated: [ISO timestamp]
---

# Escalation Report: [Feature Name]

## Human Review Required

After 3 remediation attempts, the following categories still fail:

### [Category] — All 3 attempts failed

**Iteration history**:

1. Score [N] — [what was tried]
2. Score [N] — [what was tried]
3. Score [N] — [what was tried]

**Root cause assessment**: [Why automated remediation isn't working]

**Recommended human action**: [What a developer should do]

## Full Score History

| Iteration | Total | Cat1 | Cat2 | Cat3 | Cat4 | Cat5 | Cat6 | Cat7 | Cat8 | Cat9 | Cat10 |
| --------- | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- |
| 1         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   |
| 2         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   |
| 3         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   |
```

Output:

```
════════════════════════════════════════════════════════════════
  ESCALATION: [Feature Name]
════════════════════════════════════════════════════════════════

  After 3 remediation attempts, validation still fails.
  Score: [N]/100

  Escalation report: {FEATURE_DIR}/escalation-report.md

  This feature requires human review before proceeding.
  The automated pipeline cannot resolve the remaining issues.

════════════════════════════════════════════════════════════════
```

---

## Step 11: Attribution Logging

Log every finding to `.specify/logs/validation-findings.jsonl`.

### Finding Format

For each finding from all agents and automated checks, append a JSON line:

```json
{
  "finding_id": "F[NNN]",
  "timestamp": "[ISO timestamp]",
  "feature": "[feature-name]",
  "category": "[rubric_category_snake_case]",
  "severity": "[red|yellow|gray]",
  "description": "[finding description]",
  "file": "[file path]",
  "line": [line number or null],
  "agent": "[agent name or 'automated']",
  "resolution": null,
  "iteration": [N]
}
```

### Categories for `category` field

- `functional_correctness`
- `test_authenticity`
- `ui_e2e_verification`
- `security_posture`
- `integration_reality`
- `error_path_coverage`
- `architecture_compliance`
- `performance_baseline`
- `code_hygiene`
- `specification_traceability`

### Log Summary Entry

After all findings, append a summary entry:

```json
{
  "finding_id": "SUMMARY",
  "timestamp": "[ISO timestamp]",
  "feature": "[feature-name]",
  "category": "summary",
  "severity": "info",
  "description": "Validation score: [N]/100. Categories failed: [list or 'none']",
  "file": null,
  "line": null,
  "agent": "rubric",
  "resolution": "[PASS|FAIL|ESCALATED]",
  "iteration": [N]
}
```

### Historical Reference

Before logging, read existing entries in `validation-findings.jsonl` for the
same feature. If the same finding (same file, same line, same category) appears
in a previous iteration, note it as a **repeat finding** in the description:

```
"description": "[REPEAT from iteration 1] expect(true).toBe(true) still present"
```

This enables tracking of findings that persist across remediation attempts.

---

## Step 12: Memory Update Check

After validation, assess whether learnings should be persisted.

### 12.1 Memory Update Decision Matrix

| Learning Type                | Update Location              | When to Update                            |
| ---------------------------- | ---------------------------- | ----------------------------------------- |
| **Project-wide patterns**    | `CLAUDE.md`                  | New conventions affecting all future work |
| **Architectural decisions**  | `.specify/memory/decisions/` | Significant design choices with rationale |
| **Feature-specific context** | `{FEATURE_DIR}/research.md`  | Discoveries relevant only to this feature |
| **Reusable code patterns**   | `CLAUDE.md` or constitution  | Patterns other features should follow     |
| **Bug workarounds**          | `.specify/memory/decisions/` | Issues that may recur                     |

### 12.2 CLAUDE.md Update Criteria

**DO update CLAUDE.md when**:

- Discovered a new coding convention used across the codebase
- Identified a critical dependency or integration pattern
- Found a gotcha that affects multiple features
- Established a new testing or build pattern

**DO NOT update CLAUDE.md when**:

- Learning is specific to one feature
- Information will become stale quickly
- Pattern is already documented elsewhere
- Change is experimental/temporary

### 12.3 Memory Update Checklist

Before completing validation, verify:

- [ ] Any project-wide patterns discovered -> added to CLAUDE.md?
- [ ] Any significant decisions made -> recorded in decisions/?
- [ ] Any gotchas or workarounds -> documented for future reference?
- [ ] Feature-specific learnings -> captured in research.md?

---

## LLM Council Integration (Optional)

When council mode is enabled for `gofer_validate` stage:

1. Multiple LLMs review the implementation independently
2. Each provider scores the rubric from their perspective
3. Chairman synthesizes scores — uses the **lowest** score for each category
   (conservative approach)
4. Highlights consensus issues (high confidence)
5. Notes divergent assessments needing human judgment
6. Usage logged to `.specify/logs/council-usage.jsonl`

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 6_validate --complete --tokens [N] --compactions [N]
```

This also logs quality metrics (rubric scores, finding counts) to:
`.specify/logs/quality-metrics.jsonl`

---

## Key Rules

- **100/100 is the only passing score** — there is no "close enough"
- **Agents run in parallel** — spawn all 6 at once, do not serialize
- **Red findings block** — any Red finding in any agent zeroes that category
- **Mutation testing is optional** — gracefully degrade when Stryker absent
- **Mock ratio excludes justified mocks** — mark with `// mock-justified:`
  comment
- **Attribution logging is mandatory** — every finding gets logged to JSONL
- **Maximum 3 remediation iterations** — then escalate to human
- **Be specific** — cite file paths and line numbers for all findings
- **Score the rubric honestly** — the goal is to catch real problems, not to
  pass
- Log stage completion for observability tracking
