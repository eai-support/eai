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

If these don't exist, prompt user to run `/1_gofer_research` first.

---

## Outline

1. Context health check
2. Load existing research findings
3. Create specification using research context
4. Validate spec quality
5. Output: `.specify/specs/{feature}/spec.md`

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

## Step 1: Load Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json
   ```

   Parse JSON for FEATURE_DIR

2. **Load research.md** from FEATURE_DIR:
   - Integration points identified
   - Patterns to follow
   - Technology decisions made
   - Constraints documented

3. **Load spec template**: `.specify/templates/spec-template.md`

4. **Load discovery.md** (if exists) for auto-population:
   ```bash
   ls -la {FEATURE_DIR}/discovery.md 2>/dev/null
   ```

---

## Step 1.5: Auto-Populate from Discovery (If Available)

If discovery.md exists, pre-fill spec sections from discovery findings:

### Discovery → Spec Mapping

| Discovery Section    | Spec Section             | How to Use                           |
| -------------------- | ------------------------ | ------------------------------------ |
| Problem Statement    | Overview                 | Use pain point as feature motivation |
| Target Users         | User Stories             | Use persona as "As a [user type]"    |
| Value Proposition    | Success Criteria         | Convert to measurable metrics        |
| Success Metrics      | Success Criteria         | Use directly as targets              |
| Constraints          | Assumptions              | Include as spec assumptions          |
| Competitive Analysis | Overview or Out of Scope | Inform differentiation               |

### Pre-filled Content

When discovery.md exists, start spec.md with:

```markdown
## Overview

[Feature] addresses [Problem from discovery.md - Pain Point].

**Target Users**: [From discovery.md - Target Users - Persona] **Primary
Value**: [From discovery.md - Value Proposition - Primary Value]

**Discovery Reference**: See `discovery.md` for full business context.
**Research Reference**: See `research.md` for codebase analysis.
```

### User Story Generation from Discovery

Generate user stories using discovery context:

```markdown
### US1: [Derived from Problem + Primary Value] (P1)

**As a** [Target Users - Persona] **I want to** [Solve Problem - Pain Point]
**So that** [Value Proposition - Primary Value]

**Acceptance Criteria**:

- [ ] [Derived from Success Metrics]
```

### Success Criteria from Discovery

Convert discovery metrics to spec success criteria:

| Discovery Metric        | Spec Success Criterion             |
| ----------------------- | ---------------------------------- |
| [Metric from discovery] | [Measurable target from discovery] |

**Note**: If discovery.md doesn't exist, generate spec content from research.md
and user input as before.

---

## Step 2: Create Specification

Using research findings, create the specification:

### 2.1 Extract Key Information from Research

From research.md, identify:

- **Where code will live** (from "Where to Implement")
- **Patterns to follow** (from "Existing Patterns")
- **Constraints** (from "Constraints & Considerations")
- **Open questions** (resolve or mark for clarification)

### 2.2 Generate Spec Content

Follow this execution flow:

1. **Parse feature context** from research
   - If research is incomplete: ERROR "Research incomplete, run
     /1_gofer_research"

2. **Extract key concepts**:
   - Actors (who uses this)
   - Actions (what they do)
   - Data (what's involved)
   - Constraints (from research)

3. **For unclear aspects**:
   - Check if research already answered it
   - Make informed guesses based on codebase patterns
   - Only mark with [NEEDS CLARIFICATION] if:
     - Significantly impacts scope or UX
     - Multiple reasonable interpretations exist
     - No reasonable default exists
   - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers**

4. **Fill User Scenarios & Testing section**
   - Use integration points from research
   - If no clear user flow: ERROR "Cannot determine user scenarios"

5. **Generate Functional Requirements**
   - Each requirement must be testable
   - Reference codebase patterns from research

6. **Define Success Criteria**
   - Measurable, technology-agnostic outcomes
   - Include quantitative and qualitative measures

7. **Identify Key Entities** (if data involved)
   - Reference data-model patterns from research

---

## Step 3: Write Specification

Write to `{FEATURE_DIR}/spec.md`:

```markdown
---
id: [feature-id]
title: [Feature Title]
status: draft
created: [ISO date]
updated: [ISO date]
author: Claude
---

# [Feature Title]

## Overview

[High-level description of what this feature does and why it matters]

**Research Reference**: See `research.md` for codebase analysis and integration
points.

## User Stories

### US1: [Primary User Story] (P1)

**As a** [user type] **I want to** [action] **So that** [benefit]

**Acceptance Criteria**:

- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

### US2: [Secondary User Story] (P2)

...

## Functional Requirements

### FR1: [Requirement Name]

[Description of the requirement]

- **Validation**: [How to test this]
- **Integration**: [Reference to codebase integration point from research]

### FR2: [Requirement Name]

...

## Non-Functional Requirements

