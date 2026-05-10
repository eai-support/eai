---
description: Create feature specification informed by codebase research
---

# Gofer Specify

You are creating a feature specification informed by prior codebase research.
This is the **second stage** of the unified Gofer pipeline.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects:

- Feature directory already created at `.specify/specs/{feature}/`
- `research.md` completed from `/1_gofer_research`
- `proposal-review.md` approved from `/1_gofer_research`

If these don't exist, prompt user to run `/1_gofer_research` first.

---

## Outline

1. Context health check
2. Validate approved proposal review and load existing findings
3. Dispatch specification agents (sub-agents handle heavy generation)
4. Review agent output, handle clarifications
5. Optional multi-perspective review
6. Output: `.specify/specs/{feature}/spec.md`
7. EnterpriseAI default output: `.specify/specs/{feature}/contract-pack.md`

---

## Step 0: Context Health Check

Before starting specification, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Consider `/compact` before loading research.md
- If **> 70%**: Start new session with handoff summary

---

## Step 1: Load Context (Lightweight)

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --paths-only
   ```

   Parse JSON for FEATURE_DIR. Use `--paths-only` because specification runs
   before planning, so `plan.md` must NOT be required at this stage.

2. **Scan research.md** from FEATURE_DIR (do NOT load full content into main
   context — agents will read it directly):
   - Note the feature name and description
   - Note whether discovery.md exists
   - Note whether proposal-review.md exists

3. **Note template path**: `.specify/templates/spec-template.md`

4. **Check for discovery.md**:

   ```bash
   ls -la {FEATURE_DIR}/discovery.md 2>/dev/null
   ```

5. **Check for proposal-review.md**:
   ```bash
   ls -la {FEATURE_DIR}/proposal-review.md 2>/dev/null
   ```

---

## Step 1.25: Proposal Approval Gate

`proposal-review.md` is the approval gate between research and specification.

- If `proposal-review.md` is missing: STOP and tell the user to run
  `/1_gofer_research` so the review can be created.
- If `proposal-review.md` exists but `status` is not `approved`: STOP and tell
  the user to finish the review conversation before writing `spec.md`.
- If `proposal-review.md` is approved: capture the approved business scenario,
  architecture direction, selected option, and any user overrides.

---

## Step 1.5: Discovery and Proposal Context Reference

If discovery.md exists, pass this mapping to the spec writer agent:

### Discovery → Spec Mapping

| Discovery Section    | Spec Section             | How to Use                           |
| -------------------- | ------------------------ | ------------------------------------ |
| Problem Statement    | Overview                 | Use pain point as feature motivation |
| Target Users         | User Stories             | Use persona as "As a [user type]"    |
| Value Proposition    | Success Criteria         | Convert to measurable metrics        |
| Success Metrics      | Success Criteria         | Use directly as targets              |
| Constraints          | Assumptions              | Include as spec assumptions          |
| Competitive Analysis | Overview or Out of Scope | Inform differentiation               |

**Note**: This mapping is included in the spec writer agent's prompt below. If
discovery.md doesn't exist, the agent generates spec content from research.md
and user input.

If proposal-review.md exists and is approved, also pass this mapping:

### Proposal Review → Spec Mapping

| Proposal Section              | Spec Section                  | How to Use                                         |
| ----------------------------- | ----------------------------- | -------------------------------------------------- |
| Recommended Business Scenario | Overview, Stories, Scope      | Use as the approved scope and user value lens      |
| Recommended Architecture      | Assumptions, Dependencies     | Carry forward the approved architecture direction  |
| Architecture Options          | Out of Scope, Assumptions     | Record rejected options and why they were deferred |
| Key Decisions and Why         | Requirements, NFRs            | Preserve decision rationale in business terms      |
| User Feedback and Overrides   | Requirements, Scope, Glossary | Apply approved user changes before finalizing spec |

---

## Step 2: Dispatch Specification Agents

**CRITICAL**: You **MUST** delegate document generation to sub-agents using the
Task tool. Do NOT perform this work inline in the main context. The main context
should only orchestrate and review agent outputs.

### Agent 1: Specification Writer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Generate a complete feature specification for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/research.md — Codebase analysis, integration points, patterns, constraints
- {FEATURE_DIR}/proposal-review.md — Approved business scenario, architecture direction, options, overrides
- .specify/templates/spec-template.md — Template structure to follow
- {FEATURE_DIR}/discovery.md — Business discovery findings (read if exists, skip if not)
- {FEATURE_DIR}/journeys/base-journey.md — AI-augmented four-step application journey (read if exists, skip if not)
- {FEATURE_DIR}/ui-preview-brief.md — UI-first preview brief for app delivery (read if exists, skip if not)
- {FEATURE_DIR}/service-fit-matrix.md — approved or draft service-fit evidence (read if exists, skip if not)
- {FEATURE_DIR}/context-bundle.md — Compact EnterpriseAI context (read if exists, skip if not)
- {FEATURE_DIR}/reuse-scan.md — Reuse-before-create evidence (read if exists, skip if not)

Generate the COMPLETE spec.md following this structure:

1. YAML frontmatter: id, title, status: draft, created (ISO date), updated, author: Claude
2. Overview — High-level description of what this feature does and why it matters
3. User Stories — Prioritized P1/P2/P3 with 'As a [user] I want to [action] So that [benefit]'
   - Each story MUST have checkable acceptance criteria (- [ ] format)
4. Functional Requirements — Each must be testable, reference codebase patterns from research
5. Non-Functional Requirements — Performance, security, compatibility
6. Success Criteria — Measurable, technology-agnostic outcomes in table format
7. Assumptions — From research findings
8. Dependencies — From research integration points
9. Out of Scope — Clear boundaries
10. Glossary — Key terms
11. Research Traceability — Matrix mapping each research finding to a spec section
12. AI-Augmented 4-Step Journey — required for app delivery, not applicable for explicit non-app work
13. UI Preview And Approval Gate — required for app delivery, not applicable for explicit non-app work
14. EnterpriseAI Service Fit — required for app delivery, not applicable for explicit non-app work
15. EnterpriseAI Contract Pack Summary — actors, object types, workflows, permissions, APIs/events, runtime assumptions, acceptance tests

If discovery.md exists, use it to:
- Use Problem Statement for Overview motivation
- Use Target Users persona for 'As a [user type]' in stories
- Use Success Metrics as targets in Success Criteria
- Use Value Proposition for primary value framing
- Use Application Classification to decide whether the app journey is mandatory

If journeys/base-journey.md exists and is classified as app delivery, use it to:
- Keep the user-facing scope to four steps or fewer unless the user explicitly
  accepted extra complexity
- Convert each step goal into functional requirements and acceptance criteria
- Preserve the AI assistance mode for each step: chat/voice/accessibility/
  translation, contextual prefill, recommendation, validation, completion
  checks, human review, audit trail, or escalation
- Add explicit requirements for user control, evidence display, confidence,
  editability, and accessibility at each AI-assisted step

If ui-preview-brief.md exists, use it to:
- Require the first MVP preview to stay inside the approved Vertical Template
  blocks before any create-new UI concept is proposed
- Carry forward branding/logo requirements as explicit scope, not as implied
  polish
- Require preview self-review evidence such as screenshot, local render proof,
  or Playwright-style checks before stakeholder presentation
- Require a versioned `ui-review-log.md` and explicit `ui-approval.md` before
  downstream planning/tasks are treated as complete

If service-fit-matrix.md exists, use it to:
- Separate desired platform capabilities into accessible now, purchasable but
  unavailable now, and unsupported without new platform work
- Bind each chosen capability back to user-facing workflow needs rather than
  generic platform availability
- Keep non-selected or blocked capabilities in Out of Scope, Assumptions, or
  Risks as appropriate

If proposal-review.md exists and status is approved, use it to:
- Treat Recommended Business Scenario as the authoritative scope for the spec
- Reflect the approved architecture direction in Assumptions, Dependencies, and NFR framing
- Carry forward any approved user overrides before finalizing requirements
- Place non-selected options in Out of Scope or Assumptions where appropriate

Rules:
- Focus on WHAT and WHY, never HOW to implement
- Written for business stakeholders, not developers
- Maximum 3 [NEEDS CLARIFICATION] markers for genuinely ambiguous items
- Acknowledge ALL constraints from research.md in Assumptions or NFRs
- Reference ALL integration points from research.md in Dependencies
- Honor the approved direction in proposal-review.md over unapproved alternatives
- Each functional requirement must include Validation and Integration references
- Explicit non-app work MUST keep the shared numbered stages but MUST NOT be
  forced to create app-only preview, approval, branding, or service-fit
  sections beyond marking them "Not applicable"

Write the complete specification to {FEATURE_DIR}/spec.md.
When EnterpriseAI is active or no profile is specified, also write
{FEATURE_DIR}/contract-pack.md using the contract pack requirements below.

Return a structured summary:
- User story count and priorities
- Functional requirement count
- Success criteria count
- [NEEDS CLARIFICATION] items (if any)
- Research coverage: integration points addressed / total
- Research coverage: constraints addressed / total"
```

