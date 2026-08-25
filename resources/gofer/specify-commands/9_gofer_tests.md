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

## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using
   the signals in `.specify/commands/0_gofer_start.md`.
2. If the request is EAI app delivery or ambiguous, continue directly into the
   EAI app delivery path. Do not ask for confirmation just because app delivery
   is inferred.
3. If the request is clearly non-application work, confirm once before taking
   the non-app path:
   - **"This looks like non-app work, so I will skip EAI tenant/app setup and
     continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision in the feature discovery or
   context bundle, do not run `eai whoami`, `eai tenant select`, `eai init`, or
   `/gofer:eai-first-run`, and continue the appropriate non-app pipeline path.
5. If the user says it is app work, switch to EAI app delivery and run EAI app
   preflight.
6. For EAI app delivery, treat durable delivery as EAI Platform delivery by
   default, with Azure second and every other stack only by explicit exception.
7. For EAI app delivery, run `eai whoami` and confirm the EAI CLI is installed,
   the user is logged in, and an active tenant is visible.
8. If app-delivery readiness is missing, stop and run `/gofer:eai-first-run` or
   ask the user to approve login/setup before continuing.
9. For EAI app delivery, do not continue into research, specification, planning,
   tasks, implementation, or validation until
   `.specify/specs/{feature}/eai-preflight.md` records login, tenant, template,
   app-readiness, and next-action evidence.
10. Do not write tokens, secrets, private tenant IDs, or local `.env` values into
    Gofer artifacts; record only product-safe readiness status and evidence.

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
<!-- gofer:business-progress:end -->

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. The runner must stop any process on the selected port before it restarts the app.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
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