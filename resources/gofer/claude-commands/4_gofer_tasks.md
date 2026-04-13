---
description: Generate actionable task breakdown from implementation plan
---

# Gofer Tasks

You are generating an actionable, dependency-ordered task breakdown. This is the
**fourth stage** of the unified Gofer pipeline.

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

If missing, prompt user to run the prerequisite stage.

---

## Outline

1. Context health check
2. Load context (lightweight)
3. Dispatch task generation agents (sub-agents handle heavy generation)
4. Review agent outputs
5. Engineer review gate
6. Optional multi-perspective review
7. Approval gate
8. Output: `tasks.md`, `traceability.md`, `issues.md`

---

## Step 0: Context Health Check

Before generating tasks, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Consider `/compact` before loading all artifacts
- If **> 70%**: Start new session with handoff summary

Task generation dispatches agents — keep main context lightweight.

---

## Step 1: Load Context (Lightweight)

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json
   ```

   Parse JSON for FEATURE_DIR, AVAILABLE_DOCS

2. **Scan available documents** (do NOT load full content — agents read
   directly):
   - Note feature name from FEATURE_DIR
   - Note which optional docs exist: data-model.md, contracts/, quickstart.md
   - Note the tasks template path: `.specify/templates/tasks-template.md`

---

## Step 2: Dispatch Task Generation Agents

**CRITICAL**: You **MUST** launch these agents using the Task tool. Do NOT
perform this work inline in the main context. The main context should only
orchestrate and review agent outputs.

### Agent 1: Task Breakdown Generator

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Generate a complete, dependency-ordered task breakdown for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/plan.md — Implementation phases, architecture, file structure
- {FEATURE_DIR}/spec.md — User stories with priorities and acceptance criteria
- {FEATURE_DIR}/data-model.md — Entity definitions (read if exists)
- {FEATURE_DIR}/contracts/ — API contracts (read all .md files if exists)
- {FEATURE_DIR}/research.md — Technology decisions (read if exists)
- .specify/templates/tasks-template.md — Task template structure

Generate tasks.md organized by user story to enable independent implementation:

Task Organization (REQUIRED structure):
1. Phase 1: Setup — Project initialization, shared infrastructure
2. Phase 2: Foundational — Blocking prerequisites for all user stories
3. Phase 3+: User Stories — One phase per story in priority order (P1 first)
4. Final Phase: Polish — Cross-cutting concerns, documentation

Task Format (REQUIRED for every task):
- [ ] [TaskID] [P?] [Story?] Description with exact file path
Where:
- TaskID: Sequential (T001, T002...)
- [P]: Only if parallelizable with other tasks in same phase
- [Story]: [US1], [US2] etc. for user story phases only
- Description: Clear action with the exact file path to create/modify

Each phase MUST include:
- Goal statement
- Independent Test Criteria (for user story phases)
- Verification checklist at the end

Include these sections:
1. YAML frontmatter: feature, spec, plan, status: ready, created (ISO date)
2. Overview: Total tasks, parallel opportunities, user story count
3. Dependencies: Mermaid graph showing phase dependencies
4. All phases with tasks
5. Parallel Execution Guide: Which [P] tasks can run concurrently
6. Implementation Strategy: MVP first, incremental delivery, polish last

Validation checks before writing:
- Every plan phase has at least one task (GAP-02)
- Every plan task item has a corresponding task
- Every acceptance criterion maps to at least one task (GAP-03)
- Every data model entity has implementing tasks
- Every API contract endpoint has implementing tasks
- Task file paths match plan.md File Structure section

Write the complete task breakdown to {FEATURE_DIR}/tasks.md.

Return a structured summary:
- Total task count
- Tasks per phase
- Parallel opportunity count
- Plan phase coverage: N/N phases covered
- Acceptance criteria coverage: N/N criteria covered
- Any coverage gaps found"
```

### Agent 2: Traceability Analyzer

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Generate a requirement traceability artifact for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — User stories, acceptance criteria, functional requirements
- {FEATURE_DIR}/plan.md — Implementation phases, components
- {FEATURE_DIR}/tasks.md — Task breakdown (read after Agent 1 writes it)
- {FEATURE_DIR}/data-model.md — Entity definitions (read if exists)
- {FEATURE_DIR}/contracts/ — API contracts (read if exists)