### Agent 2: Quality Checklist & Research Validator

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Validate the specification at {FEATURE_DIR}/spec.md against research
findings and generate a quality checklist.

Read:
- {FEATURE_DIR}/spec.md — The specification to validate
- {FEATURE_DIR}/research.md — Research findings to cross-reference
- {FEATURE_DIR}/proposal-review.md — Approved review decisions to cross-reference

Part 1: Research Integration Validation (GAP-04)
For EACH integration point in research.md, check if it's addressed in spec:
- In Dependencies, Functional Requirements, or Assumptions section
For EACH constraint from research.md, check if acknowledged in spec:
- In Assumptions or Non-Functional Requirements
For EACH technology decision, check if reflected in Dependencies.
For EACH approved decision or override in proposal-review.md, check if it is
represented in Overview, Requirements, Assumptions, Dependencies, or Out of Scope.

Build a coverage matrix:
| Research Finding | Type | Spec Section | Status (COVERED/MISSING) |

Part 2: Quality Checklist
Validate these dimensions against spec.md:
- Content Quality: No implementation details, user-focused, non-technical language
- Requirement Completeness: Testable, unambiguous, measurable success criteria
- Research Integration: All integration points, constraints, patterns addressed
- Acceptance Criteria: Every user story has checkable criteria

