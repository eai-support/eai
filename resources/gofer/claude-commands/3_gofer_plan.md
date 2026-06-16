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
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host claude --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.

---
description:
  Generate technical implementation plan with architecture and contracts
---

# Gofer Plan

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

## Execution Profile And Planning Surface

Use the research/spec risk classification to choose planning depth:

- **fast**: produce the smallest viable plan, only for docs-only or very small
  low-risk work.
- **standard**: produce the normal plan, data/contracts only when relevant, and
  a concrete test strategy. Standard is the catch-all for work that is not fast,
  full, or dynamic.
- **full**: include contract compatibility, auth/security, data migration,
  infra/config, rollback, and release sequencing where the generic risk labels
  require them.
- **dynamic**: produce a workflow DAG, shard plan, reducer plan,
  verifier/refuter pass, resumable progress ledger, budget limits, and stop
  conditions before implementation starts.

Avoid artifact churn. Optional diagrams, extended architecture councils,
generated issue packs, and broad release plans are only warranted when risk is
full/dynamic-depth or the user asks for them.

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)
- `goal-ledger.json` - Objective ledger and re-loop triggers (from /1 and /2)

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
8. EnterpriseAI profile output: task-ready references to `context-bundle.md`,
   `contract-pack.md`, `reuse-scan.md`, `audit-history.md`, and for app
   delivery `ui-review-log.md`, `ui-approval.md`, and
   `service-fit-matrix.md`, including public-readiness, block-porting, source platform
   decoupling, Storybook, theme override, and package-profile decisions
9. Dynamic-only output: `workflow-dag.md` with shards, inputs, outputs,
   reducer expectations, verifier/refuter evidence, budget limits, stop
   conditions, and resumable progress location

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
   - Note whether `ui-preview-brief.md`, `ui-review-log.md`,
     `ui-approval.md`, and `service-fit-matrix.md` exist
   - Note external/internal/hybrid profile choice, package lane, coupling
     status, Storybook story IDs, theme override points, custom-block
     exceptions, and public-readiness status when app delivery applies
   - Note whether `goal-ledger.json` exists and which goals, delivery states,
     and re-loop triggers must remain valid through planning
   - Note whether `{FEATURE_DIR}/sequence-diagrams/selected-option.md` exists

3. **Note template path**: `.specify/templates/plan-template.md`

---

## Step 2: Dispatch Planning Agents

**CRITICAL**: You **MUST** launch these agents using the Task tool. Do NOT
perform this work inline in the main context. The main context should only
orchestrate and review agent outputs. Each agent reads source documents
independently and writes its output artifact.

### Agent 1: Implementation Plan Writer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Generate a complete technical implementation plan for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/research.md — Technology decisions, integration points, patterns, constraints
- {FEATURE_DIR}/spec.md — User stories, requirements, success criteria
- {FEATURE_DIR}/goal-ledger.json — business goals, metrics, delivery states, and re-loop triggers
- {FEATURE_DIR}/ui-preview-brief.md — app-delivery preview brief (read if exists, skip if not)
- {FEATURE_DIR}/ui-review-log.md — app-delivery preview iteration history (read if exists, skip if not)
- {FEATURE_DIR}/ui-approval.md — app-delivery approval state (read if exists, skip if not)
- {FEATURE_DIR}/service-fit-matrix.md — app-delivery capability selections (read if exists, skip if not)
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
9. Goal Reconciliation And Dual-State Delivery:
   - Goal IDs, outcome metrics, target thresholds, and where they are delivered
   - Delivery states (`mock`, `hybrid`, `live`) plus promotion criteria
   - Re-loop triggers that should send the feature back to specify, plan, tasks,
     or validate when contracts, UX scope, assumptions, or implementation drift
10. AI-Readable Blocks Bridge:
   - Package profile choice: external, internal, or hybrid
   - Package lane for each UI block or package surface
   - Coupling status, including source-platform decoupling boundary or approved
     restricted-source exception
   - Block porting plan with stable block IDs, Storybook story IDs, theme
     override points, and custom-block exceptions
   - Public-readiness tasks required before an external or hybrid package is
     considered complete

Rules:
- Every user story from spec.md MUST have plan coverage
- Every acceptance criterion MUST map to a plan component
- Every functional requirement MUST be addressed
- Reference specific file paths for all components
- Plan must be specific enough for task generation
- Resolve all unknowns — no NEEDS CLARIFICATION in the plan
- App-delivery plans MUST make public-readiness, block porting, source platform
  decoupling, Storybook coverage, theme overrides, and package-profile work
  visible enough for `/4_gofer_tasks` to emit first-class runnable tasks
- Keep `goal-ledger.json` aligned with any planning-level changes to goals,
  delivery states, or re-loop triggers

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

### Agent 5-7: Visual Writers (Persona-Pack)

After the planning agents complete and write plan.md, data-model.md, and
contracts, dispatch three visual-writer sub-agents in parallel to produce the
developer-persona-pack visuals:

