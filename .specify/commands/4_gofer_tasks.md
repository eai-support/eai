---
name: 4_gofer_tasks
description: "Break down the implementation plan into dependency-ordered, parallelisable tasks."
title: "Gofer Tasks"
category: pipeline
surfaces:
  - claude
  - claude-mirror
  - copilot
  - vscode
  - codex
  - gemini
  - github-prompts
  - agents-skills
  - system-skills
aliases: [gofer:tasks]
---
---
description: Generate actionable task breakdown from implementation plan
---

# Gofer Tasks

## Continuation And Stop Contract
<!-- gofer:continuation:start -->

1. Preserve the requested scope and mode, including read-only, plan-only, research-only and MVP work. Keep the full applicable pipeline, stage functions, artifacts, reviews and validation; do not expand an MVP into an unapproved release.
2. After a stage's required evidence is complete, read and follow the next internal file in .specify/commands/ in the same conversation. Do not require a numbered command or a host-specific skill dispatcher. Optional helpers remain optional; maintenance and control commands do not start delivery work.
3. After explicit business-specification approval, continue routine planning, tasks, implementation and validation within that approved scope. Record the approval source and scope; missing or ambiguous approval is not approval. A proposal or generated status is not user consent.
4. Preserve any explicit plan/task approval requirement unless it is already satisfied by recorded user approval covering that work. Rejected, revoked, changed or unclear approval requires a pause. Never invent approvedBy, approvedAt or a new approval event when reusing an existing approval.
5. Pause for material scope, security, cost, deployment, destructive or protected files/boundary changes and any outstanding user gate. Business approval does not authorize publishing, spending, external changes or bypassing host permissions. Complete safe authorized work without bypassing the blocked gate.
6. A tool proposal is not execution. If host consent is required, wait for it. After the tool result or approved proposal returns, inspect the result and resume the next authorized action within approved scope; do not end with only a plan or a proposed tool call. A denied tool or unavailable capability must not be bypassed through another host or CLI.
7. Use the current agent's available native tools. Optional Gofer/MCP tools are conveniences, not prerequisites. If the current agent lacks a required capability, report that limitation and the safe next action; do not pretend a handoff button transfers control automatically.
8. Stop after research only when research-only work was requested, the user paused, or a real gate blocks progress. Otherwise continue to specification. At validation, report completion only when the requested scope's required evidence passes; failures remain unfinished work.
9. Respect budget, context and retry limits from the existing loop contract. Repair safe within-scope failures only within those limits. Preserve a checkpoint before an orderly context stop; resume by reading its recorded stage and rechecking scope, approvals and evidence. Never claim an abrupt host termination was handled.
10. Report concise Progress during work. At every controlled stop, report Progress, Stop reason and Next action, including the exact missing input or approval and unfinished work. Reasons are requested scope complete, user pause, approval required, material change, missing capability/access, validation blocked, or budget/context/retry limit. Stage completion alone is not pipeline completion.

**Blocker Mediation**

- Before repeating a failed action or asking for missing input, read .specify/references/blocker-mediation.md and inspect the private blocker register with gofer-blocker-control.mjs. Reuse the same state directory and goal, subject and condition keys across stages, restarts and surfaces. Different wording, models or tools do not create a new blocker.
- Classify the cause first. Missing user decisions, access, external dependencies and unavailable capabilities require a recorded wait. Reserve an ask event before asking; ask once, explain the business impact and required change, then stop affected work. An unanswered question is not new evidence. Do not poll or rephrase it to keep running.
- Technical ask events require a fresh verification file under .specify/references/priority-outcome-protection.md: actual diagnosis, self-cause check and why no authorized repair is available. Business choices need no failed command. For feature tasks, use gofer-priority-check.mjs and the saved direction before switching work; this does not start delivery during maintenance or conversation.
- For AI-solvable or unknown causes, reserve each attempt before execution. Allow one investigation and one different recovery within existing tighter budgets. Record its result even when interrupted or unsuccessful. An unfinished reservation must not launch again. Do not reset the register, change keys or switch surfaces to obtain more attempts.
- Resume only after a real user answer or changed external evidence has been recorded and checked. The helper allows one evidence-backed resumption; exhausted limits need human review. Never invent approval or evidence. Successful model output and a running server do not resolve a blocker without the relevant check.
- Save the blocker, unfinished tasks and next action before stopping. Continue only approved tasks that do not depend on it. Keep the original goal; update specs, plans, tasks and validation for accepted direction changes, and reopen stale checks. Do not quietly drop requirements to make progress.
- Use node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <private-state-directory> --event <private-event.json> before controlled actions; inspect with --state-dir alone, or add --task T001 for an independent task. A denied action, invalid record or missing helper means stop and explain the limitation, not bypass it. Use the installed plugin script path if no repo scaffold exists. Conversation-only work uses a private session state directory and does not require app setup or feature files.
- Strict loop validation checks every recorded feature blocker. Shared instructions guide native chats; this helper cannot intercept calls that a host sends directly. Do not claim native enforcement from package tests alone.
<!-- gofer:continuation:end -->

