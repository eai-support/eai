---
name: 9_gofer_tests
description: "Generate comprehensive test suites from four testing perspectives for a target component."
title: "Gofer Tests"
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
aliases: [gofer:tests]
---
---
description:
  Define acceptance test cases using DSL approach before or during
  implementation
---

# Gofer Tests

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

- **Test-First Development**: Define tests before writing implementation
- **During Planning**: Add test definitions to plan.md
- **During Implementation**: Create test scaffolds alongside code
- **Before Validation**: Ensure comprehensive test coverage

---

## Core Principles (Agentic Testing Best Practices)

### 1. Comment-First Approach

Always start by writing test cases as structured comments before any
implementation. This forces clear thinking about expected behavior.

### 2. DSL at Every Layer

All test code - setup, actions, assertions - must be written as readable DSL
functions. No direct framework calls in test files.

### 3. Implicit Given-When-Then

Structure tests with blank lines separating setup, action, and assertion phases.
Never use the words "Given", "When", or "Then" explicitly.

### 4. Traceability to Requirements

Every test case must trace back to a user story or acceptance criterion from
spec.md.

### 5. Follow Existing Patterns

Study and follow existing test patterns, DSL conventions, and naming standards
in the codebase.

---

## Step 1: Load Feature Context

```bash
.specify/scripts/bash/check-prerequisites.sh --json
```

Parse JSON for FEATURE_DIR, then load:

- `spec.md` - User stories and acceptance criteria
- `plan.md` - Technical architecture
- `tasks.md` - Implementation tasks (if exists)

---

## Step 2: Research Existing Test Patterns

**CRITICAL**: Before writing any test cases, spawn a research agent:

```
Task: subagent_type="codebase-pattern-finder", model="haiku"
Prompt: "Find existing test files and patterns in this codebase.
Identify:
- Test file locations and naming conventions
- DSL function patterns and naming conventions
- Test organization patterns (describe blocks, test grouping)
- Existing DSL functions for setup, actions, and assertions
- Test framework being used (Jest, Vitest, Mocha, pytest, etc.)"
```

---

## Step 3: Extract Test Requirements

### 3.1 From User Stories

For each user story in spec.md, extract:

```markdown
| User Story | Priority | Acceptance Criteria       | Test Cases Needed |
| ---------- | -------- | ------------------------- | ----------------- |
| US1        | P1       | User can login with email | TC001, TC002      |
| US1        | P1       | Error on invalid creds    | TC003, TC004      |
| US2        | P2       | Dashboard shows metrics   | TC005, TC006      |
```

### 3.2 Coverage Requirements

Ensure tests cover:

1. **Happy Paths** - Standard successful flows
2. **Edge Cases** - Boundary conditions, unusual but valid inputs
3. **Error Scenarios** - Invalid inputs, service failures, timeouts
4. **Boundary Conditions** - Maximum/minimum values, empty states
5. **Authorization** - Permission-based access scenarios

---

## Step 4: Define Test Cases

### Test Case Structure

```javascript
// [Test Case ID]: [Test Case Name]
// Traces to: [US-X AC-Y]
//
// setupFunction
// anotherSetupFunction
//
// actionThatTriggersLogic
//
// expectationFunction
// anotherExpectationFunction
```

### Structure Rules

- **First line**: Test case ID and name
- **Second line**: Traceability to user story/acceptance criterion
- **Blank line**: Before setup
- **Setup phase**: Functions that arrange test state (no blank lines between)
- **Blank line**: Separates setup from action
- **Action phase**: Function(s) that trigger the behavior under test
- **Blank line**: Separates action from assertions
- **Assertion phase**: Functions that verify expected outcomes

---

## Step 5: Naming Conventions

### Setup Functions (Arrange)

Describe state being created:

- `userIsLoggedIn`, `cartHasThreeItems`, `databaseIsEmpty`
- `createUser`, `seedDatabase`, `mockExternalAPI`

### Action Functions (Act)

Describe the event/action:

- `userClicksCheckout`, `orderIsSubmitted`, `apiReceivesRequest`
- `submitForm`, `sendRequest`, `processPayment`

### Assertion Functions (Assert)

Start with `expect`:

- `expectOrderProcessed`, `expectUserRedirected`, `expectEmailSent`
- `expectNoEmailSent`, `expectOrderNotCreated` (negative cases)

---

## Step 6: Generate Test Document

### Application Business-Scenario Browser Contract

