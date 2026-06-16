## Workspace Preflight

Before doing stage/helper work:

1. Resolve the repository root.
2. Check the core Gofer sentinels:
   - `.specify/.gofer-version`
   - `.specify/commands/0_business_scenario.md`
   - `.specify/templates/spec-template.md`
   - `.specify/scripts/bash/create-new-feature.sh`
   - `.specify/scripts/node/parse-stage-command.mjs`
   - `.specify/scripts/hooks/post-tool-use.mjs`
   - `.specify/scripts/powershell/install-optional-tools.ps1`
   - `.specify/templates/gofer-model-policy.yaml`
   - `.specify/memory/gofer-model-policy.yaml`
   - `.specify/specs/`
   - `.specify/memory/`
3. Check host-specific repo-owned files when relevant:
   - Claude: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`
   - Codex: `AGENTS.md`
   - Copilot: `.github/copilot-instructions.md`
   - VS Code extension mirrors Claude/Copilot/Gemini resources itself and should still keep the core scaffold healthy
4. If the repo already has the workspace checker script, prefer running:
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host gemini --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.

---
description: Execute tasks from tasks.md to implement the feature
---

# Gofer Implement

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Execution Profile During Implementation

Before editing, re-check the planned depth and generic risk labels from
`tasks.md` / `plan.md`:

- **fast**: for `docs-only` or very small low-risk changes, make the smallest
  scoped edit, run focused checks, and avoid regenerating optional artifacts
  unless they are directly affected.
- **standard**: implement phase by phase with normal focused test evidence.
- **full**: open the relevant contracts, security, data, infra, release, and
  rollback artifacts before code changes; update tests before or alongside the
  fix.
- **dynamic**: confirm `workflow-dag.md` exists and `requiresConfirmation` is
  false before executing shard-oriented work. Run each shard against its declared
  inputs/outputs, then run the reducer and verifier/refuter pass before marking
  tasks complete.

If the implementation reveals a higher-risk surface than planned, stop and
upgrade the depth before continuing. Do not silently broaden scope.

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)
- `plan.md` - Implementation plan (from /3_gofer_plan)
- `tasks.md` - Task breakdown (from /4_gofer_tasks)

If missing, prompt user to run the prerequisite stage.

---

## Outline

1. Context health check
2. Load implementation context
3. Load scope boundaries
4. Check checklists status
5. Verify project setup
6. Execute tasks phase by phase (with feedback loops)
7. Track progress and handle errors
8. Output: Implemented feature code

---

## Step 1: Context Health Check

Before starting implementation, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

**Evaluate thresholds (2025-2026 research-based)**:

| Status   | Token Usage | Action                                   |
| -------- | ----------- | ---------------------------------------- |
| Healthy  | < 50%       | Proceed normally                         |
| Warning  | 50-70%      | Use sub-agents, checkpoint every 5 tasks |
| Critical | > 70%       | Run `/7_gofer_save`, start new session   |

### Context Management Techniques

During implementation, use these techniques to preserve context quality:

1. **Sub-Agent Architecture** (Recommended)
   - Use Task tool with specialized agents for exploration
   - Each agent returns condensed results (1-2k tokens)
   - Keeps main context focused on implementation

2. **Observation Masking**
   - Old file reads become stale quickly
   - Re-read files only when actively editing
   - Avoid keeping full file contents in context

3. **Periodic Checkpoints**
   - Every 5 completed tasks, check context health
   - If Warning status: Run `/7_gofer_save`
   - This enables resumption with fresh context

**If compaction needed**:

```bash
/7_gofer_save  # Creates comprehensive checkpoint
# Start new Claude Code session
/8_gofer_resume  # Restores state with clean context
```

---

## Step 2: Load Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
   ```

   Parse JSON for FEATURE_DIR and task list

2. **Load implementation documents**:
   - **Required**: tasks.md (task list and execution plan)
   - **Required**: plan.md (tech stack, architecture, file structure)
   - **Required**: spec.md (scope boundaries and protected files)
   - **Optional**: data-model.md (entities and relationships)
   - **Optional**: contracts/ (API specifications)
   - **Optional**: research.md (technical decisions)
   - **Optional**: quickstart.md (integration scenarios)