## MVP Capability-Based Validation

Use `.specify/references/mvp-capability-validation.md` as the source of
truth. Validate the work that the active feature specification requires now.
Do not apply later delivery requirements to an early MVP.

1. Create `.specify/specs/{feature}/` before app or operator-tool source work.
2. Keep `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and the validation scope aligned.
3. Mark each relevant capability as `not_applicable`, `planned`, `implemented`, `verified`, or `blocked`.
4. Require evidence only for an implemented capability or a capability required by the current delivery decision.
5. Treat `run.sh`, `run.bat`, and `run.ps1` as launch evidence only. They do not prove authentication, sessions, EAI access, or deployment readiness.
6. For a user-facing change, store the local HTTP check, screenshot, and review outcome in the feature validation report.
7. If browser validation is blocked, mark that user journey `unverified`. Do not call it complete.
8. If the user changes scope, update the feature artifacts before continuing. Explain what changed, what remains valid, and what now needs evidence.
9. Use truthful completion language. For example: `The server runs. Authentication is not in the current MVP scope.`
10. When the feature claims a release or deployed outcome, create `release-capability-ledger.md` from `.specify/templates/release-capability-ledger-template.md`.
11. Do not report a release complete or score 100% when a required capability is missing from traceability, remains on an open PR, is absent from the release branch, or lacks required deployed evidence.

## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using the application signals in `.specify/commands/0_gofer_start.md`.
2. Create `.specify/specs/{feature}/` and record the active delivery scope before app or operator-tool source work.
3. If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision and mark app-only capabilities `not_applicable`. Do not run `eai whoami`, `eai tenant select`, `eai init`, or `/gofer:eai-first-run`.
5. For local MVP app work, validate the implemented user journey, repo runner, and preview evidence. Do not require EAI setup, authentication, or deployment when the active specification does not require them.
6. When the feature uses EAI Platform services, requires a tenant, or prepares deployment, run `eai whoami` and record the EAI readiness evidence in `eai-preflight.md`.
7. When the feature creates, changes, or validates an EAI Platform app integration, run `node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json`. A missing checker or status other than `ready` blocks that EAI capability. It does not block unrelated local MVP work.
8. When authentication is implemented or required, validate provider, callback, sign-in, session, first protected API call, and safe denied access.
9. When deployment is requested or claimed, require the relevant EAI template, security, configuration, and deployment evidence before completion.
10. For durable app delivery, use EAI Platform first, Azure second, and every other stack only by explicit exception.
11. If the user changes scope, update `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and validation scope before continuing. Explain the business effect and evidence change.
12. Do not accept copied marker files, partial scaffolds, or custom templates as readiness evidence for an EAI capability.
13. Do not write tokens, secrets, private tenant IDs, or local `.env` values into Gofer artifacts; record only product-safe readiness status and evidence.

**Authentication Access Decision**

When adding or changing authentication, read `.specify/references/platform/eai-auth-access.md`. Ask: **"Who should be able to use this app: only members of its EAI workspace (recommended), or any authenticated EAI user?"** Default to `workspace-only`. Wait for the answer before changing auth code. An unanswered question must not widen access. Preserve stricter existing rules. Record the answer in the feature spec; do not repeat a confirmed question unless its scope changes.

