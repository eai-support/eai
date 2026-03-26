---
name: 2_gofer_specify
description: Create feature specification informed by codebase research
arguments:
  - name: feature
    description: Feature name or description
    required: false
result_schema:
  type: object
  properties:
    output:
      type: string
      description: Path to generated artifact or execution summary
    status:
      type: string
      enum:
        - success
        - error
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
- `research.md` completed from `$ $1`

If these don't exist, prompt user to run `$ $1` first.

---

## Outline

1. Context health check
2. Load existing research findings (lightweight)
3. Dispatch specification agents (sub-agents handle heavy generation)
4. Review agent output, handle clarifications
5. Optional multi-perspective review
6. Output: `.specify/specs/{feature}/spec.md`

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
   .specify/scripts/bash/check-prerequisites.sh --json
   ```

   Parse JSON for FEATURE_DIR

2. **Scan research.md** from FEATURE_DIR (do NOT load full content into main
   context — agents will read it directly):
   - Note the feature name and description
   - Note whether discovery.md exists

3. **Note template path**: `.specify/templates/spec-template.md`

4. **Check for discovery.md**:
   ```bash
   ls -la {FEATURE_DIR}/discovery.md 2>/dev/null
   ```

---

## Step 1.5: Discovery Context Reference

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

---

## Step 2: Dispatch Specification Agents

**CRITICAL**: You **MUST** delegate document generation to sub-agents using the
Task tool. Do NOT perform this work inline in the main context. The main context
should only orchestrate and review agent outputs.

### Agent 1: Specification Writer

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the general-purpose analysis in each., model="sonnet"
Prompt: "Generate a complete feature specification for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/research.md — Codebase analysis, integration points, patterns, constraints
- .specify/templates/spec-template.md — Template structure to follow
- {FEATURE_DIR}/discovery.md — Business discovery findings (read if exists, skip if not)

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

If discovery.md exists, use it to:
- Use Problem Statement for Overview motivation
- Use Target Users persona for 'As a [user type]' in stories
- Use Success Metrics as targets in Success Criteria
- Use Value Proposition for primary value framing

Rules:
- Focus on WHAT and WHY, never HOW to implement
- Written for business stakeholders, not developers
- Maximum 3 [NEEDS CLARIFICATION] markers for genuinely ambiguous items
- Acknowledge ALL constraints from research.md in Assumptions or NFRs
- Reference ALL integration points from research.md in Dependencies
- Each functional requirement must include Validation and Integration references

Write the complete specification to {FEATURE_DIR}/spec.md.

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
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the general-purpose analysis in each., model="haiku"
Prompt: "Validate the specification at {FEATURE_DIR}/spec.md against research
findings and generate a quality checklist.

Read:
- {FEATURE_DIR}/spec.md — The specification to validate
- {FEATURE_DIR}/research.md — Research findings to cross-reference

Part 1: Research Integration Validation (GAP-04)
For EACH integration point in research.md, check if it's addressed in spec:
- In Dependencies, Functional Requirements, or Assumptions section
For EACH constraint from research.md, check if acknowledged in spec:
- In Assumptions or Non-Functional Requirements
For EACH technology decision, check if reflected in Dependencies.

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
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the specify-ambiguity-detector analysis in each., model="sonnet"
Prompt: "You are Agent [1/2/3]. Read spec.md at [FEATURE_DIR]/spec.md.
For each acceptance criterion, write pseudocode showing how you would implement it.
Document every assumption you make. Focus on literal interpretation."
```

Run all 3 agents in parallel, then synthesize with judge:

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the multi-perspective-judge analysis in each., model="opus"
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
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the specify-journey-stress-tester analysis in each., model="haiku"
Prompt: "You are Persona [1/2/3/4]. Walk through the user journeys in spec.md at [FEATURE_DIR]/spec.md.
Persona 1: Power user — fast, keyboard-driven, expects batch operations
Persona 2: First-timer — needs onboarding, clear errors, discoverable features
Persona 3: Accessibility-dependent — screen reader, keyboard-only
Persona 4: Adversarial — tries to break things, unexpected inputs"
```

Run all 4 personas in parallel, then synthesize with judge:

```
**Note**: Codex CLI does not support the Task tool. For parallel agent work, open multiple Codex CLI sessions and run the multi-perspective-judge analysis in each., model="sonnet"
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


---

## Guidelines

### Quick Guidelines

- Focus on **WHAT** users need and **WHY**
- Avoid HOW to implement (that's for $ $1)
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

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 2_specify --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`


## Pipeline Continuation

This completes the 2_gofer_specify stage. To continue the Gofer pipeline:

**Next Command:** `$ $3_gofer_plan`

The next stage will use the artifacts generated by this command and continue the implementation workflow.

**Note:** Codex CLI does not support automatic command chaining. You must manually run each stage command to progress through the pipeline.