Write the checklist to {FEATURE_DIR}/checklists/requirements.md.

Return:
- Research coverage percentage
- Count of MISSING research items (if any)
- Specific gaps that need fixing
- Quality checklist pass/fail status"
```

**Run Agent 1 first**, then Agent 2 after spec.md is written.

---

## Step 3: Review Agent Output

After both agents complete:

1. **Review spec writer summary** — Verify:
   - All user stories have acceptance criteria
   - Success criteria are measurable and technology-agnostic
   - Dependencies reference correct codebase components from research
   - Approved scenario and architecture choices from proposal-review.md are
     reflected
   - Research traceability matrix is complete

2. **Check research coverage** — From the validator agent:
   - If MISSING items found: Edit spec.md to add missing coverage
   - Add missing integration points to Dependencies section
   - Add missing constraints to Assumptions or NFR sections
   - Update the Research Traceability matrix

3. **Fix any gaps** — Make targeted edits to spec.md for coverage failures

4. **Handle clarifications** — If [NEEDS CLARIFICATION] markers exist (max 3):
   - Present questions with suggested answers to user
   - Wait for user response
   - Update spec.md with answers

---

## Step 3.7: Multi-Perspective Spec Review (Optional)

Before finalizing, optionally run multi-perspective strategies to stress-test
the specification. **Skip this step if the spec is simple or time-constrained.**

### Strategy #10: Spec Ambiguity Detector

Spawn 3 agents that independently interpret the spec and write pseudocode.
Compare their interpretations to find ambiguities:

```
Task: subagent_type="specify-ambiguity-detector", model="sonnet"
Prompt: "You are Agent [1/2/3]. Read spec.md at [FEATURE_DIR]/spec.md.
For each acceptance criterion, write pseudocode showing how you would implement it.
Document every assumption you make. Focus on literal interpretation."
```

Run all 3 agents in parallel, then synthesize with judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: ambiguity detection.
Compare these 3 independent spec interpretations. Identify criteria where agents
diverged — these are specification ambiguities that need clarification.
[paste all 3 agent outputs]"
```

If the judge identifies HIGH ambiguity (>30% criteria diverge), add
clarifications to the spec before proceeding.

### Strategy #19: User Journey Stress Tester

Spawn 4 persona agents to walk through user journeys and find gaps:

```
Task: subagent_type="specify-journey-stress-tester", model="haiku"
Prompt: "You are Persona [1/2/3/4]. Walk through the user journeys in spec.md at [FEATURE_DIR]/spec.md.
Persona 1: Power user — fast, keyboard-driven, expects batch operations
Persona 2: First-timer — needs onboarding, clear errors, discoverable features
Persona 3: Accessibility-dependent — screen reader, keyboard-only
Persona 4: Adversarial — tries to break things, unexpected inputs"
```

Run all 4 personas in parallel, then synthesize with judge:

```
Task: subagent_type="multi-perspective-judge", model="sonnet"
Prompt: "Judge verdict type: journey gap analysis.
Synthesize 4 persona journey reports. Flag gaps found by 2+ personas as HIGH priority.
[paste all 4 agent outputs]"
```

