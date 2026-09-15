---
name: 5_gofer_implement
description: "Execute all tasks from tasks.md phase by phase with feedback loops and engineering review."
title: "Gofer Implement"
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
aliases: [gofer:implement]
---
---
description: Execute tasks from tasks.md to implement the feature
---

# Gofer Implement

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

During implementation, read `.specify/references/delivery-lineage.md` and keep
`.specify/specs/{feature}/delivery-lineage.json` aligned with the actual
customer code, documentation, and test files changed. Do not add internal EAI
service or repository details discovered through logs or tool output.

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
- `loop-contract.json` - Bounded eval commands and stop rules (from /1 through /4)

If an artifact is missing, read its prerequisite contract and complete the
authorized prerequisite work internally. If scope, approval or access blocks
that work, report Progress, Stop reason and Next action rather than asking
the user to run a numbered command.

---

## Spec Artifact Guard

Before implementation, `.specify/scripts/bash/check-prerequisites.sh --json
--require-tasks --include-tasks` must confirm that `{FEATURE_DIR}/spec.md`
exists, is non-empty, and is not the unfilled spec template. If the helper
reports `spec.md` as missing, empty, or `template`, stop and run
`/2_gofer_specify` before editing code. Implementation must never proceed from
`tasks.md` or `plan.md` without an authoritative spec for acceptance criteria
and protected boundaries.

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
# Start a fresh supported AI coding app session
# Read .specify/specs/{feature}/session-checkpoint.md
# Continue with /5_gofer_implement or the stage named in the checkpoint
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
   - **Required**: loop-contract.json (bounded loop objective, eval commands,
     maximum iterations, stop conditions, and escalation rules)
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
6. **Loop evidence tasks**: eval command tasks, ledger append tasks, and
   stop/escalation rules

---

## Step 7: Execute Implementation

### Loop Contract Preflight

Before editing code, run:

```bash
node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 4_tasks --init --json
```

If this reports contract blocking findings, repair `loop-contract.json` before
editing code. If `loop-contract.json` was initialized for an older feature, keep
going but make sure task execution appends real `loop-ledger.jsonl` evidence
before this stage completes.

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
6. **Loop evidence**: After each focused implementation/check-repair loop,
   append a ledger record:

   ```bash
   node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 5_implement --record '{"iteration":1,"action":"<command-or-review>","result":"pass","summary":"<evidence summary>"}' --json
   ```

   Use `result: "fail"` or `"blocked"` when a check fails and include a
   material `nextAction`. Stop and escalate instead of continuing silently when
   the same action reaches `humanEscalation.maxFailedIterations`.

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

- Fix failures caused by the current task within its approved edit scope before proceeding.
- Record unrelated test, lint or type failures separately. Do not turn them into an unlimited repair project.
- Required release and security checks still block release. Never skip or weaken them to pass.
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

1. Record the failure and its effect on the agreed outcome.
2. Use the priority checker to retain the next required task and its dependencies.
3. Continue only explicitly approved independent work; never silently skip a required task.
4. Use the bounded blocker controller. Do not repeat a question or reset its retry budget.

### If Blocked

1. Inspect the actual error and verify the command, route, environment and existing access.
2. Check whether the agent caused the failure and whether an authorized repair is within the task scope.
3. Use one safe investigation and bounded recovery, not repeated blind attempts. Read-only logs may establish the cause without replaying a mutation.
4. Before a technical escalation, attach current diagnosis to the blocker helper ask event. State what the user must change and why.
5. Record the blocker in tasks.md. Keep the agreed priority; propose a scope change if a prerequisite needs broader edits.

### If Something Goes Wrong (Rollback)

1. **STOP immediately** - don't make more changes
2. **Assess damage**:
   ```bash
   git status
   git diff
   ```
3. Preserve unrelated work. Identify the exact changes made by this task and propose a narrow, reversible repair. Never reset the checkout, discard user changes, or run a destructive rollback without explicit approval.
4. **Document** what went wrong in tasks.md
5. **Retry** with modified approach

---

## Step 10: Completion Validation

After all tasks complete:

1. **Verify all tasks marked [X]**
2. **Check implementation matches spec**
3. **Run automated tests** if they exist
4. **Validate against plan.md architecture**
5. **Run loop audit in strict mode**:

   ```bash
   node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 5_implement --json --strict
   ```

   If the audit fails, implementation is not complete. Repair the contract,
   append missing ledger evidence, run the failing eval command, or escalate
   according to the stop condition.

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

After implementation complete, strict loop audit passes, and review gate passes,
update the stakeholder-facing implementation record:

1. Update `{FEATURE_DIR}/working-backwards-prfaq.md`.
   - In "The Launch" and Delivery / Operations FAQ, describe what is now built.
   - Add "What changed from plan" when implementation differs from `plan.md`,
     `tasks.md`, or stakeholder-approved scope.
   - Link to code/test evidence, `loop-ledger.jsonl`, and any preview evidence.