For application delivery, also create
`{FEATURE_DIR}/business-scenarios.json` from
`.specify/templates/business-scenarios-template.json`.

- Map every in-scope user story to the business outcome, every screen/state
  crossed in user order, and one or more executable browser test files.
- Prefer a package script named `test:business-scenarios`; `test:e2e` and
  `test:playwright` are accepted fallbacks.
- Test the whole journey through visible controls, not just isolated component
  renders. Assert completion signals, validation/error states, authorization
  denials, loading/empty states, responsive behavior, keyboard access, console
  errors, failed requests, and redirects that matter to the scenario.
- Run on desktop and at least one mobile viewport when the app is responsive.
- Use the host integrated browser for show-and-tell when available and
  Playwright/Cypress for repeatable local and CI execution.
- A screenshot is visual evidence only. It cannot replace click-through
  assertions, and unit coverage cannot replace the browser journey.
- Before implementation completes, run:

  ```bash
  node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --require-scenarios --open auto --screenshot --change "<change summary>"
  ```

  Use `run.bat dev 3001` on Windows.

  Require `{FEATURE_DIR}/business-scenario-report.json` to be `passed`.

Write to `{FEATURE_DIR}/test-cases.md`:

````markdown
---
feature: [Feature Name]
created: [ISO timestamp]
spec: spec.md
status: draft
coverage:
  user_stories: [N]/[Total]
  acceptance_criteria: [N]/[Total]
---

# Test Cases: [Feature Name]

## Test Coverage Matrix

| User Story | Acceptance Criterion | Test Case(s) | Status  |
| ---------- | -------------------- | ------------ | ------- |
| US1        | AC1: User can login  | TC001, TC002 | Defined |
| US1        | AC2: Error handling  | TC003, TC004 | Defined |
| US2        | AC1: Dashboard       | TC005        | Defined |

## Test Case Definitions

### Happy Path Tests

#### TC001: Successful Login with Valid Credentials

Traces to: US1-AC1

```javascript
// TC001: Successful Login with Valid Credentials
// Traces to: US1-AC1
//
// userExists({ email: 'test@example.com', password: 'valid' })
//
// userSubmitsLogin({ email: 'test@example.com', password: 'valid' })
//
// expectUserLoggedIn()
// expectRedirectedToDashboard()
// expectSessionCreated()
```

#### TC002: Login Remembers User Preference

Traces to: US1-AC1

```javascript
// TC002: Login Remembers User Preference
// Traces to: US1-AC1
//
// userExists({ email: 'test@example.com' })
// rememberMeEnabled()
//
// userSubmitsLogin({ email: 'test@example.com', password: 'valid' })
//
// expectPersistentSessionCreated()
// expectCookieSet('remember_token')
```

### Edge Case Tests

#### TC003: Login with Maximum Length Password

Traces to: US1-AC1

```javascript
// TC003: Login with Maximum Length Password
// Traces to: US1-AC1
//
// userExists({ password: 'a'.repeat(128) })
//
// userSubmitsLogin({ password: 'a'.repeat(128) })
//
// expectUserLoggedIn()
```

### Error Scenario Tests

#### TC004: Login with Invalid Credentials

Traces to: US1-AC2

```javascript
// TC004: Login with Invalid Credentials
// Traces to: US1-AC2
//
// userExists({ email: 'test@example.com', password: 'correct' })
//
// userSubmitsLogin({ email: 'test@example.com', password: 'wrong' })
//
// expectUserNotLoggedIn()
// expectErrorMessage('Invalid credentials')
// expectNoSessionCreated()
```

#### TC005: Login When Service Unavailable

Traces to: US1-AC2

```javascript
// TC005: Login When Service Unavailable
// Traces to: US1-AC2
//
// authServiceIsDown()
//
// userSubmitsLogin({ email: 'test@example.com', password: 'valid' })
//
// expectErrorMessage('Service temporarily unavailable')
// expectRetryOption()
```

### Authorization Tests

#### TC006: Unauthorized Access Attempt

Traces to: US1-AC3

```javascript
// TC006: Unauthorized Access Attempt
// Traces to: US1-AC3
//
// userIsNotAuthenticated()
//
// userNavigatesToProtectedRoute('/dashboard')
//
// expectRedirectedToLogin()
// expectOriginalUrlPreserved()
```

## DSL Functions Required

### Setup Functions (To Create)

