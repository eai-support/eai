---
description:
  Generate technical implementation plan with architecture and contracts
---

# Gofer Plan

You are creating a detailed technical implementation plan. This is the **third
stage** of the unified Gofer pipeline, combining architecture design, data
modeling, and API contracts.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)

If missing, prompt user to run the prerequisite stage.

---

## Outline

1. Context health check
2. Load context (lightweight)
3. Dispatch parallel planning agents (sub-agents handle heavy generation)
4. Review agent outputs
5. Optional multi-perspective review
6. Spec coverage validation
7. Output: `plan.md`, `data-model.md`, `contracts/`, `quickstart.md`

---

## Step 0: Context Health Check

Before starting planning, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Consider `/compact` - planning loads multiple documents
- If **> 70%**: Start new session with handoff summary

Planning dispatches multiple agents — keep main context lightweight.

---

## Step 1: Load Context (Lightweight)

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/setup-plan.sh --json
   ```

   Parse JSON for FEATURE_DIR, FEATURE_SPEC, BRANCH

2. **Scan existing documents** (do NOT load full content — agents read
   directly):
   - Note feature name from FEATURE_DIR
   - Note whether `discovery.md`, `.specify/memory/constitution.md` exist
   - Note whether `{FEATURE_DIR}/sequence-diagrams/selected-option.md` exists

3. **Note template path**: `.specify/templates/plan-template.md`

---

## Step 2: Dispatch Planning Agents

Launch planning agents **in parallel** using the Task tool. Each agent reads
source documents independently and writes its output artifact. This keeps main
context clean while agents handle heavy content generation.

### Agent 1: Implementation Plan Writer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Generate a complete technical implementation plan for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/research.md — Technology decisions, integration points, patterns, constraints
- {FEATURE_DIR}/spec.md — User stories, requirements, success criteria
- .specify/templates/plan-template.md — Plan template structure
- .specify/memory/constitution.md — Project principles (read if exists)
- {FEATURE_DIR}/sequence-diagrams/selected-option.md — Selected approach (read if exists)

Generate the COMPLETE plan.md with these sections:

1. YAML frontmatter: feature, spec, research, status: ready, created (ISO date)
2. Technical Context:
   - Tech Stack (language, framework, database, testing — from research)
   - Architecture (how components fit together, with diagram description)
   - Integration Points table (Component | File | Integration Type)
   - Key Dependencies (existing modules, libraries)
3. Selected Implementation Approach (if selected-option.md exists):
   - Option number, scores, Gen AI touchpoints
4. Constitution Check (if constitution.md exists):
   - Verify alignment with each project principle
5. Implementation Phases (5 phases):
   - Phase 1: Setup & Foundation (directory structure, config, deps, base types)
   - Phase 2: Data Layer (entities, persistence, validation)
   - Phase 3: Business Logic (services per user story, business rules, integrations)
   - Phase 4: API/Interface Layer (endpoints per contracts, validation, auth)
   - Phase 5: Polish & Integration (logging, docs, performance, final testing)
   Each phase must have: Goal, Tasks (checkboxed), Verification criteria
6. File Structure (tree diagram of all new/modified files)
7. Risk Assessment table (Risk | Impact | Mitigation)
8. Spec Traceability:
   - User Story Coverage (Story | Status | Plan References)
   - Requirement Coverage (FR-ID | Status | Plan Reference)
   Verify 100% coverage of all user stories and functional requirements.

Rules:
- Every user story from spec.md MUST have plan coverage
- Every acceptance criterion MUST map to a plan component
- Every functional requirement MUST be addressed
- Reference specific file paths for all components
- Plan must be specific enough for task generation
- Resolve all unknowns — no NEEDS CLARIFICATION in the plan

Write the complete plan to {FEATURE_DIR}/plan.md.

Return a structured summary:
- Phase count and task count per phase
- User story coverage: N/N covered
- FR coverage: N/N covered
- Key architecture decisions made
- Any risks flagged as HIGH"
```

### Agent 2: Data Model Designer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Design the data model for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — User stories, requirements, key entities
- {FEATURE_DIR}/research.md — Existing data patterns, database context