Confirm the sign-in method separately: EAI sign-in or client SSO through EAI. Verify platform support and CLI syntax; do not invent SSO commands. Enforce trusted server-side workspace membership and app permissions. A session, CIAM directory ID, or email domain alone is not workspace access. Platform-wide sign-in never grants access to another workspace's data. Test allowed and denied users, revoked membership, unavailable membership checks, and cross-tenant requests. These checks apply only when authentication is implemented or required, not to non-app work or an auth-free local MVP.

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Google Antigravity (Gemini models): Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

## Business-Friendly Progress Contract
<!-- gofer:business-progress:start -->

Default user-facing updates must be concise, business-level, and easy to scan.
Keep the technical work rigorous in artifacts, tests, logs, and code, but do
not lead with implementation jargon unless the user asks for it.

Use ASD-STE100 Simplified Technical English as the target writing standard for
all Gofer-authored chat, documents, commands, summaries, PR notes, error
guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of
ASD; do not bundle the protected ASD dictionary and do not claim ASD
certification.

1. Explain progress as what is being connected, changed, checked, or fixed and
   why it matters to the business outcome.
2. Use the running build map: create or update
   `.specify/specs/{feature}/build-map.md` from
   `.specify/templates/build-map-template.md` for application delivery, and
   refer to its plain-language areas in progress updates.
3. When there is a problem, translate it into business impact, current status,
   next action, and what input or approval is needed. Keep raw stack traces,
   command logs, IDs, and acronyms out of chat unless asked.
4. If the user asks for technical depth, provide it on request and point to the
   durable artifact that contains the evidence.
5. Prefer a compact update shape:
   - `Working on`: the build-map area or stakeholder outcome
   - `Why it matters`: user/business impact
   - `Status`: done, checking, fixing, blocked, or needs decision
6. Use one action per instruction.
7. Keep instructions to 20 words or fewer where possible.
8. Use active voice unless the actor is unknown or not important.
9. Use simple verb forms: simple present, simple past, simple future,
   infinitive, or imperative.
10. Define acronyms on first use and use approved project terms.
11. Avoid idioms, marketing adjectives, vague praise, and hedging.
12. Use vertical lists for complex information and one topic per paragraph.
13. For errors, state what happened, why it matters, what to do next, and the
    exact safe command when one exists.
14. Do not remove technical validation, security checks, EAI preflights, tests,
   or loop evidence. This contract changes presentation, not engineering
   standards.
15. Before each user-facing reply, check that it leads with the business effect,
    uses concise simple language, and includes only useful technical detail.
16. If any check fails, rewrite the reply before sending it.
**Business Updates And Goal Checks**

Use `.specify/references/business-updates-and-goal-checks.md`. Before each reply, explain the result, business effect, and next action in plain language. For progress, use two or three short sentences. Run `node .specify/scripts/node/gofer-response-check.mjs --input <private-draft-file>` before sending a drafted progress update; rewrite failed drafts. Use `--kind answer` for answers and `--technical` only when technical detail was requested. Do not repeat unchanged progress. This helper cannot intercept messages that the host sends directly.

Before each work batch, read the current goal, specification, tasks, and latest findings. After new knowledge or an approved change, update affected feature documents and explain the effect. Never weaken acceptance criteria to match failing code or invent user approval. Mark a task complete only after its linked checks pass; reopen affected tasks when evidence is stale. For app and non-app features with a spec and tasks, enable `requireDeliveryCheckpoint` in `loop-contract.json` and run `node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir>` before advancing or claiming completion. Follow the reference to capture a reviewed checkpoint, not merely to clear a failure. Keep existing MVP exemptions, reviews, loops, and release gates. Conversation-only requests need no feature files.

**Priority And Outcome Protection**

Follow `.specify/references/priority-outcome-protection.md`. Before implementing a task, record the latest material user direction in decisions.md and maintain priority-plan.json with ordered tasks, dependencies, allowedEditScope and the current outcome. Enable requirePriorityPlan for new feature contracts. Run `node .specify/scripts/node/gofer-priority-check.mjs --feature-dir <feature-dir> --task T001` before the action, and include --workspace <repo-root> plus --changed-file for each proposed or actual changed repo-relative path. Follow its nextTask; only recorded prerequisites and approved parallel work may precede the current priority. Do not switch to unrelated work when blocked. On resume, state the agreed outcome and next task in plain language after reading the last recorded direction. Keep routine conversation free of feature paperwork.

