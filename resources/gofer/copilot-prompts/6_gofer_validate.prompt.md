---
name: 6_gofer_validate
description: Validate implemented work with evidence-backed scoring, blast-radius analysis, and engineering review.
agent: copilot-workspace
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebSearch
argument-hint: feature-name-or-description
gofer:
  workflowProfile: enterpriseai
  canonicalSource: .specify/commands/6_gofer_validate.md
  canonicalChecksum: 08cf2940efd1d871a1a4c161a16fd559eccceba52b6a78099e8a87d40ec4827e
  metadataSource: scripts/generate-commands.ts
---


# Gofer Validate

You are validating that the implementation meets engineering quality standards
across **three phases**:

- **Phase A — Rubric Validation**: 10-category engineering rubric scored only
  from real evidence (Categories 1-10, up to 100 points)
- **Phase B — Blast Radius Analysis**: risk to other code, interface contracts,
  error logging/observability, submodule and repo-wide impact, dependency risk,
  rollback readiness, release-checklist compliance (Category 11, 10 points)
- **Phase C — Engineering Review Loop**: iterative review-fix cycles (up to 5)
  to catch issues rubric-based validation might miss

This is the **sixth stage** of the unified Gofer pipeline. It consolidates the
former `#6_gofer_validate` and `#6a_gofer_engineering_review` stages into a
single command; `#6a_gofer_engineering_review` is retained as a
backwards-compatibility stub that delegates here.