---

## Step 3: Load Scope Boundaries

Extract protected boundaries from spec.md and tasks.md:

1. **Read "Protected Boundaries" section from spec.md**
2. **Read "Protected Files" section from tasks.md**
3. **Build exclusion list**:

   ```
   PROTECTED_FILES:
   - path/to/file1.ts (reason: backward compatibility)
   - path/to/directory/ (reason: out of scope)
   ```

4. **Display to confirm**:

   ```
   ⚠️  SCOPE BOUNDARIES LOADED
   The following files/patterns are PROTECTED and must NOT be modified:
   - [list files]

   If you need to modify these, STOP and ask for approval.
   ```

---

## Step 4: Check Checklists Status

If `{FEATURE_DIR}/checklists/` exists:

1. **Scan all checklist files**
2. **Count completion status** for each:
   - Total items: `- [ ]` or `- [X]` or `- [x]`
   - Completed: `- [X]` or `- [x]`
   - Incomplete: `- [ ]`

3. **Display status table**:

   ```
   | Checklist      | Total | Completed | Incomplete | Status |
   |----------------|-------|-----------|------------|--------|
   | requirements.md| 12    | 12        | 0          | ✓ PASS |
   | ux.md          | 8     | 5         | 3          | ✗ FAIL |
   ```

4. **If any incomplete**:
   - Display the table
   - **STOP** and ask: "Some checklists are incomplete. Proceed anyway?
     (yes/no)"
   - Wait for user response

5. **If all complete**: Proceed automatically

---

## Step 5: Project Setup Verification

Create/verify ignore files based on project setup:

### Detection Logic

- Git repo? → verify `.gitignore`
- Dockerfile exists? → verify `.dockerignore`
- ESLint config? → verify `.eslintignore`
- Prettier config? → verify `.prettierignore`

### Common Patterns by Tech Stack

Read tech stack from plan.md and ensure appropriate patterns:

- **Node.js**: `node_modules/`, `dist/`, `build/`, `*.log`, `.env*`
- **Python**: `__pycache__/`, `*.pyc`, `.venv/`, `dist/`
- **TypeScript**: `node_modules/`, `dist/`, `*.js.map`, `.tsbuildinfo`
- **Universal**: `.DS_Store`, `*.tmp`, `*.swp`, `.vscode/`, `.idea/`

---

## Step 6: Parse Tasks Structure

Extract from tasks.md:

1. **Task phases**: Setup, Foundational, User Stories, Polish
2. **Dependencies**: Sequential vs parallel execution
3. **Task details**: ID, description, file paths, [P] markers
4. **Current progress**: Which tasks are already `[X]` completed
5. **Protected files**: List from "Protected Files" section

---

## Step 7: Execute Implementation

### Checkpoint Strategy

Create checkpoints (git commits) at strategic points:

| Checkpoint Point                 | Command                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| Before starting each phase       | `git add -A && git commit -m "WIP: checkpoint before Phase N"`     |
| After completing each user story | `git add -A && git commit -m "feat: complete US1 - [description]"` |
| Before any risky operation       | `git add -A && git commit -m "WIP: checkpoint before [operation]"` |

**Risky operations requiring checkpoint**:

- Modifying database schemas or migrations
- Changing authentication/authorization logic
- Modifying core infrastructure or shared utilities
- Large refactoring (> 5 files)
- Deleting or renaming significant code

### Scope Enforcement

**Before EACH file modification**:

1. ✓ Check file path is in planned scope (listed in tasks.md)
2. ✓ Check file is NOT in Protected Files list (from Step 3)
3. If file is protected:

   ```
   ⚠️  SCOPE BOUNDARY VIOLATION
   File: [path/to/file]
   Reason: [from Protected Files list]

   This file is marked as protected and must NOT be modified.
   Options:
   1. Find alternative approach that doesn't touch this file
   2. STOP and ask user for explicit approval to cross boundary
   ```

### Execution Rules