Before technical escalation, attach fresh diagnosis through the blocker helper's ask event verification field. Check the exact command, route, environment, own mistake and existing authority. Do not invent a tenant, ask for login without checking it, require an unsafe alternative, or equate administrator access with permission. Business decisions need no failing command. At completion, run the priority checker with --finish; a missing or stale outcome receipt means unverified, regardless of test scores. Use --completion for the final gofer-closed-loop-audit.mjs run; a routine drift audit alone does not prove completion. Preserve detailed test results, early local MVP scope, non-app work, independent approved tasks and all release/security checks.

<!-- gofer:business-progress:end -->

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. Restart only this app. Before stopping a process, verify its exact checkout, process ID, start time and command, then recheck immediately before stopping it. Never stop another app, an unknown process, or every process on a port. If ownership is uncertain, leave it running and ask the user. Inspect older runners before use; do not run one that kills by port alone.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
9. Check the exact preview page and the current implemented user journey after each change. A running process, open browser, screenshot alone, error page or dry run is not proof that it works. Say ready to view only after those checks pass. Otherwise explain what is unchecked or failing; do not claim readiness. Record fresh browser and test evidence. Local MVP checks cover only implemented behaviour; do not add future auth or deployment gates. Keep showing clearly labelled drafts without adding approval stops.
<!-- gofer:app-preview-runner:end -->

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Delivery Lineage Contract

Before completing this stage, read `.specify/references/delivery-lineage.md`
and update `.specify/specs/{feature}/delivery-lineage.json` with work-order
nodes linked to the requirements, decisions, and customer files they will
change.

## Execution Profile And Task Sizing

Preserve the selected depth from earlier stages:

- **fast**: for `docs-only` or very small low-risk changes, generate a short
  task list with only the work needed to deliver the change and its
  verification.
- **standard**: generate normal dependency-ordered tasks with tests and
  traceability.
- **full**: add tasks for contract compatibility, security review, migration or
  config safety, rollout/rollback, and blast-radius verification.
- **dynamic**: require `workflow-dag.md`, then generate shard-aligned tasks,
  reducer tasks, verifier/refuter tasks, budget/stop-condition checks, and a
  resumable progress ledger before implementation starts.

Every task should name a real file or directory when known. If ownership or
files are unknown, mark that as `unknown` and add a discovery task instead of
fabricating a path. Keep optional artifacts out of the plan unless they support
the selected risk label. Do not convert dynamic shard tasks into implementation
work until the DAG confirmation gate is resolved.

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)
- `plan.md` - Implementation plan (from /3_gofer_plan)
- `goal-ledger.json` - Goal and re-loop contract (from /1 and /2)
- `loop-contract.json` - Bounded evaluation and stop-condition contract (from /1 and /3)

If missing, prompt user to run the prerequisite stage.

---

## Spec Artifact Guard

Before task generation, `.specify/scripts/bash/check-prerequisites.sh --json`
must confirm that `{FEATURE_DIR}/spec.md` exists, is non-empty, and is not the
unfilled spec template. If the helper reports `spec.md` as missing, empty, or
`template`, stop and run `/2_gofer_specify` before generating tasks. Do not
infer tasks from `plan.md` alone because acceptance criteria and protected
boundaries live in the spec.

## Outline

1. Context health check
2. Load context (lightweight)
3. Dispatch task generation agents (sub-agents handle heavy generation)
4. Review agent outputs
5. Engineer review gate
6. Optional multi-perspective review
7. Approval gate
8. Output: `tasks.md`, `traceability.md`, `issues.md`,
   `working-backwards-prfaq.md`, `prfaq-history/04-tasks.md`, and
   `stakeholder-review-index.md`; for app delivery, tasks must also preserve
   and update `build-map.md`

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
   - Note whether `loop-contract.json` exists. If missing, initialize it with
     `node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 4_tasks --init --json`
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
- {FEATURE_DIR}/loop-contract.json — eval commands, max iterations, stop conditions, and human escalation rules
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
7. Loop Evidence Tasks:
   - Task(s) to run each loop-contract eval command at the right phase boundary
   - Task(s) to append `loop-ledger.jsonl` records after each check-repair cycle
   - Task(s) to stop and escalate if maxIterations or stop conditions trigger