A score of **110/110 on the rubric (Phases A + B) is required to pass**. Any
rubric category scoring 0 triggers failure and a brownfield restart loop. Phase
C then runs 1-5 iterative review-fix cycles until all Red/Yellow findings are
resolved or 5 cycles complete.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from #1_gofer_research)
- `spec.md` - Feature specification (from #2_gofer_specify)
- `plan.md` - Implementation plan (from #3_gofer_plan)
- `tasks.md` - Task breakdown (from #4_gofer_tasks)
- Implemented code (from #5_gofer_implement)

---

## Outline

1. Context health check
2. Load implementation context
3. **Phase A** — Spawn 6 specialist rubric validation agents in parallel
4. Evidence gate pre-check and pending-gate tracking
5. **Phase B** — Spawn 5 blast-radius analysis agents in parallel
6. Blast-radius synthesis (change graph, interface diff, observability,
    dependency/submodule impact, rollback readiness, release checklist)
7. Run automated checks (build, test, lint, typecheck)
8. Mutation testing gate
9. Mock ratio analysis
10. Semantic slop detection
11. Score the 11-category rubric (110 points)
12. Generate enhanced validation report + blast-radius report
13. Determine rubric PASS/FAIL outcome
14. Brownfield restart on failure
15. **Phase C** — Engineering review loop (3 agents × up to 5 cycles with
    auto-fix)
16. Generate engineering review report
17. Attribution logging to JSONL
18. Memory update check

---

## Execution Strategy by Platform

| Platform                               | Validation Execution Strategy                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Claude Code CLI                        | Run all validation agents in parallel using the Task tool                                     |
| GitHub Copilot Chat (2026+)            | Use multi-agent delegation to run validation in parallel                                      |
| GitHub Copilot Chat (2025 and earlier) | Run validation checks sequentially using the **Legacy Workflow** in `docs/legacy-workflow.md` |

For pre-2026 Copilot environments, execute the validation phases
**sequentially** instead of parallel spawning.

---

## The Engineering Quality Rubric

### 11-Category Scoring (110 Points)

| #   | Category                     | Points | Pass Criteria                                                                                                                                                                          | Agent                                                                                                                      |
| --- | ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Functional Correctness       | 15     | Every acceptance criterion in spec.md has a passing test exercising real code                                                                                                          | validation-correctness                                                                                                     |
| 2   | Test Authenticity            | 15     | Zero skips, zero placeholders, zero mock-only assertions. Mutation score >= 60% if Stryker available                                                                                   | validation-test-quality                                                                                                    |
| 3   | UI/E2E Verification          | 10     | If feature has UI: real rendering tests pass. If no UI: points redistribute                                                                                                            | N/A (automated check)                                                                                                      |
| 4   | Security Posture             | 10     | Zero hardcoded secrets, no disabled security features, no client-side keys                                                                                                             | validation-security                                                                                                        |
| 5   | Integration Reality          | 10     | Integration tests use real dependencies where possible. Contract tests validate boundaries                                                                                             | validation-integration                                                                                                     |
| 6   | Error Path Coverage          | 10     | Public functions tested for failure modes. No empty catch blocks                                                                                                                       | validation-correctness + validation-standards                                                                              |
| 7   | Architecture Compliance      | 10     | File structure and patterns match plan.md and research.md                                                                                                                              | validation-standards                                                                                                       |
| 8   | Performance Baseline         | 5      | No synchronous I/O in async paths, no unbounded loops, no N+1 patterns                                                                                                                 | validation-performance                                                                                                     |
| 9   | Code Hygiene                 | 10     | Zero AI slop: no TODO placeholders, no redundant comments, no magic numbers                                                                                                            | validation-standards                                                                                                       |
| 10  | Specification Traceability   | 5      | Every user story maps to tests, every test maps to code                                                                                                                                | validation-correctness                                                                                                     |
| 11  | **Blast Radius Containment** | 10     | No unmitigated breaking API changes, full-surface consumer/import audit, new error paths log, no new High/Critical CVEs, rollback/feature-flag path exists, release checklist complete | codebase-analyzer + validation-integration + validation-standards + research-dependency-evaluator + tasks-rollback-planner |

### Point Redistribution (No-UI Features)

When a feature has **no UI component** (no web pages, no frontend, no visual
interface), the 10 points from UI/E2E Verification are redistributed:

- **+5 to Functional Correctness** (total: 20 points)
- **+5 to Test Authenticity** (total: 20 points)

Total remains **110/110** across all 11 categories.

**Detection**: Check plan.md tech stack. If no UI framework (React, Vue,
Angular, Svelte) and no Playwright/Cypress tests exist, this is a no-UI feature.

### Scoring Rules

- Each category scores **full points** or **0**. There is no partial credit.
- A category scores 0 if its agent reports any **Red (blocking)** finding.
- A category scores 0 if its automated check fails.
- **Total score** = sum of all category scores (max **110**, was 100).
- **PASS** = 110/110. Anything less = FAIL.
- Legacy consumers reading `status: PASS` / `score: 100` from historical reports
  should migrate to the 110-point scale. The report keeps the `score` field as
  the numerator and `score_max` to disambiguate.

**Honest-scoring rule (FR-012)**: If an agent reports `EVIDENCE ABSENT:`, the
orchestrating stage MUST score that category 0 regardless of other findings.
Phrases like `likely correct`, `appears wired`, or `should be passing` are NOT
evidence and MUST NOT contribute to any score. Any rubric category where
evidence is absent, unverifiable, fabricated, or implied scores exactly 0 — no
partial credit.

---

## Step 0: Context Health Check

Before starting validation, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Use sub-agents heavily, minimize main context
- If **> 70%**: Run `#7_gofer_save`, start new session, run `#8_gofer_resume`

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

**Deployment/Render Scope Detection** (FR-011):

Scan `spec.md`, `plan.md`, `contract-pack.md`, and `quickstart.md` (when
present) for the following signals:

- `DEPLOY_SIGNAL_1`: any acceptance criterion contains: `rendered`,
  `live route`, `live API`, `deployed`, `production`, `staging`,
  `SharePoint`, `Azure`, `smoke`, `E2E`, `browser`
- `DEPLOY_SIGNAL_2`: `plan.md`, `contract-pack.md`, or `quickstart.md`
  names a deployment target: SharePoint, Azure, staging, production, Vercel,
  Netlify, Docker, Kubernetes, or any server/environment referenced in the
  acceptance chain
- `DEPLOY_SIGNAL_3`: `plan.md` declares a UI/rendered experience AND at least
  one acceptance criterion uses: `sees`, `displays`, `shows`, `renders`,
  `navigates to`

Set `DEPLOY_IN_SCOPE = true` if ANY signal is present.
Set `DEPLOY_IN_SCOPE = false` if NO signal is present.
Record the determination in the validation report preamble.

---

# Phase A — Rubric Validation

Phase A runs the 10-category engineering rubric (Categories 1-10, up to 100
points before Category 11 is added).

## Step 2: Spawn 6 Specialist Validation Agents

**CRITICAL**: You **MUST** launch all 6 agents **in parallel** using the Task
tool. Do NOT perform validation work inline in the main context. The main
context should only orchestrate, score the rubric, and review agent outputs.
Each agent receives the feature context and returns structured findings.

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
with the core agents.

## Step 2.2: Evidence Gate Pre-Check

Evaluate the truthfulness gates before final scoring. If a gate is still
pending here, re-check it after Step 3 automated checks complete and before the
PASS/FAIL synthesis.

```
GATE-1 (Integration Proof — Category 5):
  Require: runtime wiring artifact OR integration-test execution output
  present in the current session context by final scoring time.
  If absent during Step 2.2, record GATE-1 as pending and re-check it after
  Step 3 automated checks complete.
  Still absent after Step 3 → Category 5 score = 0; mark GATE_FAIL = true

GATE-2 (Test Execution — Categories 1 and 2):
  Require: real, executed npm test output with pass/fail count already present
  or produced by Step 3 automated checks before final scoring.
  If absent during Step 2.2, record GATE-2 as pending and re-check it after
  Step 3 automated checks complete.
  Still absent after Step 3 → Categories 1 and 2 score = 0; mark GATE_FAIL = true

GATE-3 (Render/Deployment Proof — Category 3):
  IF HAS_UI = false:
    Record "N/A — HAS_UI=false" in evidence table.
    Record a matching not-in-scope reason in `Absent / Reason for 0`.
    Apply existing no-UI point redistribution.
  IF HAS_UI = true AND DEPLOY_IN_SCOPE = false:
    Require: local render proof (screenshot, component render assertion,
    headless browser assertion, or local smoke-check output) present by final
    scoring time.
    If absent during Step 2.2, record GATE-3 as pending and re-check before
    final PASS/FAIL synthesis.
    Still absent → Category 3 score = 0; mark GATE_FAIL = true
    If present, record "Render proof only — deployment target not in scope" in
    the evidence table and do not redistribute Category 3 points.
  IF HAS_UI = true AND DEPLOY_IN_SCOPE = true:
    Require: screenshot, curl/HTTP transcript, deployment log, headless browser
    assertion, or smoke-check output present by final scoring time, with at
    least one artifact proving rendered/live behavior on the declared route or
    deployment target.
    If absent during Step 2.2, record GATE-3 as pending and re-check before
    final PASS/FAIL synthesis.
    Still absent → Category 3 score = 0; mark GATE_FAIL = true

If any GATE_FAIL = true:
  - Any agent that would have scored the gated category is still run
  - The category score remains 0 unless the missing evidence appears before
    final scoring
```

Collect all results before proceeding.

---

# Phase B — Blast Radius Analysis

Phase B quantifies the **ripple effect** of the implementation. It assesses risk
to code outside the feature boundary, interface-contract stability,
observability preservation, dependency / submodule impact, rollback readiness,
and release-checklist compliance. Phase B results score **Category 11 (10
points)** and produce a separate `blast-radius-report.md` artifact.

Phase B runs **after** Phase A agents have returned (Step 2 complete) and
**before** automated checks in Step 3, because breaking-change detection informs
how to interpret failing tests/types.

## Step 2.5: Pre-Flight Change Surface Discovery

Before spawning Phase B agents, build a **change manifest** the agents can
reference. This is a cheap main-context pass, not an agent task.

1. **Modified file list** — from `tasks.md` completed tasks and git:

   ```bash
   git diff --name-only $(git merge-base HEAD main 2>/dev/null || echo HEAD~1) HEAD
   ```

2. **Submodule inventory** — detect repo submodules and workspace packages:

   ```bash
   git submodule status 2>/dev/null
   cat package.json 2>/dev/null | grep -E '"workspaces"' -A 20
   ls -d */package.json 2>/dev/null | xargs -I {} dirname {}
   ```

   Record which submodules/workspaces contain modified files. For this repo the
   canonical submodules are `extension/`, `language-server/`, `docs/`.

3. **Public-surface detection** — identify exported symbols at risk:
   - `index.ts` / `index.js` files in modified directories
   - `*.d.ts` files in modified directories
   - Entries in the `exports` / `main` / `types` fields of modified
     `package.json` files
   - Files under `contracts/` or `.specify/specs/{feature}/contracts/`

4. **Dependency manifest diff** — capture dependency churn:

   ```bash
   git diff $(git merge-base HEAD main 2>/dev/null || echo HEAD~1) HEAD -- package.json package-lock.json extension/package.json language-server/package.json 2>/dev/null
   ```

5. **Rollback-relevant assets** — flag anything that needs a reverse path:
   - Files under `migrations/`, `db/migrations/`, `prisma/migrations/`
   - Files named `*.sql`, `schema.*`
   - Feature-flag definitions (search for `featureFlag`, `growthbook`,
     `launchdarkly`, `flags.`)
   - `CHANGELOG.md`, `RELEASES.md`, version fields in `package.json`

Record these into `CHANGE_MANIFEST` for the Phase B prompts.

---

## Step 2.6: Spawn 5 Blast-Radius Analysis Agents

Launch all 5 agents **in parallel** using the Task tool. Pass the
`CHANGE_MANIFEST` from Step 2.5 into each prompt so agents see the same ground
truth.

### Agent 8: Change Graph / Ripple Analyzer

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Blast-radius change-graph analysis for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Change manifest (modified files): {CHANGE_MANIFEST.modifiedFiles}
Submodules: {CHANGE_MANIFEST.submodules}

Build a change-graph table for EVERY modified symbol (function, class, type,
const) in the modified files:
1. List every direct importer/caller (file:line references).
2. Classify each as Direct (imports the symbol) or Transitive (imports a
   re-export of it) or Runtime (dynamic require / reflection).
3. Flag any cross-submodule ripple (symbol defined in submodule A, consumed
   in submodule B) — this is Red if unplanned.
4. Flag any consumer whose tests do NOT exercise the changed code path —
   Yellow.
5. Count orphan changes (modified code with zero importers) — Gray.

Return findings with Red/Yellow/Gray severity and a concise ripple summary
(<2500 tokens). Output sections: 'Ripple Summary', 'Cross-submodule Crossings',
'Consumer Coverage Gaps', 'Orphans'."
```

### Agent 9: Interface Contract Diff

```
Task: subagent_type="validation-integration", model="sonnet"
Prompt: "Interface contract blast-radius analysis for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Public-surface manifest: {CHANGE_MANIFEST.publicSurface}
Contracts directory: {FEATURE_DIR}/contracts (if present)

For every public export, package.json exports field entry, contract file,
and .d.ts symbol that was modified, deleted, or added:
1. Diff old signature vs new signature (parameters, return types, generics,
   optional vs required, default values).
2. Classify each change:
   - BREAKING: removed export, renamed export, narrowed return type, widened
     required-param set, removed optional param callers rely on.
   - ADDITIVE: new export, new optional param, widened return type.
   - NEUTRAL: implementation change with identical signature.
3. Red = any BREAKING change without a corresponding entry in CHANGELOG.md
   or a migration note in the spec.
4. Yellow = BREAKING change with CHANGELOG entry but no migration guide.
5. Gray = ADDITIVE changes for informational tracking.

Verify contract tests still cover all pre-existing contract clauses (no
silent coverage regression). Return findings (<2000 tokens) with sections:
'Breaking Changes', 'Additive Changes', 'Contract Coverage Regression'."
```

### Agent 10: Error Logging & Observability Integrity

```
Task: subagent_type="validation-standards", model="sonnet"
Prompt: "Observability blast-radius analysis for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Modified files: {CHANGE_MANIFEST.modifiedFiles}

Assess whether observability was preserved, degraded, or improved:
1. For every new/modified catch block: does it log? Use the same structured
   logger used elsewhere in the repo (detect the logger by scanning for
   common imports: winston, pino, bunyan, console, vscode.window.showError,
   telemetry module). Red if any catch swallows silently in production code.
2. For every removed log statement: is removal justified by a comment or
   spec? Red if production-relevant logs disappeared without justification.
3. Log-level hygiene: no `console.log` in production code (test files
   exempt); no debug-level logs left at info/warn level.
4. PII / secrets leakage in new log messages — Red if detected.
5. Telemetry/metrics coverage: if the feature touched hot paths that
   previously emitted metrics, verify emission is preserved.
6. Correlation IDs / trace context propagation: if the repo uses them,
   verify new code paths propagate them.

Return findings (<2000 tokens) with sections: 'Silent Failures', 'Removed
Logs', 'PII Risk', 'Metric Coverage Delta', 'Trace Propagation'."
```

### Agent 11: Dependency & Submodule Impact (with npm audit delta)

```
Task: subagent_type="research-dependency-evaluator", model="sonnet"
Prompt: "Dependency and submodule blast-radius analysis for feature
[FEATURE_NAME].

Dependency manifest diff: {CHANGE_MANIFEST.dependencyDiff}
Submodules affected: {CHANGE_MANIFEST.submodules}

1. New dependencies: list each with source (npm / git / local), license, and
   bundle-size impact (approx). Red if license is incompatible (GPL/AGPL in
   a permissive-licensed repo), or if the package is unmaintained (>2 years
   since last release, <1000 weekly downloads).
2. Version bumps: classify as major / minor / patch. Red for major bumps
   without migration notes.
3. Lockfile churn: if package.json is unchanged but package-lock.json
   changed materially (>20 lines), flag as Yellow (indirect dep drift).
4. npm audit delta: run `npm audit --json 2>/dev/null` on the current branch
   and compare vulnerability counts vs baseline (main). Red if the branch
   adds any new High or Critical CVE. Yellow for new Moderate. Gray for new
   Low.
5. Submodule boundary crossings: if the feature modifies code in multiple
   submodules (extension/, language-server/, docs/), verify each submodule
   independently builds and tests. Red if a cross-submodule change breaks
   any submodule's standalone build.

Return findings (<2500 tokens) with sections: 'New Dependencies', 'Version
Bumps', 'Lockfile Drift', 'CVE Delta', 'Submodule Boundary Crossings'."
```

### Agent 12: Rollback Readiness & Release Checklist

```
Task: subagent_type="tasks-rollback-planner", model="sonnet"
Prompt: "Rollback readiness + release-checklist review for feature
[FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Rollback assets: {CHANGE_MANIFEST.rollbackAssets}

Assess reversibility and release readiness:
1. DB migrations: is every forward migration paired with a down/reverse
   migration? Red if any irreversible migration lacks explicit justification
   in the spec or plan.
2. Feature flags: if the feature is risky, is it gated behind a flag? Is the
   flag default-off? Is the pre-flag code path preserved so disabling the
   flag restores prior behavior? Red if a risky change is unflagged and
   irreversible.
3. Data-shape changes: detect schema changes that cannot be rolled back
   without data loss (column drops, type narrowings). Red if no backfill or
   dual-write strategy.
4. Release checklist for user-visible changes:
   - CHANGELOG.md updated for this feature — Red if missing and feature is
     user-visible.
   - Version bump planned (semver correct for breaking/additive/patch) — Red
     if breaking change present without major bump plan.
   - Migration guide present for breaking changes — Red if missing.
   - Documentation updated (docs/ or README.md) for new user-facing
     capabilities — Yellow if missing.
5. Rollback runbook: is there a documented 'how to revert' path? Yellow if
   absent for non-trivial changes.

Return findings (<2000 tokens) with sections: 'Migration Reversibility',
'Feature Flag Coverage', 'Data-Shape Rollback Risk', 'Release Checklist',
'Rollback Runbook'."
```

**Run all 5 Phase B agents in parallel.** Collect results before synthesis.

---

## Step 2.7: Blast Radius Synthesis

Aggregate Phase B agent findings into a single blast-radius verdict.

### Consolidated Finding Table

```
| # | Dimension | Finding | Severity | Agent | File | Line |
|---|-----------|---------|----------|-------|------|------|
| 1 | Change graph | [desc] | Red | codebase-analyzer | [file] | [line] |
| 2 | Interface contract | [desc] | Red | validation-integration | [file] | [line] |
| 3 | Observability | [desc] | Yellow | validation-standards | [file] | [line] |
| 4 | Dependency | [desc] | Yellow | research-dependency-evaluator | [file] | [line] |
| 5 | Rollback | [desc] | Red | tasks-rollback-planner | [file] | [line] |
```

### Severity Rollup

```
BLAST_RADIUS_RED = count of Red findings across all 5 agents
BLAST_RADIUS_YELLOW = count of Yellow findings
BLAST_RADIUS_GRAY = count of Gray findings
```

### Write `blast-radius-report.md`

Write to `{FEATURE_DIR}/blast-radius-report.md`:

```markdown
---
feature: [Feature Name]
generated: [ISO timestamp]
reviewer: Claude
GeneratedAt: [ISO timestamp]
SourceCommandId: /6_gofer_validate
SourceInputs: [spec.md, plan.md, tasks.md, research.md, blast-radius inputs]
OverwriteNoticeWhenApplicable: [new file or overwrite note]
dimensions_checked:
  [
    change_graph,
    interface_contract,
    observability,
    dependency_submodule,
    rollback_release,
  ]
red_count: [N]
yellow_count: [N]
gray_count: [N]
verdict: [CONTAINED | BREACHED]
---

# Blast Radius Report: [Feature Name]

## Changed Surfaces

- Modified files: [N]
- Submodules touched: [list]
- Public-surface symbols affected: [N]
- New dependencies: [N]
- Version bumps: [list]
- Migration files: [list]
- Feature flags introduced/modified: [list]

## Risk Vectors

### 1. Change Graph / Ripple (Agent: codebase-analyzer)

- Cross-submodule crossings: [list or "none"]
- Consumer coverage gaps: [N]
- Orphan changes: [N]
- Red findings: [table]

### 2. Interface Contracts (Agent: validation-integration)

- Breaking changes: [N] ([list])
- Additive changes: [N]
- Contract coverage regressions: [list]
- Red findings: [table]

### 3. Error Logging & Observability (Agent: validation-standards)

- Silent failures introduced: [N]
- Logs removed without justification: [N]
- PII/secret leakage risk: [list]
- Metric/trace coverage delta: [summary]
- Red findings: [table]

### 4. Dependencies & Submodules (Agent: research-dependency-evaluator)

- New dependencies: [table with license/size/maintenance]
- Version bumps: [list]
- Lockfile drift: [summary]
- CVE delta: Critical +[N], High +[N], Moderate +[N], Low +[N]
- Submodule boundary crossings: [list]
- Red findings: [table]

### 5. Rollback Readiness & Release Checklist (Agent: tasks-rollback-planner)

- Migration reversibility: [OK / BREACHED]
- Feature flag coverage: [OK / BREACHED / N/A]
- Data-shape rollback risk: [OK / BREACHED]
- Release checklist:
  - CHANGELOG updated: [Yes / No / N/A]
  - Version bump planned: [patch / minor / major / N/A]
  - Migration guide: [Yes / No / N/A]
  - Docs updated: [Yes / No / N/A]
- Rollback runbook: [Present / Absent / N/A]
- Red findings: [table]

## Containment Summary

- **CONTAINED** if `BLAST_RADIUS_RED == 0` — Category 11 scores full 10 pts.
- **BREACHED** if `BLAST_RADIUS_RED > 0` — Category 11 scores 0.

Yellow findings do NOT fail Category 11 but are reported to the engineering
review loop (Phase C) for mandatory attention.
```

Proceed to Step 3 (automated checks) with blast-radius results attached to the
context.

---

# End of Phase B

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

- Input: validation-correctness agent report + `GATE-2` + automated test results
- Score 0 if: `GATE-2` fails, OR any Red finding from correctness agent, OR
  build/tests fail, OR tests fail to import
- Score full if: All acceptance criteria verified with real tests

**Category 2: Test Authenticity** ({15 or 20 if no UI} pts)

- Input: validation-test-quality agent report + `GATE-2` + mutation score +
  mock ratio
- Score 0 if: Any placeholder assertion found, OR any test.skip found, OR mock
  ratio > 30%, OR mutation score < 60% (when Stryker available), OR
  `GATE-2` fails
- Score full if: Zero placeholders, zero skips, mock ratio <= 30%

**Category 3: UI/E2E Verification** (10 pts, or 0 if redistributed)

- If `HAS_UI = false`: Record `N/A — HAS_UI=false` plus an explicit not-in-scope
  reason in the evidence table and apply the existing no-UI redistribution.
- If `HAS_UI = true` and `DEPLOY_IN_SCOPE = false`: Check `GATE-3` for local
  render proof and record `Render proof only — deployment target not in scope`
  when that proof exists. Score 0 if `GATE-3` fails or no local render proof
  exists. Do not redistribute Category 3 points.
- If `HAS_UI = true` and `DEPLOY_IN_SCOPE = true`: Check `GATE-3` for
  screenshot, curl/HTTP transcript, deployment log, headless browser
  assertion, or smoke-check output with proof of rendered/live behavior on the
  declared route or target. Score 0 if `GATE-3` fails or no real render/deploy
  proof exists.

**Category 4: Security Posture** (10 pts)

- Input: validation-security agent report
- Score 0 if: Any Red finding from security agent
- Score full if: No Red or Yellow findings

**Category 5: Integration Reality** (10 pts)

- Input: validation-integration agent report + `GATE-1`
- Score 0 if: `GATE-1` fails, OR any contract violation, OR critical boundary
  with zero tests
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

**Category 11: Blast Radius Containment** (10 pts) — NEW

- Input: Phase B blast-radius-report.md (Agents 8-12)
- Score 0 if **any** of:
  - `BLAST_RADIUS_RED > 0` (verdict BREACHED in blast-radius-report.md), OR
  - Interface Contract Diff found a BREAKING change without CHANGELOG entry, OR
  - Observability agent found a silent failure in production code, OR
  - Dependency agent reports a new High or Critical CVE, OR
  - Rollback agent reports an irreversible migration without justification, OR
  - Cross-submodule ripple detected that was not planned in plan.md
- Score full (10) if: `BLAST_RADIUS_RED == 0` — verdict CONTAINED in
  blast-radius-report.md. Yellow/Gray findings do not block the category but are
  forwarded to Phase C for attention.

### Calculate Total Score

```
TOTAL = Cat1 + Cat2 + Cat3 + ... + Cat10 + Cat11
```

Must equal **110** to PASS (no-UI features: Cat3 redistributes +5 to Cat1 and +5
to Cat2; total is still 110).

---

## Step 7.4: Two-Pass Canvas Refresh (Impact Canvas)

After the validation council completes, refresh the Impact Canvas with
validation findings. This is a SURGICAL update: only the `topThreeRisks` slot of
`impact-canvas.md` is replaced; all other canvas content (header, problem
statement, personas, AI-leverage pie, outcomes) is preserved byte-for-byte. The
frontmatter `pass:` marker is bumped from 1 to 2 so downstream consumers can
tell which pass produced the artefact.

```
Task: subagent_type="visual-canvas-writer", model="sonnet"
Prompt: "Pass-2 refresh for {FEATURE_DIR}/visuals/impact-canvas.md.
Read validation council output from {FEATURE_DIR}/validation.md.
Replace ONLY the topThreeRisks section with the council's top three risks.
Preserve all other content byte-for-byte.

Use the runPass2() helper at .specify/scripts/node/lib/visual-pass-pipeline.mjs
which implements the surgical replacement (regex-bounded swap of the
'## Top Three Risks' section + frontmatter pass: 1 -> 2 bump).

Return: absolute path of file written and the three risk strings used."
```

The `runPass2()` function in
`.specify/scripts/node/lib/visual-pass-pipeline.mjs` already implements the
surgical replacement; the writer agent only needs to provide the three
council-validated risk strings. This satisfies FR-016 (two-pass canvas refresh)
and the locked decision recorded in `plan.md:912-919`.

---

## Step 7.5: Refresh Risk Heatmap (Persona Pack — US4)

After the rubric is scored and validation council findings are available,
dispatch `visual-risk-writer` in **pass-2 mode** to refresh the risk heatmap
with critical risks identified by the council. This replaces the heuristic
top-quadrant entries that pass-1 (run from this same stage before validation)
populated from the spec NFR / Out-of-Scope sections.

```
Task: subagent_type="visual-risk-writer", model="sonnet"
Prompt: "Pass 2: refresh risk heatmap for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}
Spec: {FEATURE_DIR}/spec.md
Validation council findings: {FEATURE_DIR}/validation-report.md (in-progress)
Existing heatmap (pass-1): {FEATURE_DIR}/visuals/risk-heatmap.md
Template: .specify/templates/visuals/risk-heatmap-template.md

Replace top-quadrant risks with the validation council's critical findings.
Preserve pass-1 risks that did not surface in validation.
Honour ≥30 ≤200 word plain-language preamble (NFR-010).

Return: absolute path of file written and risk counts per quadrant."
```

The validation report (Step 8) MUST link to the refreshed risk heatmap under its
`## Risk Posture` section. If the Mermaid renderer fails for a downstream
consumer, the `mermaid-tabular-fallback.mjs` helper provides a markdown-table
fallback for the `quadrantChart` block.

---

## Step 8: Generate Validation Report

Write to `{FEATURE_DIR}/validation-report.md`:

```markdown
---
feature: [Feature Name]
validated: [ISO timestamp]
validator: Claude
status: [PASS/FAIL]
score: [N]
score_max: 110
iteration: [N]
has_ui: [true/false]
deploy_in_scope: [true/false]
blast_radius_verdict: [CONTAINED | BREACHED]
blast_radius_report: blast-radius-report.md
GeneratedAt: [ISO timestamp]
SourceCommandId: /6_gofer_validate
SourceInputs: [spec.md, plan.md, tasks.md, research.md, automated checks, agent findings]
OverwriteNoticeWhenApplicable: [new file or overwrite note]
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
| 11  | Blast Radius Containment   | 10      | [0/10]     | PASS/FAIL       | [summary] |
|     | **TOTAL**                  | **110** | **[N]**    | **[PASS/FAIL]** |           |

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

## Blast Radius Summary (Phase B)

See `{FEATURE_DIR}/blast-radius-report.md` for the full dimension report.

| Dimension                           | Agent                         | Red | Yellow | Gray | Verdict                  |
| ----------------------------------- | ----------------------------- | --- | ------ | ---- | ------------------------ |
| Change graph / ripple               | codebase-analyzer             | [N] | [N]    | [N]  | [OK/BREACHED]            |
| Interface contracts                 | validation-integration        | [N] | [N]    | [N]  | [OK/BREACHED]            |
| Error logging & observability       | validation-standards          | [N] | [N]    | [N]  | [OK/BREACHED]            |
| Dependency & submodule impact       | research-dependency-evaluator | [N] | [N]    | [N]  | [OK/BREACHED]            |
| Rollback readiness & release chklst | tasks-rollback-planner        | [N] | [N]    | [N]  | [OK/BREACHED]            |
|                                     | **TOTAL**                     | [N] | [N]    | [N]  | **[CONTAINED/BREACHED]** |

**Change Surface Summary**

- Modified files: [N]
- Submodules touched: [list]
- Public-surface symbols modified: [N]
- Breaking API changes: [N]
- New dependencies: [N]
- New High/Critical CVEs: [N]
- Irreversible migrations: [N]
- CHANGELOG updated: [Yes/No/N/A]

**Phase B Gate**: Cat 11 scores 10 only if verdict is **CONTAINED**.

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

## Evidence Table

| Category | Score | Evidence Artifact / Command Output | Absent / Reason for 0 |
| --- | --- | --- | --- |
| 1 — Functional Correctness | [0/15/20] | [file path, executed `npm test` output with timestamp, or agent citation] | [reason if 0] |
| 2 — Test Authenticity | [0/15/20] | [file path, mutation output, or agent citation] | [reason if 0] |
| 3 — UI/E2E Verification | [0/10/N/A] | [`N/A — HAS_UI=false`, `Render proof only — deployment target not in scope`, or render/deploy artifact] | [reason if 0 or not in scope] |
| 4 — Security Posture | [0/10] | [agent finding citation] | [reason if 0] |
| 5 — Integration Reality | [0/10] | [runtime wiring proof, integration-test output, or agent citation] | [reason if 0] |
| 6 — Error Path Coverage | [0/10] | [agent finding citation] | [reason if 0] |
| 7 — Architecture Compliance | [0/10] | [agent finding citation] | [reason if 0] |
| 8 — Performance Baseline | [0/5] | [agent finding citation] | [reason if 0] |
| 9 — Code Hygiene | [0/10] | [agent finding citation] | [reason if 0] |
| 10 — Specification Traceability | [0/5] | [agent finding citation] | [reason if 0] |
| 11 — Blast Radius Containment | [0/10] | [blast-radius-report.md reference] | [reason if 0] |
| **Total** | **[N]/110** |  |  |
```

This evidence table is required on **EVERY run (PASS and FAIL)**.

Each `Evidence Artifact / Command Output` cell MUST contain at least one of:

- A file path visible in the current session
- An executed command and its real output (with timestamp)
- A sub-agent finding citation (agent name + finding ID)

An empty evidence cell or a cell containing only inferences/assumptions MUST
cause that category to score 0.

Category 11's evidence cell MUST cite `blast-radius-report.md`.

When Category 3 is not in scope, the report preamble or row text MUST make the
redistribution explicit enough that normalization/effective contribution remains
derivable from the persisted report, and `Absent / Reason for 0` must record
the matching not-in-scope reason.

---

## Step 9: Determine Outcome

### If TOTAL = 110: PASS (Phase A + B)

```
════════════════════════════════════════════════════════════════
  RUBRIC PASSED: [Feature Name]
════════════════════════════════════════════════════════════════

  Score: 110/110

  Rubric:
  ✓ Functional Correctness     [15/20]/[15/20]
  ✓ Test Authenticity          [15/20]/[15/20]
  ✓ UI/E2E Verification        [10/10 or N/A]
  ✓ Security Posture           10/10
  ✓ Integration Reality        10/10
  ✓ Error Path Coverage        10/10
  ✓ Architecture Compliance    10/10
  ✓ Performance Baseline       5/5
  ✓ Code Hygiene               10/10
  ✓ Specification Traceability 5/5
  ✓ Blast Radius Containment   10/10

  Reports:
    {FEATURE_DIR}/validation-report.md
    {FEATURE_DIR}/blast-radius-report.md

════════════════════════════════════════════════════════════════
```

Proceed to **Phase C: Engineering Review Loop** (inline, Step 10a below), then
**Step 11: Attribution Logging** and **Step 12: Memory Update Check**.

**No external auto-chain is needed** — Phase C runs inline in this command.
After Phase C completes, the feature pipeline is complete. The legacy
`#6a_gofer_engineering_review` stub will detect the
`engineering-review-report.md` artifact and no-op if invoked.

### If TOTAL < 110: FAIL

Proceed to **Step 10: Brownfield Restart** (Phase C does not run when the rubric
fails — fix the rubric first).

---

## Step 10: Brownfield Restart Loop

When validation fails (score < score_max), generate a remediation report and signal
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
score: [N]
score_max: 110
generated: [ISO timestamp]
failed_categories: [list]
---

# Remediation Report: [Feature Name]

## Iteration [N] of 3

**Score**: [N]/110 **Status**: FAIL — Remediation Required

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
| 1         | [N]/110 | [list]            | [date] |
| 2         | [N]/110 | [list]            | [date] |
```

### 10.3 Signal Orchestrator

Output the routing instruction:

```
════════════════════════════════════════════════════════════════
  VALIDATION FAILED: [Feature Name]
════════════════════════════════════════════════════════════════

  Score: [N]/110
  Iteration: [N] of 3

  Failed categories:
  ✗ [Category] — 0/[points]: [brief reason]
  ✗ [Category] — 0/[points]: [brief reason]

  Remediation report: {FEATURE_DIR}/remediation-report.md

  REMEDIATION REQUIRED: [feature-name]
  Failed categories: [list]
  Iteration: [N] of 3
  Route: #5_gofer_implement → focused on [failed areas]

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
final_score: [N]/110
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

| Iteration | Total | Cat1 | Cat2 | Cat3 | Cat4 | Cat5 | Cat6 | Cat7 | Cat8 | Cat9 | Cat10 | Cat11 |
| --------- | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- | ----- |
| 1         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   | [N]   |
| 2         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   | [N]   |
| 3         | [N]   | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]  | [N]   | [N]   |
```

Output:

```
════════════════════════════════════════════════════════════════
  ESCALATION: [Feature Name]
════════════════════════════════════════════════════════════════

  After 3 remediation attempts, validation still fails.
  Score: [N]/110

  Escalation report: {FEATURE_DIR}/escalation-report.md

  This feature requires human review before proceeding.
  The automated pipeline cannot resolve the remaining issues.

════════════════════════════════════════════════════════════════
```

---

# Phase C — Engineering Review Loop

Phase C runs **only when the rubric passes** (110/110). It performs 1-5
iterative review→fix→re-review cycles using 3 additional review agents per
cycle, catching issues that the rubric-based validation might miss (edge cases,
race conditions, API-contract drift against the as-implemented code, spec spirit
violations).

Phase C is the terminal stage of `#6_gofer_validate`. After Phase C completes,
the feature pipeline is complete.

## Step 10a: Initialize Phase C

1. **Guard**: only proceed if rubric `status == PASS` (Step 9 TOTAL = 110). If
   FAIL, skip Phase C entirely — brownfield restart (Step 10) already triggered.

2. **Initialize cycle counter**: `CYCLE = 1`

3. **Initialize findings history**: Empty array to accumulate across cycles.

4. **Seed findings from Phase B Yellow/Gray**: All Yellow findings from the
   blast-radius report are added to the Phase C finding list for mandatory
   attention. Gray findings are logged but not auto-fixed.

## Step 10b: Spawn 3 Parallel Review Agents (Cycle N of 5)

Launch all 3 agents **in parallel** using the Task tool. Each agent receives the
feature context and returns structured findings.

### Agent 13: Engineer Review (Spec↔Plan↔Tasks↔Research Alignment)

```
Task: subagent_type="engineer-review", model="sonnet"
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

### Agent 14: Codebase Analyzer (Code↔Tasks Verification)

```
Task: subagent_type="codebase-analyzer", model="sonnet"
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

### Agent 15: Correctness Re-verification

```
Task: subagent_type="validation-correctness", model="sonnet"
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

## Step 10c: Run Build/Test/Lint Verification

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

## Step 10d: Synthesize Findings

Collect all agent reports and build/test/lint results. Merge with Phase B
Yellow/Gray carryovers. Classify each finding:

- **Red** (blocking): Task marked complete but no code, API contract mismatch,
  acceptance criterion not genuinely satisfied, build/test/lint failure,
  critical error path missing
- **Yellow** (should fix): TODO/FIXME comments, unused imports, edge cases not
  covered, partial error handling, minor inconsistencies, Phase B Yellows
- **Gray** (informational): Style suggestions, optional improvements, defensive
  coding suggestions, Phase B Grays

### Compile Finding Table

```
| # | Finding | Severity | Source                    | File   | Line   | Status |
|---|---------|----------|---------------------------|--------|--------|--------|
| 1 | [desc]  | Red      | engineer-review           | [file] | [line] | OPEN   |
| 2 | [desc]  | Yellow   | codebase-analyzer         | [file] | [line] | OPEN   |
| 3 | [desc]  | Yellow   | phase-b:observability     | [file] | [line] | OPEN   |
```

### Decision Logic

- If **NO Red or Yellow findings** → PASS → proceed to Step 10g (Report)
- If **Red or Yellow findings exist** → proceed to Step 10e (Fix)

## Step 10e: Fix Findings

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

## Step 10f: Loop or Complete

### Increment Cycle

```
CYCLE = CYCLE + 1
```

### Decision

- If `CYCLE <= 5` AND findings were fixed in the previous cycle → **Go to Step
  10b** (re-review with fresh agent runs to verify fixes and catch any new
  issues)
- If `CYCLE > 5` AND Red/Yellow findings still remain → **Generate escalation
  section** in the report, declare pipeline complete with warnings
- If **all findings resolved** (no Red or Yellow) → **Declare pipeline
  complete** (proceed to Step 10g)

## Step 10g: Generate Engineering Review Report

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
blast_radius_carryovers: [N]
---

# Engineering Review Report: [Feature Name]

## Summary

- **Status**: [PASS / PASS_WITH_WARNINGS / ESCALATED]
- **Review cycles**: [N] of 5 max
- **Total findings**: [N] (Red: [N], Yellow: [N], Gray: [N])
- **Resolved**: [N] findings fixed across [N] cycles
- **Remaining**: [N] findings (if any)
- **Phase B carryovers addressed**: [N] of [N]

## Cycle History

### Cycle 1

**Agents**: engineer-review, codebase-analyzer, validation-correctness
**Build/Test/Lint**: [PASS/FAIL details]

| #   | Finding | Severity | Source | File   | Line   | Resolution   |
| --- | ------- | -------- | ------ | ------ | ------ | ------------ |
| 1   | [desc]  | [sev]    | [src]  | [file] | [line] | [FIXED/OPEN] |

### Cycle 2 (if applicable)

...

## Remaining Findings (if any)

| #   | Finding | Severity | Source | File   | Line   | Reason Not Fixed |
| --- | ------- | -------- | ------ | ------ | ------ | ---------------- |
| 1   | [desc]  | [sev]    | [src]  | [file] | [line] | [why]            |

## Recommendations

### Must Address Before Merge

- [Any remaining Red/Yellow findings]

### Future Improvements

- [Gray findings and suggestions]
```

## Step 10h: Output Completion Banner

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
  1. #1_gofer_research ✓
  2. #2_gofer_specify ✓
  3. #3_gofer_plan ✓
  4. #4_gofer_tasks ✓
  5. #5_gofer_implement ✓
  6. #6_gofer_validate ✓ (Phase A ✓, Phase B ✓, Phase C ✓)

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
  1. #1_gofer_research ✓
  2. #2_gofer_specify ✓
  3. #3_gofer_plan ✓
  4. #4_gofer_tasks ✓
  5. #5_gofer_implement ✓
  6. #6_gofer_validate ✓ (Phase A ✓, Phase B ✓, Phase C ⚠)

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

# End of Phase C

---

## Step 11: Attribution Logging

Log every finding to `.specify/logs/validation-findings.jsonl`.
For EnterpriseAI runs, also mirror the same finding lifecycle to
`{FEATURE_DIR}/audit-history.md` so executive, architecture, CISO, data, CIO,
delivery, finance, operations, and risk/compliance stakeholders can see stable
finding IDs, recurrence, disposition, owner, expiry, and review cadence.

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
- `blast_radius_containment` — **NEW** (Cat 11, Phase B)
  - Sub-dimensions for the `dimension` sub-field: `change_graph`,
    `interface_contract`, `observability`, `dependency_submodule`,
    `rollback_release`
- `engineering_review` — Phase C findings (agent-specific sub-dimensions:
  `spec_alignment`, `code_verification`, `correctness_reverify`)

### EnterpriseAI Persistent Audit Requirements

`audit-history.md` MUST include:

| Field | Requirement |
| ----- | ----------- |
| Finding ID | Stable across validation cycles; never renumber existing findings |
| Source | Rubric category, agent, automated check, or stakeholder gate |
| Status | Open, fixed, accepted, or escalated |
| Recurrence | Count and prior cycle references for repeated findings |
| Owner | Named accountable role or team |
| Expiry | Required for accepted exceptions |
| Evidence | Links to validation report, tests, contract pack, or code references |

Recurring red findings must escalate to the relevant decision owner and block
launch unless explicitly accepted with owner, expiry, and review cadence.

For application delivery, validation MUST also check
`{FEATURE_DIR}/journeys/base-journey.md` against the delivered implementation:

- The app process has four user-facing steps or fewer, or an approved exception
  explains why extra steps could not be combined, automated, or handled by
  generative AI assistance.
- Each journey step preserves its business goal, AI assistance mode, data/context
  used, completion signal, human controls, evidence/confidence display, audit
  trail, and fallback/escalation path.
- `{FEATURE_DIR}/ui-review-log.md` contains at least one pre-presentation
  self-review entry for each preview round that was shown to the stakeholder,
  with screenshot, local render proof, Playwright-style evidence, or an
  explicit reasoned exception.
- `{FEATURE_DIR}/ui-approval.md` records the approved preview, approved
  branding/logo decisions, any approved Vertical Template exceptions, the
  approver, and approval timestamp.
- `{FEATURE_DIR}/service-fit-matrix.md` records each desired platform
  capability, the evidence source used to evaluate it, and whether it is
  accessible now, purchasable but unavailable now, or unavailable without new
  platform work.
- The approved external/internal/hybrid profile choice, package lane, coupling
  status, Storybook story IDs, theme override points, public-readiness target,
  and custom-block exceptions are present in the preview/approval/service-fit
  artifacts and match the delivered implementation.
- Validation confirms that app-delivery runs used Vertical Template blocks by
  default and that any create-new UI concept was explicitly approved rather
  than silently introduced.
- Validation confirms that block-porting tasks produced the expected package
  surface and that public or hybrid lanes do not directly depend on DAISY
  internals unless an approved internal-only exception is recorded.
- Chatbot, voice, accessibility, translation, contextual prefill, validation,
  and step-goal assistance claims are covered by acceptance tests where they are
  in scope.

For explicit non-app work, validation MUST treat `ui-preview-brief.md`,
`ui-review-log.md`, `ui-approval.md`, and `service-fit-matrix.md` as
**not applicable** rather than as missing blocking artifacts.

### Log Summary Entry

After all findings, append a summary entry:

```json
{
  "finding_id": "SUMMARY",
  "timestamp": "[ISO timestamp]",
  "feature": "[feature-name]",
  "category": "summary",
  "severity": "info",
  "description": "Validation score: [N]/110. Categories failed: [list or 'none']",
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



## Pipeline Continuation

This completes the 6_gofer_validate stage. To continue the Gofer pipeline:

**Next Command:** `#6a_gofer_engineering_review`

The next stage will read the artifacts from this stage and continue the workflow automatically.

**Note:** Copilot Chat supports context preservation. Your conversation history will be maintained as you progress through pipeline stages.

## Key Rules

### Phase A (Rubric)

- **110/110 is the only passing score** — there is no "close enough"
- **Agents run in parallel** — spawn all 6 (or 7 with red team) at once, do not
  serialize
- **Red findings block** — any Red finding in any agent zeroes that category
- **Mutation testing is optional** — gracefully degrade when Stryker absent
- **Mock ratio excludes justified mocks** — mark with `// mock-justified:`
  comment
- **Maximum 3 remediation iterations** — then escalate to human

### Phase B (Blast Radius)

- **5 blast-radius agents run in parallel** — do not serialize across dimensions
- **The change manifest is ground truth** — build it once in Step 2.5, pass the
  same manifest to every Phase B agent
- **Breaking change + no CHANGELOG entry = Red** — always. Release-checklist
  compliance is mandatory for user-visible changes.
- **New High/Critical CVE = Red** — block before merge; Moderate is Yellow; Low
  is Gray
- **Cross-submodule ripple requires explicit plan.md approval** — otherwise Red
- **Blast-radius verdict CONTAINED gives Cat 11 = 10**; BREACHED gives Cat 11 =
  0 — this is the only way Cat 11 scores
- **Phase B writes `blast-radius-report.md`** alongside `validation-report.md`
- **Phase B Yellows seed Phase C** — Phase C must address them

### Phase C (Engineering Review Loop)

- **3 review agents per cycle** — spawn all in parallel, do not serialize
- **5 cycles maximum** — hard cap to prevent infinite loops
- **Fix Red before Yellow** — priority ordering matters
- **Re-verify after fixes** — always re-run build/test/lint after changes
- **Gray findings are logged, not auto-fixed** — they go in the report
- **Phase C only runs if the rubric passes** — a failing rubric triggers
  brownfield restart instead
- **This stage is the pipeline terminal** — "PIPELINE COMPLETE" only appears at
  the end of Phase C
- **Legacy `/6a` is a stub** — it detects `engineering-review-report.md` and
  no-ops if Phase C already ran

### Across All Phases

- **Attribution logging is mandatory** — every finding (A, B, C) gets logged to
  JSONL with its phase and sub-dimension
- **Be specific** — cite file paths and line numbers for all findings
- **Score the rubric honestly** — the goal is to catch real problems, not to
  pass
- Log stage completion for observability tracking