If HIGH priority gaps are found, add them to the spec before proceeding.

---

## Step 4: Validate Quality

The quality checklist was generated by Agent 2 at
`{FEATURE_DIR}/checklists/requirements.md`.

1. **Verify checklist exists** and all dimensions pass
2. **If items fail**: Update spec.md, re-validate (max 3 iterations)
3. **If [NEEDS CLARIFICATION] markers remain** (max 3):
   - Present questions with suggested answers
   - Wait for user response
   - Update spec with answers
   - Re-validate

---

## Step 5: Sequence Diagram Option Generation (Optional)

**If a base journey exists** at `{FEATURE_DIR}/journeys/base-journey.md`:

Generate 5 implementation options spanning the efficiency→innovation spectrum.

### Load Option Templates

Read `.specify/templates/sequence-diagrams/option-spectrum.yaml` for option
definitions:

- Option 1: Minimal (95% efficiency, 10% innovation)
- Option 2: Efficient (80% efficiency, 30% innovation)
- Option 3: Standard (60% efficiency, 50% innovation)
- Option 4: Enhanced (40% efficiency, 70% innovation)
- Option 5: Innovative (20% efficiency, 95% innovation)

### Generate 5 Options

For each option (1-5), create a sequence diagram file at:
`{FEATURE_DIR}/sequence-diagrams/option-{N}-{name}.md`

**Each option file should include:**

````markdown
---
id: {feature}-option-{N}
optionNumber: {N}
name: {Option Name}
efficiencyScore: {from template}
innovationScore: {from template}
complexityTarget: {from template}
estimatedEffort: {from template}
created: {ISO-timestamp}
---

# Sequence Diagram Option {N}: {Name}

## Overview

{Description from option-spectrum.yaml adapted to this feature}

## Characteristics

{List characteristics from template, adapted to feature context}

## Actors