Validation checks before writing:
- Every plan phase has at least one task (GAP-02)
- Every plan task item has a corresponding task
- Every acceptance criterion maps to at least one task (GAP-03)
- Every data model entity has implementing tasks
- Every API contract endpoint has implementing tasks
- Every loop-contract eval command maps to at least one task or verification
  checklist item
- Every implementation phase explains what ledger evidence will be recorded
- Task file paths match plan.md File Structure section
- For CLI-driven platform mutations, task order must reflect authoritative
  store setup before orchestrator writes, orchestrator writes before CLI
  consumption, and platform persistence before local mirror patching.

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
- {FEATURE_DIR}/goal-ledger.json — goals, metrics, delivery states, re-loop triggers
- {FEATURE_DIR}/loop-contract.json — loop eval commands, max iterations, stop conditions, and escalation rules
- {FEATURE_DIR}/tasks.md — Task breakdown (read after Agent 1 writes it)
- {FEATURE_DIR}/data-model.md — Entity definitions (read if exists)
- {FEATURE_DIR}/contracts/ — API contracts (read if exists)

Generate {FEATURE_DIR}/traceability.md with:

1. Goal → Story → Requirement Mapping:
   | Goal ID | Metric / Target | User Story | Requirement IDs | Task IDs |

2. Requirement Trace Matrix:
   | Requirement ID | Goal ID | Plan Phase | Task IDs | Planned Code | Planned Tests | Status |

3. Acceptance Criteria Detail:
   | ID | Criterion | Task(s) | Planned Code | Planned Tests | Phase |

4. Plan Phase Coverage:
   | Phase | Task Count | Coverage % |

5. Data Entity Coverage (if data-model.md exists):
   | Entity | Implementing Task(s) | Fields Covered? |

6. API Contract Coverage (if contracts/ exists):
   | Endpoint | Contract File | Implementing Task(s) |

7. Loop Evidence Coverage:
   | Eval Command | Phase Boundary | Task IDs | Ledger Evidence | Stop/Escalation Rule |

8. Coverage Summary:
   - Plan Phases: N/N covered
   - User Stories: N/N covered
   - Acceptance Criteria: N/N covered
   - Requirements with code targets: N/N covered
   - Requirements with test targets: N/N covered
   - Loop eval commands: N/N covered
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
   - Add missing planned code/test targets for uncovered requirements
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
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: cross-cutting concern gap analysis.
Identify which missing concerns should be added as tasks before implementation.
[paste all 5 agent outputs]"
```

Add HIGH priority missing tasks to tasks.md if the judge recommends them.

### Strategy #18: Rollback Strategy Planner

Plan rollback for each implementation phase:

```
Task: subagent_type="tasks-rollback-planner", model="haiku"
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

### 6.5 Update Working Backwards PR/FAQ Delivery Plan

Before the approval gate:

1. Update `{FEATURE_DIR}/working-backwards-prfaq.md`.
   - Add Delivery / Operations FAQ content from `tasks.md`,
     `traceability.md`, `issues.md`, dependencies, phase ordering, launch
     gates, rollback/support notes, and loop eval tasks.
   - Update Evidence Links for `tasks.md`, `traceability.md`,
     `loop-contract.json`, and `issues.md`.
2. Write `{FEATURE_DIR}/prfaq-history/04-tasks.md` as an immutable snapshot.
3. Update `{FEATURE_DIR}/stakeholder-review-index.md`.
   - Mark Business Owner and CTO decisions that changed because of task
     sequencing or scope boundaries.
   - Add Delivery review ask for dependencies, protected files, MVP scope,
     parallel work, release gates, and rollback/support plan.
4. Preserve the task authorization check, reusing approval only when it covers
   the current work. The PR/FAQ and review index summarize what is ready;
   `tasks.md` remains the implementation authority.

---

## Step 7: Approval Gate

If the approved business scope already covers these tasks and no outstanding
explicit plan/task approval or material-change gate applies, record that
approval basis and continue without asking for another approval. Required
engineering reviews and task validation still apply.