1. **Phase-by-phase**: Complete each phase before next
2. **Respect dependencies**: Sequential tasks in order
3. **Parallel tasks**: [P] marked tasks can run together
4. **File coordination**: Same-file tasks run sequentially
5. **Scope check**: Verify every file against protected list

### Execution Order

1. **Setup first**: Project structure, dependencies, config
2. **Foundational next**: Shared components blocking user stories
3. **User stories**: In priority order (P1, P2, P3...)
4. **Polish last**: Documentation, optimization, final tests

### Minimal Changes Only

**Before EVERY file modification**, verify against Constitution Principle VIII:

1. Is this change directly required by the current task? If not, **do not make
   it**.
2. Am I modifying only the files listed in the task scope? If touching other
   files, **stop and justify**.
3. Am I refactoring surrounding code? If yes, **revert** — only change what the
   task specifies.
4. Am I adding features, documentation, or tests beyond what's specified? If
   yes, **remove them**.
5. Am I adding error handling for scenarios that cannot occur? If yes, **remove
   it**.
6. Am I creating an abstraction for a one-time operation? If yes, **inline it**.
7. Am I gold-plating (better variable names, extra comments, type annotations on
   unchanged code)? If yes, **revert**.

**This is a per-modification check, not a per-task check.** Apply it to every
line you write.

### For Each Task

1. Read the task description and file path
2. **SCOPE CHECK**: Verify file is not protected
3. Load relevant context (data-model, contracts, research)
4. Implement according to plan.md architecture
5. Follow existing codebase patterns (from research.md)
6. **MINIMAL CHANGE CHECK**: Verify every modification against the 7-point
   checklist above
7. Mark the task `in_progress` before editing:

   ```bash
   # Use the Gofer task status tool if available
   gofer_update_task_status <spec-id> <task-id> in_progress
   ```

8. **RUN FEEDBACK LOOP** (see below)
9. After the task passes its feedback loop, immediately mark it complete in
   `tasks.md` using `gofer_update_task_status <spec-id> <task-id> completed` or
   `.specify/scripts/bash/mark-task-complete.sh <feature-dir> <task-id>`
10. Report progress

### Feedback Loop (After EACH Task)

**Immediately after completing each task, run verification**:

```bash
# 1. Run relevant tests (if test file exists for this component)
npm test -- --grep "[component pattern]"  # or pytest -k "pattern"

# 2. Run linter on modified files
npm run lint -- [modified files]  # or ruff check [files]

# 3. Run type check (TypeScript projects)
npm run typecheck  # or tsc --noEmit
```

**Feedback Loop Rules**:

- If tests fail → **FIX BEFORE** proceeding to next task
- If lint errors → **FIX BEFORE** proceeding
- If type errors → **FIX BEFORE** proceeding
- **DO NOT** mark a task complete until the feedback loop passes
- **DO NOT** accumulate failures across tasks

### After Each Phase

Run full verification before proceeding:

```bash
# Full test suite
npm test

# Full build
npm run build

# Full lint
npm run lint
```

**Phase Gate**: Do NOT proceed to next phase if build is broken.

### Multi-Perspective Implementation Options (Optional)

When facing complex implementation decisions during task execution, invoke one
or more of the following strategies. Each spawns multiple sub-agents that
explore different approaches, then a judge synthesizes the best result.

**Trigger conditions** — use these when:

| Strategy                 | Agent                            | When to Trigger                                                            | Converge Model |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------- | -------------- |
| #1 Variant Generator     | `implement-variant-generator`    | Multiple valid coding paradigms exist for a task (e.g., functional vs OOP) | sonnet         |
| #3 Bug Triangulator      | `implement-bug-triangulator`     | Debugging a defect with unclear root cause                                 | sonnet         |
| #4 Test Diversifier      | `implement-test-diversifier`     | Writing tests for critical or complex logic                                | sonnet         |
| #8 Error Hardener        | `implement-error-hardener`       | Implementing error-prone code (I/O, external APIs, resource mgmt)          | sonnet         |
| #11 Performance Explorer | `implement-performance-explorer` | Optimizing a hot path or resource-intensive operation                      | sonnet         |
| #15 Code Review Council  | `implement-code-review-council`  | After completing a complex task, before marking done                       | sonnet         |
| #17 Doc Writer           | `implement-doc-writer`           | Writing documentation for a user-facing feature                            | sonnet         |