Generate {FEATURE_DIR}/traceability.md with:

1. Spec → Plan → Tasks Mapping:
   | User Story | Priority | Plan Phase | Tasks | AC Status |

2. Acceptance Criteria Detail:
   | ID | Criterion | Task(s) | Phase |

3. Plan Phase Coverage:
   | Phase | Task Count | Coverage % |

4. Data Entity Coverage (if data-model.md exists):
   | Entity | Implementing Task(s) | Fields Covered? |

5. API Contract Coverage (if contracts/ exists):
   | Endpoint | Contract File | Implementing Task(s) |

6. Coverage Summary:
   - Plan Phases: N/N covered
   - User Stories: N/N covered
   - Acceptance Criteria: N/N covered
   - Data Entities: N/N covered
   - API Endpoints: N/N covered
   - Status: VALIDATION PASSED or VALIDATION FAILED

Return: overall coverage percentages and any MISSING items"
```

**Run Agent 1 first**, then Agent 2 after tasks.md is written.

---

## Step 3: Review Agent Outputs

After both agents complete:

1. **Review tasks.md** — Verify from Agent 1:
   - Tasks are specific enough for LLM execution
   - File paths reference real locations in the codebase
   - Phase dependencies make sense
   - Every user story phase is independently testable
   - Parallel markers [P] are correct (no dependency conflicts)

2. **Review traceability.md** — Check from Agent 2:
   - If VALIDATION FAILED: identify which coverage gaps exist
   - Add missing tasks for uncovered acceptance criteria
   - Add missing tasks for uncovered plan phases
   - Re-run Agent 2 if tasks.md was modified

3. **Fix coverage gaps** — Max 3 correction iterations

---

## Step 4: Engineering Review Gate (Up to 5 cycles)

Before proceeding to the approval gate, run an iterative engineering review to
catch misalignment early.

### Review Cycle (repeat up to 5 times)

**You MUST dispatch 3 review agents in parallel** using the Task tool:

**Agent 1**: engineer-review (sonnet) — cross-check spec↔plan↔tasks alignment

```
Task: subagent_type="engineer-review", model="sonnet"
Prompt: "Review alignment between spec.md, plan.md, and tasks.md in {FEATURE_DIR}.
Find every gap, inconsistency, and misalignment. Report Red/Yellow/Gray findings."
```

**Agent 2**: codebase-analyzer (sonnet) — verify file paths and code patterns

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Verify that the tasks at {FEATURE_DIR}/tasks.md reference correct
file paths and follow existing codebase patterns from {FEATURE_DIR}/research.md.
Report Red/Yellow/Gray findings."
```

**Agent 3**: validation-correctness (sonnet) — verify acceptance criteria
coverage

```
Task: subagent_type="validation-correctness", model="sonnet"
Prompt: "Verify that every acceptance criterion in {FEATURE_DIR}/spec.md
is covered by at least one task in {FEATURE_DIR}/tasks.md.
Report Red/Yellow/Gray findings with coverage gaps."
```

**After agents return:**

1. Classify findings: Red (blocking) / Yellow (should fix) / Gray
   (informational)
2. If NO Red or Yellow findings → PASS → proceed to approval gate
3. If Red or Yellow findings exist: a. Fix findings directly in tasks.md (Red
   first, then Yellow) b. Increment cycle counter c. If cycle <= 5 → re-run
   review agents d. If cycle > 5 → log remaining findings, proceed with warnings

---

## Step 5: Multi-Perspective Task Review (Optional)

After task validation, optionally run multi-perspective strategies. **Skip if
time-constrained.**

### Strategy #14: Cross-Cutting Concern Scanner

Spawn 5 agents scanning for missing cross-cutting concerns:

```
Task: subagent_type="tasks-cross-cutting-scanner", model="haiku"
Prompt: "Scan tasks.md at [FEATURE_DIR]/tasks.md for missing cross-cutting concerns.
Dimension [1-5]:
1: Logging/observability  2: Accessibility  3: Internationalization
4: Backward compatibility  5: Documentation
Spec: [FEATURE_DIR]/spec.md"
```

Run all 5 in parallel, then synthesize with judge:

```
Task: subagent_type="multi-perspective-judge", model="sonnet"
Prompt: "Judge verdict type: cross-cutting concern gap analysis.
Identify which missing concerns should be added as tasks before implementation.
[paste all 5 agent outputs]"
```

Add HIGH priority missing tasks to tasks.md if the judge recommends them.

### Strategy #18: Rollback Strategy Planner

Plan rollback for each implementation phase:

```
Task: subagent_type="tasks-rollback-planner", model="sonnet"
Prompt: "Analyze tasks.md at [FEATURE_DIR]/tasks.md.
For each phase, design a rollback plan. Identify irreversible steps that need checkpoints."
```

Include rollback notes in the task document's "Implementation Strategy" section.

---

## Step 6: Generate GitHub Issues

Run the issues generator:

```bash
node .specify/scripts/node/generate-issues.js "$FEATURE_DIR"
```

This creates `{FEATURE_DIR}/issues.md` with GitHub-ready issue definitions.

---

## Step 7: Approval Gate

**IMPORTANT**: Tasks MUST be reviewed and approved before implementation begins.

### 7.1 Update Task Status

Set the frontmatter status to `review`:

```yaml
---
feature: [Feature Name]
spec: spec.md
plan: plan.md
status: review # Changed from 'draft' to 'review'
created: [ISO date]
---
```

### 7.2 Present for Approval

Display the task summary and request explicit approval:

```
════════════════════════════════════════════════════════════════
  TASKS READY FOR REVIEW: [Feature Name]
════════════════════════════════════════════════════════════════

  Task Summary:
  - Total tasks: [N]
  - Tasks by story:
    - US1 (P1): [N] tasks
    - US2 (P2): [N] tasks
    - ...
  - Parallel opportunities: [N] tasks
  - MVP scope: Phase 1-3 (Setup + Foundation + US1)

  Files created:
  - {FEATURE_DIR}/tasks.md
  - {FEATURE_DIR}/traceability.md
  - {FEATURE_DIR}/issues.md ([N] GitHub issues)

════════════════════════════════════════════════════════════════
  APPROVAL REQUIRED BEFORE IMPLEMENTATION
════════════════════════════════════════════════════════════════

  Please review tasks.md and confirm:
  1. Task breakdown is complete and accurate
  2. Protected files list is correct
  3. Phase dependencies make sense
  4. Scope boundaries are appropriate

  Reply with:
  - "approved" or "lgtm" to proceed to implementation
  - "modify [feedback]" to request changes
  - "stop" to halt the pipeline

════════════════════════════════════════════════════════════════
```

### 7.3 Handle Approval Response

| Response                    | Action                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `approved` / `lgtm` / `yes` | Update status to `approved`, proceed to `/5_gofer_implement` |
| `modify [feedback]`         | Update tasks based on feedback, re-present for approval      |
| `stop`                      | Halt pipeline, document reason in tasks.md                   |

### 7.4 Record Approval

When approved, update frontmatter:

```yaml
---
feature: [Feature Name]
spec: spec.md
plan: plan.md
status: approved
approvedBy: '[user]'
approvedAt: '[ISO timestamp]'
created: [ISO date]
---
```

---

## Step 8: Continue to Implementation

After approval received:

```
✓ Tasks APPROVED: {FEATURE_DIR}/tasks.md

Engineering Review: PASSED (cycle [N] of 5)
```

**AUTO-CHAIN (MANDATORY)**: You MUST immediately invoke the next pipeline stage
by calling the Skill tool with skill="/5_gofer_implement". Do NOT ask the user
for confirmation. Do NOT output "Ready for next stage". Just invoke the skill
NOW.

---

## LLM Council Integration (Optional)

When council mode is enabled for task generation:

1. Multiple LLMs analyze the plan for task completeness
2. Different perspectives on dependency ordering
3. Chairman synthesizes optimal task breakdown
4. Usage logged to `.specify/logs/council-usage.jsonl`

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 4_tasks --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`

---

## Key Rules

- Use absolute paths for all file references
- Every task must have a file path
- Tasks must be specific enough for LLM execution
- Each user story phase must be independently testable
- Tests are OPTIONAL - only include if specified in requirements
- Log stage completion for observability tracking