Otherwise, pause for the required approval. Missing, ambiguous, rejected or
revoked approval is not authorization. Preserve user-requested review gates,
protected boundaries and all security, cost, deployment and destructive gates.

### 7.1 Update Task Status

Only when authorization is outstanding, set the frontmatter status to `review`:

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

If authorization is already covered, summarize progress, skip the approval
question and response wait, and proceed to 7.4. Otherwise display the task
summary and request the specific outstanding approval:

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
  - {FEATURE_DIR}/build-map.md (updated for app delivery)
  - {FEATURE_DIR}/loop-contract.json (updated if evaluation commands changed)
  - {FEATURE_DIR}/issues.md ([N] GitHub issues)
  - {FEATURE_DIR}/working-backwards-prfaq.md
  - {FEATURE_DIR}/prfaq-history/04-tasks.md
  - {FEATURE_DIR}/stakeholder-review-index.md

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
| `approved` / `lgtm` / `yes` | Record approval for the presented scope, then read the implementation contract |
| `modify [feedback]`         | Update tasks based on feedback, re-present for approval      |
| `stop`                      | Halt pipeline, document reason in tasks.md                   |

### 7.4 Record Approval

When reusing an existing approval, record `approvalBasis` with the original
approval source and covered scope. Set task status to `approved` only after
checking that basis and all outstanding gates. Do not fabricate a fresh user
approval, approver or timestamp. Preserve any existing explicit plan/task
approval evidence and recheck it after scope changes.

For a newly received explicit approval, update frontmatter using the actual
user response and timestamp:

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

After required reviews pass and either existing scope approval covers the
tasks or the outstanding approval is received:

```
✓ Tasks APPROVED: {FEATURE_DIR}/tasks.md

Engineering Review: PASSED (cycle [N] of 5)
```

Read and follow `.specify/commands/5_gofer_implement.md` in the same conversation
under the Continuation And Stop Contract. Do not pause merely because tasks
are ready, and do not ask the user to invoke a numbered command. Any remaining
gate must be reported with Progress, Stop reason and Next action.

---

## Ordered Runnable Task-Generation Guidance

The standard Gofer workflow is the public default. EnterpriseAI task generation
is migration-only and used only when `workflowProfile` is explicitly
`enterpriseai`.

When the workflow profile is explicitly `enterpriseai`,
`tasks.md` MUST emit deployment
tasks in the following ordered chain. Each task is independently runnable and
the ordering enforces scaffold before deployment so that runtime contract and
deploy-doctor evidence exist before any deploy command runs.

0. **EAI readiness unblock -> `eai-preflight.md`**
   - If `{FEATURE_DIR}/eai-preflight.md` is missing, stale, or blocked, emit
     only the smallest runnable unblock tasks before normal build tasks:
     install/update `eai`, run `eai login`, run `eai tenant select`, confirm a
     tenant-admin membership with `eai tenant list --format json`, initialize
     the EAI app template with `eai init <app-name> --skip-prompts
     --company-tenant <tenant-id>` when confirmed, enter the created app folder,
     and run `node .specify/scripts/node/eai-app-template-readiness.mjs --root
     . --json`.
   - Do not emit EAI app enrollment, object-type, EAI service-fit, or deployment
     tasks until the checker proves eai-init provenance and the supported
     app-template contract. Local MVP UI and implementation tasks can continue
     when the active specification records EAI capabilities as `planned` or
     `not_applicable`.
   - Never invent tenant IDs, app keys, app URLs, or platform capabilities.
     Use `eai --describe`, public EAI docs, and the user's confirmed tenant/app
     selection as evidence.
   - Do not emit tasks that establish a non-EAI primary runtime, database,
     hosting platform, or app framework. Non-EAI technologies can appear only as
     approved integration/migration/exception tasks after the EAI Platform/Azure
     fit is recorded.
1. **EAI App Template scaffolding -> `eai init`**
   - Command: `eai init <app-name> --skip-prompts --company-tenant <tenant-id>`
   - Produces the working directory and provider-neutral `eai.runtime.json`
     expected by subsequent runtime and deployment tasks.
2. **Local validation -> `eai runtime validate` and `eai verify`**
   - Commands: `eai runtime validate` and `eai verify`
   - Confirms the runtime contract, tenant/workflow configuration, and platform
     readiness before any deploy attempt.