| Actor     | Role                  | System/Human |
| --------- | --------------------- | ------------ |
| {Actor 1} | {Role in this option} | {Type}       |

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant System
    {Additional participants based on option complexity}

    Note over User: Option {N} - {Name}

    {Interactions appropriate to this option's complexity level}

    {Gen AI touchpoints if applicable - highlighted in rect}
```
````

## Gen AI Touchpoints

{List from template, or "None for this option" for Minimal}

- **{Touchpoint 1}**: {How it applies to this feature}

## Scores

| Metric     | Score             |
| ---------- | ----------------- |
| Efficiency | {score}%          |
| Innovation | {score}%          |
| Complexity | {low/medium/high} |

## Estimated Effort

{From template}

## Risks

{List risks from template, adapted to feature}

## Trade-offs

{Explain what you gain and lose with this option}

```

### Present Options for Selection

After generating all 5 options, present them to the user via **AskUserQuestion**:

```

Question: "Which implementation option best fits your needs?" Header: "Option"
Options:

1. "Option 1: Minimal" - "Fast delivery, basic functionality, no AI features"
2. "Option 2: Efficient" - "Good balance of speed and quality, minimal AI"
3. "Option 3: Standard (Recommended)" - "Full features, moderate AI integration"
4. "Option 4: Enhanced" - "Rich features, significant AI assistance"
5. "Option 5: Innovative" - "Cutting-edge, heavy AI/ML, longer timeline"

````

### Save Selection

After user selects an option:

1. **Copy selected option** to `{FEATURE_DIR}/sequence-diagrams/selected-option.md`
2. **Add selection metadata** to the file header:
   ```yaml
   selected: true
   selectedAt: {ISO-timestamp}
   selectedBy: user
````

3. **Reference in spec.md** - Add section:

   ```markdown
   ## Selected Implementation Approach

   **Option {N}: {Name}** was selected as the implementation approach.

   - Efficiency Score: {score}%
   - Innovation Score: {score}%
   - Estimated Effort: {effort}

   See `sequence-diagrams/selected-option.md` for full details.
   ```

### Skip Conditions

Skip sequence diagram generation if:

1. No base journey exists (user skipped journey mapping)
2. Feature is purely technical infrastructure (no user-facing interactions)
3. Context window is at Warning level (>50%)
4. User explicitly opts out during journey confirmation

---

## Step 6: Report and Continue

After spec.md is complete:

```
✓ Specification complete: {FEATURE_DIR}/spec.md

Summary:
- [N] User Stories defined
- [N] Functional Requirements
- [N] Success Criteria

Checklist: {FEATURE_DIR}/checklists/requirements.md

{If sequence diagrams generated:}
Sequence Diagrams: {FEATURE_DIR}/sequence-diagrams/
Selected Option: Option {N} - {Name}
```

**AUTO-CHAIN (MANDATORY)**: You MUST immediately invoke the next pipeline stage
by calling the Skill tool with skill="/3_gofer_plan". Do NOT ask the user for
confirmation. Do NOT output "Ready for next stage". Just invoke the skill NOW.

---

## Guidelines

### Quick Guidelines

- Focus on **WHAT** users need and **WHY**
- Avoid HOW to implement (that's for /3_gofer_plan)
- Written for business stakeholders, not developers
- **Use research findings** to inform requirements

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Specific metrics (time, percentage, count)
2. **Technology-agnostic**: No frameworks, languages, databases
3. **User-focused**: Outcomes from user perspective
4. **Verifiable**: Can be tested without implementation details

### Research Integration

- Reference research.md for technical context
- Use identified integration points in dependencies
- Acknowledge constraints in assumptions
- Align with codebase patterns discovered

---

## EnterpriseAI Integration Map Requirements

EnterpriseAI is the default profile. Standard-profile outputs remain unchanged
only when the user explicitly opts out.

When the workflow profile is `enterpriseai`, `spec.md` MUST include an explicit
**Integration Map** section that traces the flow from end-user interaction to
the deployed EnterpriseAI vertical application and back. The map must be
expressed as an ordered dependency chain following the pattern:

```
Vertical App -> EAI Services -> Deployment Target
```

At minimum the map must name:

1. **Vertical App**: the student-facing or business-facing vertical being
   delivered (maps to the `vertical-template` reference).
2. **EAI Services**: the EnterpriseAI platform services the vertical consumes
   (maps to entries in `.specify/references/eai/eai-cli.md`).
3. **Deployment Target**: the deployment environment and pipeline that will host
   the running vertical (maps to `.specify/references/eai/deployment-repo.md`).

Each link in the chain must reference the internal API contract that carries the
integration payload (for example `IAP-001` → `IAP-002` → `IAP-003`) so the plan
stage can bind implementation tasks directly to specification clauses.

---

## EnterpriseAI Contract Pack Requirements

When EnterpriseAI is active or no profile is specified, generate
`{FEATURE_DIR}/contract-pack.md` with these required sections:

| Section | Required Content |
| ------- | ---------------- |
| Actors | Business users, administrators, approvers, external systems, support roles |
| Object Types | Reused, extended, and newly proposed EnterpriseAI object types with owners |
| Workflows and Journeys | External user journeys and internal orchestration flows as separate views; app delivery must include the four-step-or-fewer AI-augmented journey |
| UI Preview and Approval | For app delivery: preview brief, Vertical Template constraints, branding inputs, preview validation evidence expectations, review-log requirements, approval gate rules; for non-app work: mark not applicable |
| AI Assistance Contract | Step goal, assistance mode, context used, generated output, user controls, confidence/evidence, audit trail, completion signal, and escalation for each app step |
| EnterpriseAI Service Fit | For app delivery: desired capabilities, evidence source, accessible now vs purchasable vs unavailable classification, selected direction, and blocked-capability handling |
| Permissions and Tenant Boundaries | Identity, authorization, policy, isolation, and tenant assumptions |
| APIs and Events | ResourceAPI surfaces, events, payload ownership, and contract-test hooks |
| Deployment and Runtime | Environment, config, observability, rollback, and operating assumptions |
| Acceptance Tests | Business, security, data, architecture, operational, and regression checks |

The contract pack must link every new object type/API/workflow back to
`reuse-scan.md` and must flag any "create new" decision that lacks evidence.

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 2_specify --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`

---

## Optional Helpers: Vocabulary Extraction and Spec Summary

- If the operator explicitly requests the `vocabulary` selector after `spec.md`
  is stabilized, run `gofer:vocabulary` inline and write
  `.specify/specs/{feature}/glossary.md` using the same artifact contract as the
  standalone helper.
- If the operator explicitly requests the `spec-summary` selector after `spec.md`
  is stabilized, run `gofer:spec-summary` inline and write
  `.specify/specs/{feature}/spec-summary.md` using the same artifact contract as
  the standalone helper.
- If `spec.md` is missing, continue the stage normally and report that the
  helper was not run.
- These selectors are optional and do not change stage progress, routing, or
  pipeline state.
