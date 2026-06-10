---
name: gofer_hydrate
description: Reverse-engineer specification from existing code (Hydration)
agent: copilot-workspace
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebSearch
argument-hint: feature-name-or-description
gofer:
  workflowProfile: standard
  canonicalSource: .specify/commands/gofer_hydrate.md
  canonicalChecksum: c4f556aac545dfe7096ff97b8cff68a4ad1235039f67acb100de4099e7f89901
  metadataSource: scripts/generate-commands.ts
---

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
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host copilot --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.


# Gofer Hydrate

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
> `#gofer_hydrate`. It reflects the **current implementation**, not necessarily
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
researcher: Claude
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
