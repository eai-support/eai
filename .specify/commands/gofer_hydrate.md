---
name: gofer_hydrate
description: "Reverse-engineer specification from existing code (Hydration)."
title: "Gofer Hydrate"
category: utility
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
aliases: [gofer:hydrate]
---
---
description: Reverse-engineer specification from existing code (Hydration)
---

# Gofer Hydrate

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

---

## When to Use This Command

- **Documenting Legacy Code**: Create specs for undocumented features
- **Understanding Before Modifying**: Generate specs before changing existing
  code
- **Onboarding**: Help new team members understand feature behavior
- **Compliance**: Create formal documentation for audits
- **Refactoring Prep**: Document current behavior before refactoring

---

## Step 1: Identify Target Code

If not specified in $ARGUMENTS, ask:

```
What code would you like me to reverse-engineer into a specification?

Options:
1. Specific files or directories (provide paths)
2. A feature name (I'll search the codebase)
3. A module or component (I'll analyze its scope)
```

---

## Step 2: Spawn Analysis Agents

Launch parallel agents to analyze the code:

### Agent 1: Code Analyzer

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Analyze the implementation of [TARGET CODE].
Identify:
- Core functionality and purpose
- Data structures and state
- Public interfaces (APIs, exports)
- Side effects (I/O, network, database)
- Error handling patterns"
```

### Agent 2: Test Analyzer

```
Task: subagent_type="codebase-locator", model="haiku"
Prompt: "Find all tests related to [TARGET CODE].
Identify:
- Test file locations
- Test case names and descriptions
- What behaviors are tested
- Edge cases covered
- Missing test coverage"
```

### Agent 3: Usage Analyzer

```
Task: subagent_type="codebase-pattern-finder", model="haiku"
Prompt: "Find all usages of [TARGET CODE] in the codebase.
Identify:
- Who calls this code
- How it's used in practice
- Integration points
- User-facing features that depend on it"
```

---

## Step 3: Synthesize Feature Understanding

From agent findings, extract:

### 3.1 Core Capabilities

What does the code DO?

- Primary functions
- Secondary functions
- Edge case handling

### 3.2 Data Model

What data does it work with?

- Input types
- Output types
- Internal state
- Persistence

### 3.3 User Stories (Reverse-Engineered)

From tests and usage, derive user stories:

```
As a [user type inferred from code]
I want to [action the code enables]
So that [benefit inferred from context]
```

### 3.4 Acceptance Criteria (From Tests)

Each test case becomes an acceptance criterion:

```
Given [test setup]
When [test action]
Then [test assertion]
```

---

## Step 4: Create Feature Directory

```bash
# Determine next spec number
ls .specify/specs/ | grep -E '^[0-9]{3}-' | sort -r | head -1

# Create hydrated feature directory
mkdir -p .specify/specs/NNN-hydrated-[feature-name]/
```

---

## Step 5: Generate Specification

Write to `.specify/specs/NNN-hydrated-[feature-name]/spec.md`:

````markdown
---
id: NNN-hydrated-[feature-name]
title: '[Feature Title]'
status: hydrated
type: [feature|refactor|fix]
created: [ISO date]
source: hydration
source_files:
  - path/to/main/file.ts
  - path/to/related/file.ts
---

# [Feature Title]

> This specification was reverse-engineered from existing code using
> `/gofer_hydrate`. It reflects the **current implementation**, not necessarily
> the original requirements.

## Overview

[Description of what this feature does, synthesized from code analysis]

### Source Code

| File                | Purpose             | Lines |
| ------------------- | ------------------- | ----- |
| `path/to/main.ts`   | Core implementation | 150   |
| `path/to/helper.ts` | Helper functions    | 50    |
| `path/to/types.ts`  | Type definitions    | 30    |

## User Stories (Inferred)

### US1: [Primary User Story] (P1)

**As a** [user type] **I want to** [action] **So that** [benefit]

**Acceptance Criteria** (from tests):

- [x] [Criterion derived from test case 1]
- [x] [Criterion derived from test case 2]
- [x] [Criterion derived from test case 3]

**Evidence**:

- Test: `path/to/test.ts:25` - "[test name]"
- Usage: `path/to/consumer.ts:100`

### US2: [Secondary User Story] (P2)

...

## Functional Requirements (Observed)

### FR1: [Core Function]

The code currently:

- [What it does]
- [How it handles inputs]
- [What it outputs]

**Implementation**: `path/to/file.ts:45-67`

```typescript
// Key code snippet showing the implementation
```
````

### FR2: [Another Function]

...

## Data Model (Extracted)

### [Entity Name]

| Field   | Type   | Required | Description               |
| ------- | ------ | -------- | ------------------------- |
| id      | string | Yes      | Unique identifier         |
| [field] | [type] | [Yes/No] | [From code/type analysis] |

**Source**: `path/to/types.ts:10-25`

## API/Interface (Documented)

### Public Functions

| Function      | Parameters   | Returns | Description       |
| ------------- | ------------ | ------- | ----------------- |
| `doSomething` | `(input: T)` | `R`     | [From JSDoc/code] |

### Events/Callbacks

| Event        | Payload  | When Triggered        |
| ------------ | -------- | --------------------- |
| `onComplete` | `Result` | After processing done |

## Dependencies

### Internal Dependencies

- `path/to/dependency.ts` - [What it provides]

### External Dependencies

- `library-name` - [How it's used]

## Test Coverage Analysis

### Covered Behaviors

| Test Case                  | File                   | Status |
| -------------------------- | ---------------------- | ------ |
| [Test name from test file] | `test/feature.test.ts` | Pass   |

### Uncovered Behaviors (Gaps)

- [Functionality that has no tests]
- [Edge case not covered]

## Integration Points

### Consumers (What Uses This)

| Consumer         | How It's Used       | File              |
| ---------------- | ------------------- | ----------------- |
| [Component name] | [Usage description] | `path/to/file.ts` |

### Providers (What This Uses)

| Provider       | What It Provides | File             |
| -------------- | ---------------- | ---------------- |
| [Service name] | [Functionality]  | `path/to/svc.ts` |

## Known Issues / Technical Debt

From code analysis:

- [ ] [TODO comment found in code]
- [ ] [Deprecated pattern used]
- [ ] [Missing error handling]

## Assumptions Made During Hydration

- [Assumption about user intent]
- [Assumption about edge case handling]
- [Assumption about expected behavior]

## Recommendations

### If Modifying This Code

1. [Consideration based on code analysis]
2. [Risk area identified]

### If Refactoring

1. [Pattern that should be improved]
2. [Technical debt to address]

````

---

## Step 6: Generate Tasks (Completed)

Write to `.specify/specs/NNN-hydrated-[feature-name]/tasks.md`:

```markdown
---
feature: [Feature Name]
spec: spec.md
status: hydrated
created: [ISO date]
note: "Tasks marked complete represent existing implementation"
---