```
Task: subagent_type="visual-c4-writer", model="haiku"
Prompt: "Generate C4 Context and Container diagrams for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read spec.md, research.md, plan.md.
Output to {FEATURE_DIR}/visuals/c4-context.md and c4-container.md."

Task: subagent_type="visual-bounded-context-writer", model="haiku"
Prompt: "Generate bounded-context map for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read plan.md, data-model.md, contracts/.
Output to {FEATURE_DIR}/visuals/bounded-context.md."

Task: subagent_type="visual-erd-writer", model="haiku"
Prompt: "Generate data-model ERD for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read data-model.md.
Output to {FEATURE_DIR}/visuals/data-model-erd.md."
```

These three artifacts (c4-container.md, bounded-context.md, data-model-erd.md)
are required for the developer persona pack. The persona-pack completeness gate
at /4_gofer_tasks start will warn if any are missing.

### Dynamic-Only: Workflow DAG Writer

When `effectiveProfile=dynamic`, write `{FEATURE_DIR}/workflow-dag.md` before
task generation. It must define:

- independent shards and why they can run separately
- input artifacts each shard may read
- output artifacts each shard must produce
- reducer synthesis expectations
- verifier/refuter checks for contradictions or overreach
- budget limits, stop conditions, and confirmation gates
- resumable progress location outside the chat transcript

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
Task: subagent_type="multi-perspective-judge", model="opus"
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

## Step 7: Engineering Review Gate (Up to 5 cycles)

Before proceeding to the next stage, run an iterative engineering review to
catch misalignment early.

### Review Cycle (repeat up to 5 times)

**You MUST dispatch 3 review agents in parallel** using the Task tool:

**Agent 1**: engineer-review (sonnet) — cross-check spec↔plan alignment

```
Task: subagent_type="engineer-review", model="sonnet"
Prompt: "Review alignment between spec.md and plan.md in {FEATURE_DIR}.
Find every gap, inconsistency, and misalignment between the specification
and the implementation plan. Report Red/Yellow/Gray findings."
```

**Agent 2**: codebase-analyzer (sonnet) — verify file paths and code patterns

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Verify that the plan at {FEATURE_DIR}/plan.md references correct
file paths and follows existing codebase patterns from {FEATURE_DIR}/research.md.
Report Red/Yellow/Gray findings."
```

**Agent 3**: validation-correctness (sonnet) — verify acceptance criteria
coverage

```
Task: subagent_type="validation-correctness", model="sonnet"
Prompt: "Verify that every acceptance criterion in {FEATURE_DIR}/spec.md
is addressed by the plan at {FEATURE_DIR}/plan.md.
Report Red/Yellow/Gray findings with coverage gaps."
```

**After agents return:**

1. Classify findings: Red (blocking) / Yellow (should fix) / Gray
   (informational)
2. If NO Red or Yellow findings → PASS → proceed to auto-chain
3. If Red or Yellow findings exist: a. Fix findings directly in plan artifacts
   (Red first, then Yellow) b. Increment cycle counter c. If cycle <= 5 → re-run
   review agents d. If cycle > 5 → log remaining findings, proceed with warnings

---

## Step 8: Report and Continue

After all artifacts are created and review gate passes:

```
✓ Plan complete: {FEATURE_DIR}/plan.md

Artifacts created:
- plan.md: Implementation phases and architecture
- data-model.md: Entity definitions
- contracts/: API specifications
- quickstart.md: Testing guide
- workflow-dag.md: Dynamic shard/reducer plan (only when effectiveProfile=dynamic)