2. Write `{FEATURE_DIR}/prfaq-history/05-implement.md` as an immutable
   implementation snapshot.
3. Update `{FEATURE_DIR}/business-owner-summary.md` if implementation changed
   process, scope, user-facing behavior, assumptions, or success metrics.
4. Update `{FEATURE_DIR}/cto-architecture-summary.md` if implementation changed
   architecture, EAI Platform/Azure usage, auth, tenancy, data, contracts, or
   integration boundaries.
5. Update `{FEATURE_DIR}/stakeholder-review-index.md` with:
   - Business Owner review ask for implemented behavior and demo readiness.
   - CTO review ask for implementation deltas against the architecture summary.
   - Delivery review ask for completed scope, outstanding risks, and rollback
     evidence.
6. For application delivery, update `{FEATURE_DIR}/build-map.md` after each
   meaningful UI, EAI Platform, data/workflow, login/security, integration, or
   preview/release change. The latest update must explain the change in
   business terms, name the affected map area, and record any issue or fix that
   would matter to a non-technical stakeholder.
7. Do not mark implementation complete unless the existing feedback loops,
   `loop-ledger.jsonl`, and strict loop audit requirements remain satisfied.

After the stakeholder PR/FAQ artifacts are updated:

```
════════════════════════════════════════════════════════════════
  ✓ IMPLEMENTATION COMPLETE: [Feature Name]
════════════════════════════════════════════════════════════════

  Tasks: [N]/[N] completed
  Loop evidence: {FEATURE_DIR}/loop-ledger.jsonl
  Working Backwards PR/FAQ: {FEATURE_DIR}/working-backwards-prfaq.md
  PR/FAQ implementation snapshot: {FEATURE_DIR}/prfaq-history/05-implement.md
  Build map: {FEATURE_DIR}/build-map.md
  Stakeholder review index: {FEATURE_DIR}/stakeholder-review-index.md

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

After required implementation evidence and approval checks pass, read and
follow `.specify/commands/6_gofer_validate.md` in the same conversation under
the Continuation And Stop Contract. A proposed tool call is not execution;
inspect the returned result and continue authorized validation. Preserve all
material/user gates and do not ask for a numbered command.

---

## Resumption Support

If implementation was interrupted:

1. Parse tasks.md for `- [X]` completed tasks
2. Find first incomplete task `- [ ]`
3. Resume from that task
4. Report what was already done

**Note**: Implementation is stateful - it resumes from the last completed task.

---

## EnterpriseAI Runtime Deployment Preflight Gate

The standard Gofer workflow is the public default. EnterpriseAI deployment
preflight is migration-only and runs only when `workflowProfile` is explicitly
`enterpriseai`.

Before any deployment task emitted by `/4_gofer_tasks` completes, this stage
MUST execute deployment preflight checks for the runtime contract and deploy
doctor gate. A task that invokes `eai deploy` is not marked complete until all
of the following files are present at the workspace root and pass their
readiness checks:

| Required File             | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `eai.runtime.json`        | Provider-neutral runtime contract from the EAI app template    |
| `.eai/deploy-doctor.json` | Black-box deploy doctor evidence from the deployed app runtime |

Required commands:

```bash
eai runtime validate
mkdir -p .eai
eai deploy doctor --url <deployed-url> --format json > .eai/deploy-doctor.json
```

`/health` alone is not enough. Auth.js, runtime config, tenant/workflow config,
user-delegated PublicAPI BFF reachability, and declared smoke tests must pass
before deployment is complete. Tenant apps must not add app-only
`client_credentials` access for ordinary ResourceAPI reads, writes, files, or
search.

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
- Implement only against the reviewed `contract-pack.md`, `context-bundle.md`,
  `reuse-scan.md`, `journeys/base-journey.md`, `plan.md`, and `goal-ledger.json`.
- For application delivery, run the preview loop as soon as there is a visible
  UI and after every UI-facing change. App-delivery runs MUST NOT report UI
  work complete without `ui-review-log.md` and `ui-show-and-tell.md` evidence
  showing what opened, what screenshot/browser evidence exists, and what user
  feedback or unresolved UX questions remain.
- For application delivery, use the EAI App Template already installed in the
  workspace as the default UI lego-block source. Any create-new UI concept must
  be justified in the plan and show-and-tell artifacts.
- For application delivery, implement on EAI Platform first, including the EAI
  app template, and Azure second: use the EAI scaffold, PublicAPI/object
  types/workflows/block catalog, ResourceAPI/`eai resources schema`, tenant/app
  enrollment, provisioning, diagnostics, and Azure-compatible
  deployment/supporting services before any non-EAI exception. Do not introduce a
  non-EAI primary runtime, database, hosting platform, or app stack unless
  `plan.md`, `service-fit-matrix.md`, and decision artifacts record it as an
  explicit exception.
- Before implementing UI, run or inspect `eai --describe`, `eai blocks list`,
  `eai blocks describe <id>` for every selected block, and
  `eai resources schema --format json`. Implementation notes must cite the block IDs,
  required resources, bindings, package lane, coupling status, Storybook story
  IDs, theme override points, and any explicit custom-block exception.
- Reject unknown component names during implementation unless `tasks.md` and
  `ui-show-and-tell.md` explicitly record a custom extension block, manifest,
  and user-visible rationale.
- Treat package-profile, block-porting, source-platform decoupling, and public-readiness
  tasks as first-class implementation tasks, not polish. Update
  `{FEATURE_DIR}/goal-ledger.json` whenever a task changes an owner, target
  metric, delivery state, promotion criterion, or re-loop trigger. External and
  hybrid profile work is incomplete until package exports, Storybook stories,
  theme overrides, consumer smoke checks, and unsupported custom-block
  exceptions are resolved or explicitly deferred by decision artifacts.
- Do not let public or hybrid package lanes import source-platform internals directly.
  Use `eai resources schema`, an adapter boundary, or an approved
  restricted-source exception; record the coupling status in implementation
  notes and `ui-review-log.md`.
- For EAI app delivery, read `.specify/references/platform/eai-repo-contract.md`,
  `.specify/references/platform/eai-error-catalog.yaml`, and
  `.specify/specs/{feature}/eai-preflight.md` before remote platform changes.
- Carry forward the last completed gate, blocked gate, and next recovery
  command from `eai-preflight.md` whenever provisioning, object-type publish,
  schema/storage health, workflow readiness, or preview readiness changes.
- After any failed `eai` command, run `eai errors explain <code-or-reason>
  --format json` when advertised before proposing a fix. If the command is not
  advertised, match `.specify/references/platform/eai-error-catalog.yaml`. Run
  read-only diagnostics before mutating fixes, ask for approval before tenant
  membership or admin changes, and stop at the guidance retry/escalation
  condition instead of repeatedly rerunning the same command.
- If Object Type seed reports `app_manifest_validation_failed`, update the CLI,
  run `eai types validate`, and run one dry run. Retry once through the named
  CLI command. Do not hand-build a PublicAPI manifest or change source names and
  slugs to match an HTTP request model.
- Before the first mutating Object Type seed, require
  `app-manifest-name-slug-negotiation-v1` in the JSON agent-guide capabilities.
  Require the dry-run JSON to report `dryRun: true`,
  `publishingMode: app-manifest`, the `explicit-name-and-slug` preferred shape,
  and the exact declared pairs. The dry run is source and preferred-shape
  evidence; it does not prove deployed support. Require the actual mutating
  result to record the shape used. If proof is missing, block the mutating seed,
  update the CLI, and repeat the read-only checks.
- Trace every Object Type from its PascalCase source `name` to its exact declared
  kebab-case `slug`. Relationships, Curate resource routes, query fields,
  `useResources`, and `client.resources` must use that slug. Stop implementation
  if generated code sends a PascalCase transport value or derives another slug.
- Treat resource provisioning, object-type publish, schema/storage health, and preview readiness as separate gates even when the CLI reports progress in a single run.
- Track workflow readiness alongside those gates; do not collapse it into
  provisioning, schema/storage health, or preview status.
- Use `eai app provision <key> --tenant-id <tenant-id> --select --format json`,
  `eai provision entra --force --redirect-uri <confirmed-callback-uri>`,
  `eai types seed --tenant-key <key> --tenant-id <tenant-id> --format json`,
  `eai resources schema --tenant-id <tenant-id> --format json`,
  `eai resources storage doctor --tenant-id <tenant-id> --format json`, and
  `eai verify storage --tenant-id <tenant-id>` in the recovery order recorded
  by the preflight artifact instead of improvising a new sequence. Use EAI
  `--debug` flags only with explicit user approval, and never write private
  hostnames, tenant IDs, client IDs, tokens, or raw debug output to committed
  artifacts.
- For v4 passive ResourceAPI search, treat `capabilities.search.fulltext`,
  `capabilities.search.hybrid`, and `capabilities.search.vector` from
  `eai resources storage doctor --tenant-id <tenant-id> --format json` as
  separate readiness states. If hybrid/vector are unavailable but fulltext is
  ready, use `eai resources search "<query>" --fulltext --tenant-id <tenant-id>`
  and record semantic search as a deferred platform capability only when the
  business scenario genuinely requires it. Do not apply this fallback to legacy
  v1/v3 or active ResourceAPI behavior.
- If a browser or runtime auth log reports `AADSTS50011`, `redirect_uri`,
  "reply URL specified in the request does not match", or
  `/api/auth/callback/microsoft-entra-id`, match
  `EAI_ENTRA_REDIRECT_URI_MISMATCH` in the error catalog. Confirm `eai whoami`
  and tenant selection first, then use EAI Entra provisioning to register the
  confirmed callback URI before asking the user to edit Azure manually. Record
  only a redacted callback route pattern and recovery status in implementation
  notes or validation artifacts.
- If `eai user invite` fails with `EXTERNAL_SERVICE_ERROR`, a 5xx response, or
  `user_invite_external_service_existing_member`, treat it as a tenant-member
  recovery flow: run `eai user list --tenant <tenant-id> --search <email>
  --format json`, use `eai user role set --tenant <tenant-id> --member-id
  <member-id> --role tenant-admin --format json` only when an existing direct
  member is verified and the user approves, verify the read-back, and tell the
  affected app user to sign out and sign back in because Auth.js session or JWT
  role data may be cached. Do not edit databases or cloud portals directly
  unless EAI guidance reports an operator-only block.
- If platform user lookup or membership prerequisite calls fail with
  `MISSING_TENANT`, `app_token_tenant_context_required`, or "Tenant context
  required for app tokens", treat it as a tenant-scoped route/context issue
  before treating it as a tenant-member data issue. Run `eai errors explain
  app_token_tenant_context_required --format json` when advertised, confirm
  `eai whoami` and `eai tenant list --format json`, and retry through
  `/v4/platform/tenants/<tenant-id>/users/by-email?email=<email>`,
  `/v4/platform/tenants/<tenant-id>/users/<oid>/memberships`,
  `/v4/platform/tenants/<tenant-id>/members`, and
  `/v4/platform/tenants/<tenant-id>/role-definitions`. Do not change Entra,
  databases, tenant members, or role definitions until the tenant-scoped route
  check is complete; if it still fails, escalate with redacted route shape,
  status, server code, CLI version, active tenant slug, and deployed
  PublicAPI/AdminAPI versions if visible.
- For application delivery, implement the four-step-or-fewer AI-augmented
  process as the user-facing spine. Each step must preserve its business goal,
  AI assistance mode, contextual prefill or conversational support, completion
  criteria, human controls, audit trail, and fallback/escalation path.
- Preserve dual-state delivery discipline: when a capability stays in `mock` or
  `hybrid`, record why, what promotion criteria remain, and what validation
  evidence is still required before it can move to `live`.
- For application delivery, after every UI-facing change to page layout,
  component choice, theme, copy, data binding, or interaction behavior, run the
  preview helper before reporting the task complete:
  ```bash
  node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --require-scenarios --open auto --screenshot --change "<change summary>"
  ```
  Use `run.bat dev 3001` on Windows. Use `--url <preview-url>` only when a
  server is already running. Report the opened URL and screenshot path to the
  user quickly. Append the run, self-review, and any known visual risks to
  `{FEATURE_DIR}/ui-review-log.md`. Also update
  `{FEATURE_DIR}/build-map.md` with the affected map area, plain-language
  status, business impact, and next step.
- For application delivery, do not mark a UI task complete unless
  `{FEATURE_DIR}/business-scenarios.json` maps every affected user story to its
  screens and executable browser tests, and the preview helper records a
  passing `business-scenario-report.json`. `--skip-scenarios` is permitted only
  for an intentional red test-first run; it is never completion evidence.
- Use the host's integrated browser for the visible click-through when
  available and Playwright/Cypress for the repeatable automated gate. Exercise
  the screens in business order, verify the visible completion signal, and
  inspect console/network failures after interactions rather than treating a
  page-load screenshot as functional evidence.
- For application delivery, show each new MVP preview to the user as quickly as
  possible after the latest UI-facing change opens in a browser and has
  screenshot, local render proof, or Playwright-style self-review evidence in
  `{FEATURE_DIR}/ui-review-log.md`. Update `{FEATURE_DIR}/ui-show-and-tell.md`
  with the URL, screenshot, user feedback, changes made, and open UX questions.
- For application delivery, after the first concrete UI direction is visible
  and before treating platform selection as complete, update
  `{FEATURE_DIR}/service-fit-matrix.md` with
  tenant-aware evidence from `eai --describe`, `eai whoami`, `eai tenant
  select`, `eai resources schema --format json`, `eai workflow readiness
  --format json`, `eai verify calls --format json`, or equivalent approved
  platform evidence. The matrix must distinguish
  accessible now, purchasable but unavailable now, and unavailable without new
  platform work.
- For non-app work, skip the preview, show-and-tell, branding, and service-fit
  gates while preserving the same numbered stage flow.
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