3. **Pinned `eai major.minor` deployment tasks -> `eai deploy`**
   - Command: `eai deploy trigger --repo <org/repo>`
   - Inherits the `major.minor` pin recorded in `plan.md`.
4. **Post-deploy smoke gate -> `eai deploy doctor`**
   - Command: `mkdir -p .eai && eai deploy doctor --url <deployed-url> --format json > .eai/deploy-doctor.json`
   - Captures black-box runtime smoke evidence for `/health`, Auth.js,
     PublicAPI/BFF reachability, tenant/workflow config, and declared smoke
     tests.

<!-- prettier-ignore -->
The ordering above is non-negotiable: tasks.md MUST instruct the pipeline to scaffold before deployment, validate before deploy, invoke pinned `eai major.minor` deployment tasks, and then capture deploy-doctor evidence. Breaking the order causes deployment preflight gating in `/5_gofer_implement` to fail.

### App-Delivery Preconditions Inside Shared Stages

For **application delivery**, task generation MUST treat the UI-first
show-and-tell loop as early implementation scaffolding and fast feedback
evidence:

- If `{FEATURE_DIR}/ui-show-and-tell.md` or `{FEATURE_DIR}/ui-review-log.md` is
  missing, emit early preview/show-and-tell tasks before or alongside the first
  UI tasks so the user sees the UI quickly. Do **not** suppress downstream
  implementation only because show-and-tell evidence is still being gathered.
- If `{FEATURE_DIR}/service-fit-matrix.md` is missing or does not distinguish
  accessible now vs purchasable vs unavailable platform capabilities, emit a
  blocking service-fit task group before normal build tasks.
- The first normal build tasks must use the EAI app template, EAI CLI, EAI
  platform services, and Azure-compatible deployment/supporting services before
  any custom or third-party implementation task.
- Use the EAI App Template already scaffolded by `eai` as the default UI
  lego-block source. Any create-new UI concept must appear as an explicit
  exception task with rationale.
- Add a block-catalog task before any UI implementation task. It MUST run
  `eai --describe`, `eai blocks list`, `eai blocks describe <id>` for selected
  blocks, and `eai resources schema --format json`; task notes must cite block
  IDs, resource fields, data/action bindings, package lane, coupling status,
  Storybook story IDs, theme override points, and explicit custom-block
  exceptions.
- Add package-profile tasks that lock the external/internal/hybrid profile
  choice and the package lane before any public, shared, or app-local block
  implementation begins.
- Add block-porting tasks for every selected EAI App Template block that must
  move into a reusable package lane, including Storybook story ID coverage,
  theme override points, exports, and compatibility checks.
- Add source-platform decoupling tasks whenever a block or package lane is not
  restricted-source and still depends on source-platform internals; the task must define the
  resource-schema or adapter boundary and the regression proof that source-platform coupling is no
  longer required by the public surface.
- Add public-readiness tasks for external and hybrid profiles covering public
  exports, docs/examples where already part of the package surface,
  accessibility/theming contracts, consumer smoke tests, and unsupported
  custom-block exceptions.
- For **non-app work**, keep the shared numbered stages but skip these
  preview/show-and-tell/service-fit prerequisites.

### EnterpriseAI Contract, Reuse, and Red/Green Tasks

`tasks.md` MUST also include:

- EAI readiness unblock -> `eai-preflight.md` before any remote platform task.
- App resource provisioning -> `eai app provision` before any claim of
  object-type seeding or preview readiness.
- Object-type publish -> `eai types seed` only after provisioning and
  validation are complete.
- Object-type seed capability -> require
  `app-manifest-name-slug-negotiation-v1` before the mutating seed. Use the dry
  run to verify the preferred request shape and exact declared name/slug pairs,
  not as proof that the deployed receiver accepts that shape.
- Object-type request compatibility -> run `eai types seed --dry-run` first.
  Let the maintained CLI serialize the app manifest. Do not copy the source
  name/slug schema into a direct PublicAPI request.
- Object-type identifier use -> verify each declared PascalCase `name` keeps one
  exact kebab-case `slug` through relationship targets, Curate resource routes,
  resource query fields, `useResources`, and `client.resources`. Create a task
  to remove any generated PascalCase transport value or locally re-derived slug.