| Function              | Purpose                      | Exists? |
| --------------------- | ---------------------------- | ------- |
| `userExists()`        | Create test user in database | No      |
| `authServiceIsDown()` | Mock auth service failure    | No      |
| `rememberMeEnabled()` | Set remember me preference   | No      |

### Action Functions (To Create)

| Function             | Purpose                        | Exists? |
| -------------------- | ------------------------------ | ------- |
| `userSubmitsLogin()` | Simulate login form submission | No      |
| `userNavigatesTo()`  | Navigate to URL                | Yes     |

### Assertion Functions (To Create)

| Function               | Purpose                    | Exists? |
| ---------------------- | -------------------------- | ------- |
| `expectUserLoggedIn()` | Verify user session exists | No      |
| `expectErrorMessage()` | Verify error is displayed  | Yes     |
| `expectRedirectedTo()` | Verify redirect occurred   | Yes     |

## Implementation Notes

### Test File Location

Based on codebase patterns: `tests/integration/[feature]/`

### Test Framework

Using: [Jest/Vitest/Mocha/pytest] (from research)

### DSL Implementation Location

DSL functions should go in: `tests/helpers/` or `tests/dsl/`

## Next Steps

1. [ ] Create missing DSL functions
2. [ ] Implement test scaffolds
3. [ ] Run tests (expect failures)
4. [ ] Implement feature code
5. [ ] Verify tests pass
````

---

## Step 7: Generate Test Scaffolds (Optional)

If user wants actual test files, generate scaffolds:

```javascript
// tests/integration/[feature]/[feature].test.ts
import { describe, test, expect } from 'vitest';
import {
  userExists,
  userSubmitsLogin,
  expectUserLoggedIn,
  // ... other DSL functions
} from '../../helpers/auth-dsl';

describe('[Feature Name]', () => {
  describe('US1: User Authentication', () => {
    test('TC001: Successful Login with Valid Credentials', async () => {
      // TC001: Successful Login with Valid Credentials
      // Traces to: US1-AC1
      //
      // userExists({ email: 'test@example.com', password: 'valid' })
      //
      // userSubmitsLogin({ email: 'test@example.com', password: 'valid' })
      //
      // expectUserLoggedIn()
      // expectRedirectedToDashboard()

      await userExists({ email: 'test@example.com', password: 'valid' });

      await userSubmitsLogin({ email: 'test@example.com', password: 'valid' });

      await expectUserLoggedIn();
      await expectRedirectedToDashboard();
    });

    // ... more tests
  });
});
```

---

## Step 8: Update Tasks.md

Add test implementation tasks to tasks.md:

```markdown
## Phase: Test Implementation

- [ ] T0XX [P] Create DSL helper functions in tests/helpers/
- [ ] T0XX [P] Implement test scaffolds for US1
- [ ] T0XX [P] Implement test scaffolds for US2
- [ ] T0XX Verify all tests fail initially (red phase)
```

---

## Step 9: Report Completion

```
================================================================
  TEST CASES DEFINED: [Feature Name]
================================================================

  Coverage:
  - User Stories: [N]/[Total] covered
  - Acceptance Criteria: [N]/[Total] covered
  - Test Cases: [Total] defined

  Test Types:
  - Happy Path: [N] tests
  - Edge Cases: [N] tests
  - Error Scenarios: [N] tests
  - Authorization: [N] tests

  DSL Functions:
  - Existing: [N] functions
  - To Create: [N] functions

  Output: {FEATURE_DIR}/test-cases.md

  Next Steps:
  1. Review test cases with stakeholders
  2. Implement DSL functions
  3. Create test scaffolds
  4. Run tests (expect red)
  5. Implement feature (turn green)

================================================================
```

---

## Test-First Workflow Integration

### Before Implementation

```
/1_gofer_research  →  /2_gofer_specify  →  /3_gofer_plan
                                                 ↓
                                          /9_gofer_tests  ← Define tests here
                                                 ↓
                                          /4_gofer_tasks  →  /5_gofer_implement
```

### During Implementation

After each task in `/5_gofer_implement`:

1. Run relevant tests
2. Verify behavior matches test expectations
3. Mark test as passing in test-cases.md

---

## Observability Logging

```bash
.specify/scripts/bash/log-stage.sh 9_tests --complete --tokens [N] --compactions [N]
```

---

## Key Rules

- Every test must trace to a user story or acceptance criterion
- Follow existing test patterns in the codebase
- DSL functions must be readable as natural language
- Tests should be independent and isolated
- Include both positive and negative test cases
- Document which DSL functions need to be created

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