# Tasks: [Feature Name] (Hydrated)

> These tasks represent the work that WAS done to build this feature,
> reverse-engineered from the code structure.

## Overview

- **Total Tasks**: [N] (all completed - existing code)
- **Source Files**: [N] files analyzed
- **Test Coverage**: [X]%

## Phase 1: Setup (Inferred)

- [x] T001 Created directory structure
- [x] T002 Set up configuration
- [x] T003 Defined types and interfaces

## Phase 2: Core Implementation (Inferred)

- [x] T004 Implemented [core function] in `path/to/file.ts`
- [x] T005 Added [feature] in `path/to/file.ts`
- [x] T006 Integrated with [dependency]

## Phase 3: Testing (From Test Files)

- [x] T007 Unit tests for [component] in `test/unit/`
- [x] T008 Integration tests in `test/integration/`

## Phase 4: Integration (Inferred)

- [x] T009 Connected to [consumer 1]
- [x] T010 Exposed via [API/export]

## Potential Future Tasks

If extending this feature:

- [ ] T011 [Gap identified from analysis]
- [ ] T012 [Missing test coverage]
- [ ] T013 [Technical debt item]
````

---

## Step 7: Generate Research Document

Write to `.specify/specs/NNN-hydrated-[feature-name]/research.md`:

```markdown
---
date: [ISO timestamp]
researcher: Gofer
feature: '[Feature Name]'
status: complete
method: hydration
---

# Research: [Feature Name] (Hydrated)

## Analysis Method

This research was generated by analyzing existing code, not from requirements.

### Files Analyzed

- `path/to/file.ts` - [What was learned]
- `path/to/test.ts` - [What tests revealed]

## Codebase Analysis

### Implementation Patterns Found

- [Pattern 1]: Used for [purpose]
- [Pattern 2]: Used for [purpose]

### Code Quality Observations

- [Positive observation]
- [Area for improvement]

## Technology Decisions (Inferred)

### Why [Technology/Pattern] Was Used

- **Evidence**: [Code showing the choice]
- **Likely Rationale**: [Inference]
- **Alternatives**: [What else could have been used]

## Recommendations for Future Work

Based on code analysis:

1. [Recommendation]
2. [Recommendation]
```

---

## Step 8: Report Completion

```
================================================================
  HYDRATION COMPLETE: [Feature Name]
================================================================

  Analyzed:
  - Source files: [N] files
  - Test files: [N] files
  - Lines of code: [N] lines

  Generated:
  - spec.md: [N] user stories, [N] requirements
  - tasks.md: [N] completed tasks documented
  - research.md: Code analysis findings

  Output: .specify/specs/NNN-hydrated-[feature-name]/

  Coverage:
  - Test coverage: [X]%
  - Documented behaviors: [N]
  - Undocumented behaviors: [N]

  Next Steps:
  1. Review generated spec for accuracy
  2. Add missing acceptance criteria
  3. Document undocumented behaviors
  4. Use spec for future modifications

================================================================
```

---

## Validation Checklist

Before completing hydration:

- [ ] All public functions documented
- [ ] All test cases mapped to acceptance criteria
- [ ] All data types documented
- [ ] Integration points identified
- [ ] Known issues captured
- [ ] Assumptions clearly stated

---

## Observability Logging

```bash
.specify/scripts/bash/log-stage.sh gofer_hydrate --complete --tokens [N] --compactions [N]
```

---

## Key Rules

- **Describe what IS, not what should be** - This documents current behavior
- **Mark spec as "hydrated"** - Distinguishes from forward-engineered specs
- **Include evidence** - Link assertions to code/test locations
- **Note assumptions** - Be clear about inferences made
- **Identify gaps** - Document missing tests and unclear behavior
- **Preserve code references** - Include file:line for traceability

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