**Invocation pattern** (example for #1 Variant Generator):

```
# Diverge: Launch 3-5 agents with different approaches
Task: subagent_type="implement-variant-generator", model="sonnet"
  prompt="Perspective 1: Implement [task] using functional approach. Files: [list]"

Task: subagent_type="implement-variant-generator", model="sonnet"
  prompt="Perspective 2: Implement [task] using OOP approach. Files: [list]"

Task: subagent_type="implement-variant-generator", model="sonnet"
  prompt="Perspective 3: Implement [task] using event-driven approach. Files: [list]"

# Converge: Judge synthesizes best approach
Task: subagent_type="multi-perspective-judge", model="opus"
  prompt="Synthesize 3 implementation variants for [task]. Select best approach.
  Variant 1: [result]. Variant 2: [result]. Variant 3: [result]."
```

**Rules**:

- These are OPTIONAL — only invoke when trigger conditions are met
- Each diverge agent returns <2000 tokens; judge returns <4000 tokens
- Do NOT use for trivial tasks (config changes, simple getters, boilerplate)
- Prefer strategies that match the task type (debugging → #3, testing → #4)

---

## Step 8: Progress Tracking

### After Each Task

```
✓ T001 Create directory structure - DONE
→ T002 [P] Set up configuration files - IN PROGRESS
```

### After Each Phase

```
═══════════════════════════════════════
  Phase 1: Setup - COMPLETE
═══════════════════════════════════════
  Tasks completed: 4/4
  Files created:
    - src/index.ts
    - src/config.ts
    - package.json
    - tsconfig.json

  → Starting Phase 2: Foundational
═══════════════════════════════════════
```

---

## Step 9: Error Handling

### If Task Fails

1. Report the error with context
2. **For sequential tasks**: Halt execution
3. **For parallel [P] tasks**: Continue others, report failed
4. Provide debugging suggestions
5. Ask user how to proceed:
   - Retry the task
   - Skip and continue
   - Stop implementation

### If Blocked

1. Identify the blocker
2. Check if it's a missing prerequisite
3. Suggest running earlier stage if needed
4. Document the issue in tasks.md

### If Something Goes Wrong (Rollback)

1. **STOP immediately** - don't make more changes
2. **Assess damage**:
   ```bash
   git status
   git diff
   ```
3. **Rollback options**:
   - Single file: `git checkout HEAD -- <file>`
   - All uncommitted: `git reset --hard HEAD`
   - To last checkpoint: `git reset --hard <checkpoint-commit>`
4. **Document** what went wrong in tasks.md
5. **Retry** with modified approach

---

## Step 10: Completion Validation

After all tasks complete:

1. **Verify all tasks marked [X]**
2. **Check implementation matches spec**
3. **Run automated tests** if they exist
4. **Validate against plan.md architecture**

---

## Step 11: Engineering Review Gate (Up to 5 cycles)

Before proceeding to validation, run an iterative engineering review to catch
implementation issues early.

### Review Cycle (repeat up to 5 times)

**CRITICAL**: You **MUST** dispatch 3 review agents in parallel using the Task
tool. Do NOT perform this review work inline in the main context.

**Agent 1**: engineer-review (sonnet) — cross-check spec↔plan↔implementation
alignment

```
Task: subagent_type="engineer-review", model="sonnet"
Prompt: "Review alignment between spec.md, plan.md, tasks.md, and the
implemented code in {FEATURE_DIR}. Check that all acceptance criteria are
implemented. Report Red/Yellow/Gray findings."
```

**Agent 2**: codebase-analyzer (sonnet) — verify implementation patterns

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Verify that the implemented code follows existing codebase patterns
from {FEATURE_DIR}/research.md and matches the architecture in
{FEATURE_DIR}/plan.md. Report Red/Yellow/Gray findings."
```

**Agent 3**: validation-correctness (sonnet) — verify acceptance criteria
coverage

```
Task: subagent_type="validation-correctness", model="sonnet"
Prompt: "Verify that every acceptance criterion in {FEATURE_DIR}/spec.md
has been implemented and has corresponding test coverage.
Report Red/Yellow/Gray findings with coverage gaps."
```

**After agents return:**

1. Classify findings: Red (blocking) / Yellow (should fix) / Gray
   (informational)
2. If NO Red or Yellow findings → PASS → proceed to auto-chain
3. If Red or Yellow findings exist: a. Fix findings directly in implementation
   code (Red first, then Yellow) b. Re-run build/test/lint to verify fixes c.
   Increment cycle counter d. If cycle <= 5 → re-run review agents e. If cycle >
   5 → log remaining findings, proceed with warnings

---

## Step 12: Report and Continue

After implementation complete and review gate passes:

```
════════════════════════════════════════════════════════════════
  ✓ IMPLEMENTATION COMPLETE: [Feature Name]
════════════════════════════════════════════════════════════════

  Tasks: [N]/[N] completed

  Phases completed:
  - Phase 1: Setup ✓
  - Phase 2: Foundational ✓
  - Phase 3: US1 ✓
  - Phase 4: US2 ✓
  - Phase 5: Polish ✓

  Engineering Review: PASSED (cycle [N] of 5)

  Files created/modified:
  - src/models/user.ts (new)
  - src/services/userService.ts (new)
  - src/routes/users.ts (new)
  - src/index.ts (modified)

════════════════════════════════════════════════════════════════
```

**AUTO-CHAIN (MANDATORY)**: You MUST immediately invoke the next pipeline stage
by calling the Skill tool with skill="/6_gofer_validate". Do NOT ask the user
for confirmation. Do NOT output "Ready for next stage". Just invoke the skill
NOW.

---

## Resumption Support

If implementation was interrupted:

1. Parse tasks.md for `- [X]` completed tasks
2. Find first incomplete task `- [ ]`
3. Resume from that task
4. Report what was already done

**Note**: Implementation is stateful - it resumes from the last completed task.

---

## EnterpriseAI Deployment Preflight Gate (Manifest/Config)

The standard Gofer workflow is the public default. EnterpriseAI deployment
preflight is migration-only and runs only when `workflowProfile` is explicitly
`enterpriseai`.

Before any deployment task emitted by `/4_gofer_tasks` completes, this stage
MUST execute deployment preflight checks (manifest/config gate). A task that
invokes `eai deploy` is not marked complete until all of the following files
are present at the workspace root and pass their readiness checks:

| Required File  | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| `manifest.yml` | Vertical application manifest (from `eai init`) |
| `config.json`  | Runtime configuration bundle (environment-specific)     |

### Gate behaviour

- If any required file is missing, the stage emits `EVT-012` via the
  deployment-readiness event bus and blocks task completion.
- Paths are resolved relative to the workspace root. Any attempt to resolve a
  required file outside the workspace (for example `/etc/passwd`) throws
  `IMPL_DEPLOYMENT_PATH_INVALID`.
- When the gate passes, `readinessPassed=true` is recorded in the emitted event
  and the deployment task is allowed to continue.

### EnterpriseAI Red/Green Implementation Discipline

For EnterpriseAI runs, implementation MUST preserve the test/implementation
separation from `tasks.md`:

- Run the spec-derived tests before implementation and record the expected
  failure when the implementation is missing or incomplete.
- Implement only against the approved `contract-pack.md`, `context-bundle.md`,
  `reuse-scan.md`, `journeys/base-journey.md`, `plan.md`, and `goal-ledger.json`.
- For application delivery, stop and return to the preview loop if
  `{FEATURE_DIR}/ui-approval.md` is missing or not approved. App-delivery runs
  MUST NOT continue as though the UI is settled when approval has not been
  recorded.
- For application delivery, use the EAI App Template already installed in the
  workspace as the default UI lego-block source. Any create-new UI concept must
  be justified in the approved plan and approval artifacts.
- For application delivery, implement on EAI Platform first, including the EAI
  app template, and Azure second: use the EAI scaffold, PublicAPI/object
  types/workflows/block catalog, ResourceAPI/`eai resources schema`, tenant/app
  enrollment, provisioning, diagnostics, and Azure-compatible
  deployment/supporting services before any non-EAI exception. Do not introduce a
  non-EAI primary runtime, database, hosting platform, or app stack unless
  `plan.md`, `service-fit-matrix.md`, and approval artifacts record it as an
  explicit exception.
- Before implementing UI, run or inspect `eai --describe`, `eai blocks list`,
  `eai blocks describe <id>` for every selected block, and
  `eai resources schema --format json`. Implementation notes must cite the block IDs,
  required resources, bindings, package lane, coupling status, Storybook story
  IDs, theme override points, and any approved custom-block exception.
- Reject unknown component names during implementation unless `tasks.md` and
  `ui-approval.md` explicitly authorize a custom extension block and manifest.
- Treat package-profile, block-porting, source-platform decoupling, and public-readiness
  tasks as first-class implementation tasks, not polish. Update
  `{FEATURE_DIR}/goal-ledger.json` whenever a task changes an owner, target
  metric, delivery state, promotion criterion, or re-loop trigger. External and
  hybrid profile work is incomplete until package exports, Storybook stories,
  theme overrides, consumer smoke checks, and unsupported custom-block
  exceptions are resolved or explicitly deferred by approval artifacts.
- Do not let public or hybrid package lanes import source-platform internals directly.
  Use `eai resources schema`, an adapter boundary, or an approved
  restricted-source exception; record the coupling status in implementation
  notes and `ui-review-log.md`.
- For application delivery, implement the four-step-or-fewer AI-augmented
  process as the user-facing spine. Each step must preserve its business goal,
  AI assistance mode, contextual prefill or conversational support, completion
  criteria, human controls, audit trail, and fallback/escalation path.
- Preserve dual-state delivery discipline: when a capability stays in `mock` or
  `hybrid`, record why, what promotion criteria remain, and what validation
  evidence is still required before it can move to `live`.
- For application delivery, before showing any new MVP preview to the
  stakeholder, collect screenshot, local render proof, or Playwright-style
  self-review evidence and append it to `{FEATURE_DIR}/ui-review-log.md`.
- For application delivery, after UI approval and before treating platform
  selection as complete, update `{FEATURE_DIR}/service-fit-matrix.md` with
  tenant-aware evidence from `eai --describe`, `eai whoami`, `eai tenant
  select`, `eai resources schema --format json`, `eai workflow readiness
  --format json`, `eai verify calls --format json`, or equivalent approved
  platform evidence. The matrix must distinguish
  accessible now, purchasable but unavailable now, and unavailable without new
  platform work.
- For non-app work, skip the preview, approval, branding, and service-fit gates
  while preserving the same numbered stage flow.
- Do not add extra user-facing app steps unless `plan.md` records why they
  cannot be combined, automated, or handled by generative AI assistance.
- Re-run the same tests and validation checks after implementation.
- Update `audit-history.md` with stable finding IDs for every blocking issue,
  recurring issue, accepted exception, owner, expiry, and review cadence.

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 5_implement --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`

---

## Key Rules

- ALWAYS mark tasks complete in tasks.md as you finish them
- Use absolute paths for all file operations
- Follow existing codebase patterns from research.md
- Follow architecture from plan.md
- Report progress clearly after each task
- Stop on errors for sequential tasks
- Implementation must match specification
- Log stage completion for observability tracking

---

## Optional Helpers: TDD and Diagnose

- If the operator explicitly requests `tdd-assist` and both `spec.md` and
  `tasks.md` are present, run `gofer:tdd` inline and write
  `.specify/specs/{feature}/tdd-session.md` using the same artifact contract as
  the standalone helper.
- If the operator explicitly requests `diagnose` and `spec.md` is present, run
  `gofer:diagnose` inline; bug context, failing output, or equivalent failure
  evidence may supplement the investigation. Write
  `.specify/specs/{feature}/diagnose-report.md` using the same artifact
  contract as the standalone helper.
- If the required inputs are missing, continue the stage normally and report
  that the helper was not run.
- These selectors are optional and do not change stage progress, routing, or
  pipeline state.