- Schema and storage health -> `eai resources schema` / storage diagnostics / `eai verify`
  before preview/runtime signoff.
- Pinned `eai major.minor` deployment tasks whenever deployment, rollout, or
  environment coordination depends on a specific EAI CLI generation.
- Contract-pack coverage tasks for actors, object types, workflows/journeys,
  permissions/tenant boundaries, APIs/events, deployment assumptions, and
  acceptance tests.
- AI-augmented journey tasks for app delivery: one task group for each of the
  four-or-fewer journey steps covering user experience, chatbot/voice/
  accessibility/translation support, contextual prefill, completion validation,
  human review, audit trail, and fallback/escalation.
- App-delivery preview/show-and-tell tasks that:
  - build the first MVP from EAI App Template blocks
  - select only known `eai blocks` IDs unless a custom-block exception exists
  - preserve package lane, external/internal/hybrid profile choice, coupling
    status, Storybook story IDs, and theme override points from the selected
    preview brief
  - apply selected branding/logo work when in scope
  - record or confirm the preview command/URL, using the repo runner before the
    first UI task
  - run the preview helper after every UI-facing change. Prefer
    `./run.sh dev 3001` on macOS/Linux/Codespaces and `run.bat dev 3001` on
    Windows:
    ```bash
    node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --require-scenarios --open auto --screenshot --change "<change summary>"
    ```
  - create `{FEATURE_DIR}/business-scenarios.json` from
    `.specify/templates/business-scenarios-template.json`; every in-scope user
    story must name its business outcome, all screens/states crossed, and the
    executable Playwright/Cypress/browser test file that proves the journey
  - add one browser test task per business scenario plus a whole-journey task
    that clicks through the screens in user order, checks visible outcomes and
    error/denial states, and fails on console errors, failed requests,
    unexpected redirects, horizontal overflow, or unsupported live claims
  - make the browser scenario command a required package script, preferring
    `test:business-scenarios`, then `test:e2e` or `test:playwright`; unit tests
    and a screenshot alone do not satisfy this gate
  - report the opened preview URL and screenshot path to the user quickly after
    each preview refresh
  - collect screenshot or Playwright-style self-review evidence
  - update `ui-review-log.md`
  - update `ui-show-and-tell.md` with what was shown, where it opened, what the
    user said, what changed next, and any unresolved UX issues
- App-delivery service-fit tasks that update `service-fit-matrix.md` using
  tenant-aware evidence from `eai --describe`, `eai whoami`, `eai tenant
  select`, `eai resources schema --format json`, `eai workflow readiness
  --format json`, `eai verify calls --format json`, or equivalent approved
  platform evidence.
- A scope-control task that checks whether any user-facing app process exceeds
  four steps and either combines/automates extra steps or records the approved
  exception and rationale.
- Reuse-before-create tasks before any new EnterpriseAI object type, API/event,
  workflow, module, or spec concept is created.
- Test-first red/green tasks: generate spec-derived tests, verify they fail
  against missing or incomplete implementation, implement in a separate task,
  then re-run validation.
- Audit-history tasks that preserve stable finding IDs, recurring findings,
  accepted exceptions, owner, expiry, and review cadence.

### CLI-Driven Platform State Ordering

When a command-line workflow is expected to update platform state, `tasks.md`
MUST order work like this unless the plan proves a different authoritative
dependency:

0. Respect the real EAI app gates before any claim of seeding, schema
   readiness, or preview readiness.
1. Define or extend the authoritative storage model.
2. Implement platform-side orchestrator writes into those stores.
3. Implement secret/config persistence if secrets or environment state are part
   of the success contract.
4. Implement CLI or UX consumption of the new platform response.
5. Add regression tests for create, repair, recovery, and failure gates.

The CLI must not be treated as the source of truth when the plan says the
platform owns persistence.

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

## Local Settings Cleanup Contract
<!-- gofer:local-settings-cleanup:start -->

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - `node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: `node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
   - Windows: `node %USERPROFILE%\plugins\eai-gofer\.specify\scripts\node\gofer-local-settings-cleanup.mjs --workspace . --apply --json`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public `eai` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.
<!-- gofer:local-settings-cleanup:end -->
