---
name: 9_gofer_tests
description: Generate comprehensive test suites from four testing perspectives for a target component.
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
  canonicalSource: .claude/commands/9_gofer_tests.md
  canonicalChecksum: 0a6baf44d5add8fccc5ee6deb6aed559ef42d0e19aa6f4afc2733335e42ef744
  metadataSource: scripts/generate-commands.ts
---


# Gofer Tests

You are defining acceptance test cases for a feature using a Domain Specific
Language (DSL) approach. This command can be run **before implementation**
(test-first) or **during implementation** to define test coverage.

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
#1_gofer_research  →  #2_gofer_specify  →  #3_gofer_plan
                                                 ↓
                                          #9_gofer_tests  ← Define tests here
                                                 ↓
                                          #4_gofer_tasks  →  #5_gofer_implement
```

### During Implementation

After each task in `#5_gofer_implement`:

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