Engineering Review: PASSED (cycle [N] of 5)
```

**AUTO-CHAIN (MANDATORY)**: You MUST immediately invoke the next pipeline stage
by calling the Skill tool with skill="/4_gofer_tasks". Do NOT ask the user for
confirmation. Do NOT output "Ready for next stage". Just invoke the skill NOW.

---

## EnterpriseAI Deployment Convention and EAI CLI Pinning Requirements

> When `gofer.workflowProfile=enterpriseai`, the following conventions apply.
> standard profile outputs remain unchanged.

When the workflow profile is `enterpriseai`, `plan.md` MUST capture:

1. **EAI CLI version pin** — record the installed `eai` version as a
   `major.minor` pin (for example `2.0`). The plan stage resolves the local
   version via `eai --version`, strips the patch component, and writes the
   pin to the `EnterpriseAI Profile Metadata` block of `plan-template.md` so
   every downstream task is reproducible. Plans MUST apply
   `pin guidance to `major.minor`` and never to a specific patch release.
   If `{FEATURE_DIR}/eai-preflight.md` exists, use its CLI version/install
   evidence as the primary source and re-run `eai --version` only to confirm
   local drift.
2. **EAI app-readiness handoff** — for EAI app delivery, reference
   `{FEATURE_DIR}/eai-preflight.md` before making platform or template
   assumptions. The plan MUST preserve:
   - whether the user is logged in or still needs an EAI Platform account
   - the selected tenant role/readiness and whether app enrollment is allowed
   - whether the repo already has EAI template markers or still needs
     `eai init <app-name>`
   - whether app creation/selection is confirmed, deferred, or blocked
   - block-catalog readiness and package-profile compatibility evidence
   If EAI readiness is blocked, plan only the smallest unblock task group and
   do not invent object types, tenant IDs, app keys, or platform capabilities.
3. **EAI Platform/Azure app stack decision** — for app delivery, the plan MUST
   use EAI Platform, including the EAI app template, as the primary app
   substrate and Azure as the preferred cloud/supporting substrate. The plan MUST
   NOT select Firebase, Supabase, Vercel as the primary runtime, AWS, GCP,
   bespoke backends, unmanaged databases, or unrelated SaaS platforms as the
   default app stack. Any non-EAI technology must be recorded as an integration
   target, migration reference, or approved exception with rationale, owner,
   expiry, and validation evidence.
   Capabilities unavailable in EAI Platform/Azure must be recorded in
   `{FEATURE_DIR}/service-fit-matrix.md` as platform work, operator-required, or
   upgrade-required rather than substituted silently.
4. **Deployment convention** — reference the configured deployment
   documentation for the target project and note which environment
   (dev/staging/prod) each deliverable targets.
5. **Integration map handoff** — restate the Vertical App → EAI Services →
   Deployment Target chain from `spec.md` and bind each link to a task
   identifier in `tasks.md`.
6. **Contract pack handoff** — reference `{FEATURE_DIR}/contract-pack.md` and
   bind each actor, object type, workflow/journey, permission boundary,
   API/event, runtime assumption, and acceptance test to plan sections and
   downstream tasks.
7. **AI-augmented journey handoff** — for app delivery, reference
   `{FEATURE_DIR}/journeys/base-journey.md` and plan the four-step-or-fewer
   user-facing process as the default scope spine. Each step must include the
   business goal, generative AI assistance mode, screen/user/data context used,
   completion signal, user controls, audit trail, and fallback/escalation path.
   If the plan expands beyond four user-facing steps, document why those steps
   cannot be combined, automated, or handled by the AI assistant.
8. **UI-first approval gate handoff** — for app delivery, reference
   `{FEATURE_DIR}/ui-preview-brief.md` and require the planning stage to lock
   the preview loop before plan/tasks are considered complete. The plan MUST:
   - keep the first preview constrained to EAI App Template blocks unless an
     approved extension is recorded
   - cite `eai blocks describe <id>` evidence for every selected block ID,
     plus the ResourceAPI/Object Type fields from `eai resources schema` that
     feed each block
   - record override points for theme tokens, `presentationConfig`, copy,
     data/action bindings, and client extension blocks
   - capture whether client branding/logos are in scope
   - require screenshot, local render proof, or Playwright-style self-review
     evidence before stakeholder presentation
   - update `{FEATURE_DIR}/ui-review-log.md` for each iteration and require
     explicit stakeholder approval in `{FEATURE_DIR}/ui-approval.md`
9. **EnterpriseAI service-fit handoff** — for app delivery, the plan MUST
   produce or update `{FEATURE_DIR}/service-fit-matrix.md` after UI approval and
   before tasks are treated as complete. The matrix must distinguish:
   - accessible now
   - purchasable but unavailable now
   - unavailable without new platform work
   The plan must source this evidence from `eai --describe`, `eai whoami`,
   `eai tenant select`, `eai resources schema --format json`,
   `eai verify calls --format json`, `eai workflow readiness [workflow-key]
   --format json`, `eai workflow status <workflow-key>`, `eai workflow request
   <workflow-key>`, `eai provision entra --rotate-secret`, or documented
   equivalent public platform evidence.
10. **Reuse-before-create decision log** — reference `{FEATURE_DIR}/reuse-scan.md`
   for every new or extended EnterpriseAI object type, API/event, workflow, or
   module.
11. **Audit history seed** — create or update `{FEATURE_DIR}/audit-history.md`
   with stable finding IDs, decision exceptions, owner, expiry, and review
   cadence so validation can track recurring issues.
12. **Public/private knowledge split** — identify which implementation facts
    are safe for public docs, Gofer guidance, EAI CLI help, or EAI App Template
    comments, and which facts are restricted-source. Plans must express blocked
    states as public-safe actions (`operator_required`, `upgrade_required`, or
    documented support URL) rather than exposing private service topology.

### EnterpriseAI Flow and Journey Separation

Plan both:

- **External user journeys**: the business/user-facing path, decision points,
  adoption impact, and measurable value.
- **AI-augmented app process**: for application delivery, the four-step-or-fewer
  journey with AI assistance, contextual prefill, conversational support,
  completion checks, and human controls at each step.
- **App-delivery preview and approval loop**: for application delivery, the
  local preview creation, self-review, stakeholder feedback, branding updates,
  and approval-gate behavior that must occur before plan/tasks are finalized.
- **EnterpriseAI service-fit gate**: for application delivery, the post-approval
  capability-selection discussion that binds chosen platform services to the
  approved UI and distinguishes accessible now vs purchasable vs unavailable.
- **Internal orchestration flows**: platform services, ResourceAPI calls,
  events, data movement, tenant boundaries, deployment steps, and observability.

### Competitive / market analysis reference

When `includeCompetitiveAnalysis=true`, `plan.md` MUST link to
`market-analysis.md`. When disabled, the competitive-analysis section is omitted
and standard profile outputs remain unchanged.

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