### Performance

- [Performance requirement informed by codebase patterns]

### Security

- [Security requirement]

### Compatibility

- [Compatibility with existing codebase patterns]

## Success Criteria

| Metric     | Target   | Measurement    |
| ---------- | -------- | -------------- |
| [Metric 1] | [Target] | [How measured] |
| [Metric 2] | [Target] | [How measured] |

## Assumptions

- [Assumption 1 - from research findings]
- [Assumption 2]

## Dependencies

- [Dependency on existing codebase component - from research]
- [External dependency]

## Out of Scope

- [What this feature does NOT include]

## Glossary

| Term   | Definition   |
| ------ | ------------ |
| [Term] | [Definition] |
```

---

## Step 3.5: Research Integration Validation (GAP-04)

**CRITICAL**: Before proceeding, validate that the specification incorporates
ALL findings from research.md. This prevents research waste and missed
constraints.

### 3.5.1 Integration Points Coverage

For EACH integration point identified in research.md:

| Integration Point     | Addressed In Spec? | Section                | How Addressed |
| --------------------- | ------------------ | ---------------------- | ------------- |
| [Point from research] | Yes/No             | [FR-X or Dependencies] | [Explanation] |

**Validation Rule**: ALL integration points MUST appear in spec (Dependencies,
Functional Requirements, or Assumptions section).

If any integration point is NOT addressed:

- ERROR: "Integration point '[X]' from research not addressed in spec"
- Add to appropriate section before proceeding

### 3.5.2 Constraint Acknowledgment

For EACH constraint from research.md "Constraints & Considerations":

| Constraint                 | Acknowledged? | Section           | How Addressed |
| -------------------------- | ------------- | ----------------- | ------------- |
| [Constraint from research] | Yes/No        | [Assumptions/NFR] | [Explanation] |

**Validation Rule**: ALL constraints MUST be acknowledged in Assumptions or
Non-Functional Requirements.

If any constraint is NOT acknowledged:

- ERROR: "Constraint '[X]' from research not acknowledged in spec"
- Add to Assumptions or NFR section

### 3.5.3 Technology Decision Alignment

For EACH technology decision from research.md:

| Decision        | Relevant to Spec? | Reflected In               | Notes         |
| --------------- | ----------------- | -------------------------- | ------------- |
| [Tech decision] | Yes/No            | [Dependencies/Assumptions] | [If relevant] |

**Validation Rule**: Technology decisions affecting requirements MUST be
reflected in Dependencies or inform requirement scoping.

### 3.5.4 Pattern Compliance

Verify spec requirements align with existing codebase patterns from research:

- [ ] Requirements don't contradict existing patterns
- [ ] Integration approach aligns with codebase conventions
- [ ] Dependencies reference correct existing components

### 3.5.5 Generate Research Coverage Matrix

Add to end of spec.md:

```markdown
## Research Traceability

| Research Finding      | Spec Section | Reference |
| --------------------- | ------------ | --------- |
| [Integration Point 1] | Dependencies | Line X    |
| [Constraint 1]        | Assumptions  | Line Y    |
| [Tech Decision 1]     | FR-001       | Line Z    |
```

**Proceed only when ALL research findings are traced to spec sections.**

---

## Step 3.7: Multi-Perspective Spec Review (Optional)

Before the quality checklist, optionally run multi-perspective strategies to
stress-test the specification. **Skip this step if the spec is simple or
time-constrained.**

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

## Step 4: Create Quality Checklist

Generate `{FEATURE_DIR}/checklists/requirements.md`:

```markdown
# Specification Quality Checklist: [FEATURE NAME]

**Purpose**: Validate specification completeness before planning **Created**:
[DATE] **Feature**: [Link to spec.md]

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed
- [ ] Research findings incorporated

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Success criteria are technology-agnostic
- [ ] All acceptance scenarios defined
- [ ] Edge cases identified
- [ ] Scope clearly bounded
- [ ] Dependencies identified (from research)

## Research Integration

- [ ] Integration points referenced
- [ ] Codebase patterns acknowledged
- [ ] Constraints from research addressed
- [ ] Technology decisions aligned

## Notes

Items marked incomplete require spec updates before `/3_gofer_plan`
```

---

## Step 5: Validate and Handle Clarifications

1. **Run validation** against checklist
2. **If items fail**: Update spec, re-validate (max 3 iterations)
3. **If [NEEDS CLARIFICATION] markers remain** (max 3):
   - Present questions with suggested answers
   - Wait for user response
   - Update spec with answers
   - Re-validate

---

## Step 5.5: Sequence Diagram Option Generation (Optional)

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

Ready for next stage: /3_gofer_plan
```

If orchestrated by `/0_business_scenario`, the orchestrator will automatically
invoke `/3_gofer_plan` next.

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

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 2_specify --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`