If spec.md defines Key Entities or the feature involves data:

Generate {FEATURE_DIR}/data-model.md with:
1. Entity definitions with field tables (Field | Type | Required | Description)
2. Validation rules for each entity
3. Relationships between entities
4. State transition diagrams (Mermaid stateDiagram-v2) where applicable
5. Database considerations (indexing, migration approach)
6. Entity-to-UserStory mapping (which stories need which entities)

If the feature does NOT involve data entities:
Write a minimal data-model.md noting 'No data entities required for this feature.'

Return: entity count, relationship count, entities with state machines"
```

### Agent 3: API Contract Designer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Design API contracts for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — Functional requirements implying API endpoints
- {FEATURE_DIR}/research.md — Existing API patterns, conventions

If spec.md implies API endpoints (REST, internal, events):

Create contract files in {FEATURE_DIR}/contracts/:
- api.md — For REST/HTTP endpoints
- internal-api.md — For service-to-service contracts
- events.md — For event-based contracts

Each endpoint must include:
- Method and path
- Description
- Request schema (JSON example)
- Response schema (JSON example with status code)
- Error codes table (Code | Description)
- Which user story/FR it serves

If the feature has NO APIs:
Create {FEATURE_DIR}/contracts/api.md noting 'No API endpoints required.'

Return: endpoint count, contract files created, user stories served"
```

### Agent 4: Quickstart Guide Writer

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Generate a quickstart testing guide for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — What to test (acceptance criteria)
- {FEATURE_DIR}/research.md — Tech stack and testing framework info

Write {FEATURE_DIR}/quickstart.md with:
1. Prerequisites (what needs to be installed/configured)
2. Setup steps (how to get the feature running)
3. Manual Testing section (step-by-step test scenarios from acceptance criteria)
4. Automated Tests section (test commands)
5. Key Files table (File | Purpose)
6. Common Issues section (anticipated problems and solutions)

Return: scenario count, prerequisite count"
```

**Run all 4 agents in parallel.** Agents 2-4 read spec.md independently while
Agent 1 generates the plan.

---

## Step 3: Review Agent Outputs

After all agents complete:

1. **Review plan.md** — Verify from Agent 1:
   - All user stories have plan coverage (check Spec Traceability section)
   - All functional requirements are addressed
   - Implementation phases are specific enough for task generation
   - File structure is consistent with existing codebase patterns

2. **Review data-model.md** — Verify from Agent 2:
   - All spec entities are covered
   - Relationships make sense
   - Validation rules are complete

3. **Review contracts** — Verify from Agent 3:
   - All implied API endpoints are defined
   - Request/response schemas are realistic
   - Error codes are appropriate

4. **Review quickstart.md** — Verify from Agent 4:
   - Test scenarios cover key acceptance criteria
   - Setup steps are realistic

5. **Fix any gaps** — Make targeted edits to any artifact with missing coverage

---

## Step 4: Spec Coverage Validation (GAP-01)

Dispatch a validator agent to cross-check plan against spec:

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Validate plan coverage of specification for feature at {FEATURE_DIR}.

Read:
- {FEATURE_DIR}/spec.md — Source of truth for requirements
- {FEATURE_DIR}/plan.md — Implementation plan to validate
- {FEATURE_DIR}/data-model.md — Data model to validate
- {FEATURE_DIR}/contracts/ — API contracts to validate (read all .md files)

Check these coverage dimensions:

1. USER STORY COVERAGE: Every user story in spec.md has at least one plan phase
2. ACCEPTANCE CRITERIA MAPPING: Every AC maps to a plan component
3. FUNCTIONAL REQUIREMENT COVERAGE: Every FR-XXX is addressed in plan
4. DATA MODEL COMPLETENESS: All Key Entities from spec appear in data-model.md
5. API CONTRACT COMPLETENESS: All implied APIs from spec have contracts

For each dimension, report:
- COVERED items with references
- MISSING items (ERROR — must be fixed)

Return:
- Coverage percentage per dimension
- List of MISSING items
- Overall PASS/FAIL status"
```

If validator reports MISSING items:

- Add missing components to the appropriate artifact
- Re-validate (max 3 iterations)
- **Proceed only when ALL spec items are traced to plan components**

---

## Step 5: Multi-Perspective Plan Review (Optional)

After generating the initial plan, optionally run multi-perspective strategies
to stress-test architectural decisions. **Skip this step if the plan is
straightforward or time-constrained.**

### Strategy #2: Solution Architecture Diverger

For features with significant architectural decisions, spawn 5 agents each using
a different pattern:

```
Task: subagent_type="plan-architecture-diverger", model="sonnet"
Prompt: "Design architecture for [FEATURE] using Pattern [1-5].
Pattern 1: Microservices/modular  2: Monolithic/cohesive  3: Event-sourced
4: CQRS  5: Plugin-based
Spec: [FEATURE_DIR]/spec.md  Plan context: [summary of current plan]"
```

Run all 5 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: architecture selection.
Select the best architecture for this feature considering codebase fit, complexity, and testability.
[paste all 5 agent outputs]"
```

### Strategy #5: API Design Comparator

For features with API surfaces, compare paradigms:

```
Task: subagent_type="plan-api-comparator", model="sonnet"
Prompt: "Design API for [FEATURE] using Paradigm [1-4].
Paradigm 1: REST  2: GraphQL  3: RPC  4: Event-based
Requirements: [API requirements from spec]"
```

Run 3-4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: API paradigm selection.
[paste all agent outputs]"
```

### Strategy #7: Refactor vs Rewrite Advisor

For features that modify existing code significantly:

```
Task: subagent_type="plan-refactor-rewrite-advisor", model="sonnet"
Prompt: "Perspective [1/2] for changing [CODE AREA].
Perspective 1: Plan minimal incremental refactor
Perspective 2: Plan clean rewrite
Current code: [file paths and summary]"
```

Run both in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: refactor vs rewrite decision.
[paste both agent outputs]"
```

### Strategy #12: Migration Path Finder

When the feature requires migrating existing code or data:

```
Task: subagent_type="plan-migration-path-finder", model="sonnet"
Prompt: "Design migration for [CHANGE] using Strategy [1-4].
Strategy 1: Big bang  2: Strangler fig  3: Feature-flagged  4: Adapter/facade
Migration scope: [what needs changing]"
```

Run all 4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: migration strategy selection.
[paste all 4 agent outputs]"
```

### Strategy #16: Data Model Stress Tester

For features with data models, stress-test before finalizing:

```
Task: subagent_type="plan-data-model-stress-tester", model="haiku"
Prompt: "Stress-test data model from Perspective [1-4].
Perspective 1: 10x scale  2: Concurrent access  3: Schema evolution  4: Edge-case shapes
Data model: [entities and relationships from plan]"
```

Run all 4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="sonnet"
Prompt: "Judge verdict type: data model robustness assessment.
[paste all 4 agent outputs]"
```

Incorporate judge recommendations into the plan before proceeding to validation.

---

## Step 6: Update Agent Context

Run the agent context update script:

```bash
.specify/scripts/bash/update-agent-context.sh claude
```

This updates AI agent context files with new technology from this plan.

---

## Step 7: Report and Continue

After all artifacts are created:

```
✓ Plan complete: {FEATURE_DIR}/plan.md

Artifacts created:
- plan.md: Implementation phases and architecture
- data-model.md: Entity definitions
- contracts/: API specifications
- quickstart.md: Testing guide

Ready for next stage: /4_gofer_tasks
```

If orchestrated by `/0_business_scenario`, the orchestrator will automatically
invoke `/4_gofer_tasks` next.

---

## LLM Council Integration (Optional)

When council mode is enabled for `gofer_plan` stage:

1. Technical research queries go to all configured LLM providers
2. Different perspectives on architecture decisions
3. Chairman synthesizes best practices from multiple sources
4. Usage logged to `.specify/logs/council-usage.jsonl`

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 3_plan --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`

---

## Key Rules

- Use absolute paths for all file references
- ERROR if constitution gates fail without justification
- All NEEDS CLARIFICATION must be resolved before completing
- Plan must be specific enough for task generation
- Log stage completion for observability tracking
