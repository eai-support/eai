---
name: 1_gofer_research
description: Deep codebase and technology research for feature implementation
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
  canonicalSource: .specify/commands/1_gofer_research.md
  canonicalChecksum: d95dcba083abf5d7c230cb58f490e1ac6d5c96a6f6ed1d8a2cf396d05c09268f
  metadataSource: scripts/generate-commands.ts
---


# Gofer Research

You are conducting comprehensive research to understand the codebase before
specifying a new feature. This combines deep codebase exploration with
technology research.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

This is the **first stage** of the unified Gofer pipeline. Your job is to:

1. Check context health
2. Understand what the user wants to build
3. Research the codebase to find where it should be implemented
4. Identify patterns, existing code, and integration points
5. Document technology decisions, business scenarios, and architecture options
6. Prepare a user-facing review before specification begins

**Output**:

- `.specify/specs/{feature}/research.md`
- `.specify/specs/{feature}/proposal-review.md`
- `.specify/specs/{feature}/journeys/base-journey.md` (application delivery default)
- `.specify/specs/{feature}/ui-preview-brief.md` (application delivery default)
- `.specify/specs/{feature}/context-bundle.md` (EnterpriseAI default)
- `.specify/specs/{feature}/reuse-scan.md` (EnterpriseAI default)

---

## Step 0: Context Health Check

Before starting research, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Consider compacting after this stage completes
- If **> 70%**: Start a new session with a handoff summary

Research is typically the heaviest context stage - monitor usage.

---

## Step 0.5: Load Discovery Context (If Available)

Check if discovery.md exists for this feature:

```bash
ls -la .specify/specs/{feature}/discovery.md 2>/dev/null
```

If discovery.md exists:

1. **Load the discovery findings** to inform research focus:
   - Problem Statement → Focus research on solving this specific problem
   - Target Users → Research UX patterns appropriate for these users
   - Value Proposition → Research metrics and measurement approaches
   - Competitive Analysis → If researched, focus on differentiation
   - Application Classification → Determine whether a four-step AI-augmented
     app journey is required
   - AI-Augmented Journey → If app delivery, preserve the four-step-or-fewer
     journey as the scope spine for research
   - Shared numbered-stage contract → if non-app, preserve the current shared
     stages without adding app-only preview or service-fit requirements

2. **Use discovery to guide agent prompts**:
   - Codebase Locator: Focus on areas related to the discovered problem
   - Codebase Analyzer: Analyze patterns relevant to target users
   - Pattern Finder: Find examples that deliver similar value
   - AI Pattern Finder: Find existing chatbot, voice, accessibility,
     translation, contextual prefill, recommendation, validation, or
     human-review patterns that can support each journey step

3. **Load discovery memories** via MemoryManager if available:
   ```
   Category: 'discovery'
   Tags: ['#feature-{id}']
   ```

If no discovery.md exists, proceed with standard research flow.

---

## Step 1: Get Feature Context

If no feature description provided in $ARGUMENTS:

1. Ask: **"What feature or change would you like to work on?"**
2. Wait for user response

Once you have the feature description:

1. **Generate a short name** (2-4 words) for the feature
2. Run `.specify/scripts/bash/create-new-feature.sh --json "$DESCRIPTION"` with
   `--short-name "your-short-name"` to create the feature directory
3. Parse JSON output for FEATURE_DIR and BRANCH_NAME

---

## Step 2: Spawn Parallel Research Agents

**CRITICAL**: You **MUST** launch these agents using the Task tool. Do NOT
perform this research work inline in the main context. The main context should
only orchestrate and review agent outputs.

### Agent 1: Codebase Locator

```
Task: subagent_type="codebase-locator", model="haiku"
Prompt: "Find all code related to [FEATURE AREA] in this codebase.
Identify: entry points, related files, directory structure, key classes/functions.
Focus on: [specific aspects from user's description]"
```

### Agent 2: Codebase Analyzer

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Analyze how [RELATED FUNCTIONALITY] is implemented in this codebase.
Explain: architecture patterns, data flow, key abstractions.
Focus on: [how similar features work]"
```

### Agent 3: Pattern Finder

```
Task: subagent_type="codebase-pattern-finder", model="haiku"
Prompt: "Find examples of [PATTERN TYPE] in this codebase.
Show: similar implementations we should model after.
Include: file paths, code snippets, conventions used."
```

**Run all three agents in parallel** for maximum efficiency.

---

## Step 2.5: Multi-Perspective Research (Optional)

After the core research agents complete, optionally run additional perspective
strategies for deeper analysis. **Skip this step if the feature is
straightforward or time-constrained.**

### Strategy #6: Research Perspective Multiplier

When the feature involves complex integration or unfamiliar territory, spawn 5
perspective agents:

```
Task: subagent_type="research-perspective-multiplier", model="haiku"
Prompt: "Research [TOPIC] from perspective [1-5].
Perspective 1: Existing codebase patterns
Perspective 2: Open-source project approaches
Perspective 3: Latest documentation/guides
Perspective 4: Anti-patterns to avoid
Perspective 5: Emerging approaches
Context: [summary of feature and existing research findings]"
```

Run all 5 perspectives in parallel, then synthesize with judge:

```
Task: subagent_type="multi-perspective-judge", model="sonnet"
Prompt: "Judge verdict type: research synthesis.
Synthesize these 5 research perspectives into a unified recommendation.
[paste all 5 agent outputs]"
```

### Strategy #9: Dependency Evaluator

When the research proposes new dependencies, evaluate each one:

```
Task: subagent_type="research-dependency-evaluator", model="haiku"
Prompt: "Evaluate [LIBRARY NAME] from perspective [1-3].
Perspective 1: Evaluate the proposed library
Perspective 2: Find alternatives
Perspective 3: Estimate building without it
Needed functionality: [what we need from it]"
```

Run all 3 perspectives in parallel, then synthesize with judge:

```
Task: subagent_type="multi-perspective-judge", model="sonnet"
Prompt: "Judge verdict type: dependency decision.
Decide whether to adopt, find alternative, or build in-house.
[paste all 3 agent outputs]"
```

### Strategy #20: Technology Horizon Scanner

For features touching evolving technology areas:

```
Task: subagent_type="research-horizon-scanner", model="sonnet"
Prompt: "Scan for emerging alternatives and approaches relevant to [TOPIC].
Current approach: [what we're considering]
Tech stack: [relevant technologies]"
```

This is a single agent — no judge synthesis needed. Include findings in the
research document.

---

## Step 3: Technology Research

While waiting for agents, research any technology questions:

1. **Identify unknowns** from the feature description:
   - New libraries or frameworks needed?
   - Integration patterns to research?
   - Best practices to follow?

2. **Research each unknown** (use WebSearch if needed):
   - Decision: [what to use]
   - Rationale: [why chosen]
   - Alternatives: [what else considered]

---

## Step 3.5: Competitive Analysis Stage Flag (Optional, Run-Level)

Before drafting `research.md`, resolve competitive-analysis behavior for the
run:

- Treat competitive analysis as an explicit stage flag:
  `includeCompetitiveAnalysis` (alias: `competitiveAnalysisEnabled`).
- Default for `workflowProfile=enterpriseai`: `includeCompetitiveAnalysis=true`.
- Allow per-run override to disable competitive analysis without blocking the
  rest of the pipeline.
- Always generate `business-analysis.md` for EnterpriseAI runs.
- Always generate `market-analysis.md` for EnterpriseAI runs.
- When competitive analysis is disabled:
  - Record `competitiveAnalysisEnabled=false` in research outputs.
  - Keep `market-analysis.md` as a baseline traceability artifact with
    disabled-state messaging (no comparative metrics).
  - Continue to `#2_gofer_specify` normally (no stage failure).

When enabled, `market-analysis.md` must include:

- At least 3 alternatives.
- Explicit EnterpriseAI-selected direction rationale.
- Traceability indicators for downstream `spec.md` and `plan.md` references.

---

## Step 3.6: Context Bundle and Reuse-Before-Create Scan

EnterpriseAI is the default profile. Unless the user explicitly opts out with
the standard profile, generate:

1. `{FEATURE_DIR}/context-bundle.md`
   - Feature summary and approved business scenario.
   - Application classification: app delivery or non-app work, with rationale.
   - Four-step-or-fewer AI-augmented journey summary when app delivery applies.
   - Relevant existing specs, code paths, platform references, and API surfaces.
   - EnterpriseAI object types, tenant assumptions, deployment target, and
     validation criteria.
   - A compact "what the next agent needs" section to avoid dumping entire
     source files into later stages.
2. `{FEATURE_DIR}/reuse-scan.md`
   - Existing object types, APIs/events, workflows, modules, specs, and
     reference implementations that may satisfy the need.
   - Existing AI assistance capabilities: chat, voice, accessibility,
     translation, contextual prefill, recommendation, validation, completion
     checks, audit logging, and escalation.
   - Decision for each candidate: reuse, extend, or create new.
   - Rationale, evidence path, and stakeholder/architecture owner if a new
     platform concept is recommended.
3. `{FEATURE_DIR}/ui-preview-brief.md` (application delivery only)
   - MVP preview scope: target users, must-have screens, target workflow, and
     the smallest useful UI slice to show first.
   - Vertical Template constraint map: which approved template blocks or layout
     patterns the preview should use before any create-new UI concept is
     considered.
   - Branding inputs: whether client styling, logos, colors, copy tone, or
     other corporate-brand artifacts must be applied.
   - Preview validation plan: what screenshot, browser-render, or
     Playwright-style self-review evidence must exist before Gofer presents the
     preview to the stakeholder.
   - Non-app runs MUST skip this artifact and record "Not applicable" in
     `research.md`.

Do not recommend a new EnterpriseAI object type, API/event, workflow, or module
until the reuse-before-create scan is complete.

---

## Step 4: Synthesize Findings

Once all agents complete:

1. **Compile findings** from all sources
2. **Identify key integration points** in the codebase
3. **Document patterns to follow** from existing code
4. **Note constraints and considerations**
5. **Distill business scenario options and architecture recommendations** for
   user review before specification

### Structured Discovery Outputs (MANDATORY)

`research.md` MUST include all of the following in explicit sections:

1. **Structured Problem Statement**
   - Problem summary
   - Current state friction
   - Desired EnterpriseAI-oriented outcome
2. **Structured Target Persona**
   - Primary persona name/role
   - Skill level (novice/intermediate/advanced)
   - Primary needs and constraints
3. **Structured Value Proposition**
   - Primary value delivered
   - Quantified or measurable goal
   - Why this should be EnterpriseAI-first
4. **Application-Delivery Gate Summary** (app delivery only)
   - Preview-first rationale and the smallest useful MVP to show first
   - Vertical Template reuse constraints and any approved extension gaps
   - Candidate capability-discovery inputs for the later service-fit gate
   - Non-app runs must explicitly state "Not applicable"

### Novice Walkthrough Guardrail (MANDATORY)

Assume a novice user can read only in-repo/generated artifacts.

- Do not require external docs to understand or act on research output.
- Explain terms and recommendations in plain language before advanced details.

---

## Step 4.5: Generate Research Visuals (Persona Pack — US4)

After synthesis, dispatch the visual writers in parallel to produce the
research-stage visuals. These run AFTER research findings are compiled so they
can cite real integration points and capability mentions, but BEFORE
`research.md` is finalized so the writers can append cross-references to the
generated artefacts.

Run two sub-agents concurrently:

1. **`visual-c4-writer`** (Context level only at this stage)
   - Inputs:
     - `<feature_dir>/research.md` (working draft)
     - `<feature_dir>/discovery.md` (if present)
     - Template: `.specify/templates/visuals/c4-context-template.md`
   - Output: `<feature_dir>/visuals/c4-context.md`
   - Required: Mermaid `C4Context` block with named external systems and at
     least one Person; plain-language preamble ≥30 ≤200 words.

2. **`visual-heatmap-writer`** (Capability heatmap)
   - Inputs:
     - `<feature_dir>/research.md` (working draft)
     - Template: `.specify/templates/visuals/capability-heatmap-template.md`
   - Output: `<feature_dir>/visuals/capability-heatmap.md`
   - Required: Mermaid `quadrantChart` placing each capability on maturity ×
     strategic-value axes plus tabular complement listing touched / extended /
     replaced capabilities.

Both writers must honour the ≥30 ≤200 word plain-language preamble rule
(NFR-010). If a renderer fails downstream, the `mermaid-tabular-fallback.mjs`
helper provides a markdown-table replacement without losing information.

Cross-reference the generated artefacts from `research.md` (Step 5) under a new
`## Visuals` section.

---

## Step 5: Generate Research Document

Write to `{FEATURE_DIR}/research.md`:

````markdown
---
date: [ISO timestamp]
researcher: Claude
feature: '[Feature Name]'
status: complete
---

# Research: [Feature Name]

## Feature Summary

[Brief description of what we're building]

## Structured Discovery Output

### Problem Statement

- **Problem**: [What is not working today]
- **Current State Friction**: [Where users lose time/quality]
- **Desired EnterpriseAI Outcome**: [What success looks like in EAI terms]

### Target Persona

- **Primary Persona**: [Name/role]
- **Skill Level**: [novice/intermediate/advanced]
- **Top Needs**: [Need 1, Need 2, Need 3]
- **Constraints**: [Constraints that shape delivery]

### Value Proposition

- **Primary Value**: [Core value delivered]
- **Measurable Goal**: [Quantified target]
- **EnterpriseAI-First Rationale**: [Why EAI is the primary fit]

## Context Bundle Summary

- **Relevant Specs**: [Existing specs to carry forward]
- **Relevant Code Paths**: [Files/directories and why they matter]
- **EnterpriseAI Object Types**: [Known or candidate object types]
- **Tenant and Deployment Assumptions**: [Tenant, identity, runtime, target environment]
- **Validation Criteria**: [Business, security, data, architecture, and operational checks]

## Reuse-Before-Create Scan

| Candidate | Existing Evidence | Decision | Rationale | Owner |
| --------- | ----------------- | -------- | --------- | ----- |
| [Object type/API/workflow/module/spec] | [Path or reference] | Reuse/Extend/Create New | [Why] | [Owner] |

## Business Scenario Analysis

### Scenario Options Considered

| Scenario   | User/Business Fit | Delivery Trade-off | Recommendation |
| ---------- | ----------------- | ------------------ | -------------- |
| [Option 1] | [Why it fits]     | [Cost/complexity]  | [Adopt/defer]  |
| [Option 2] | [Why it fits]     | [Cost/complexity]  | [Adopt/defer]  |

### Recommended Scenario

[Which scenario should move forward into specification and why]

## Codebase Analysis

### Where to Implement

| Component     | Location          | Purpose        |
| ------------- | ----------------- | -------------- |
| [Component 1] | `path/to/file.ts` | [What it does] |
| [Component 2] | `path/to/dir/`    | [What it does] |

### Existing Patterns to Follow

#### Pattern 1: [Name]

Found in: `path/to/example.ts:45-67`

```typescript
// Example code showing the pattern
```
````

Why relevant: [Explanation]

#### Pattern 2: [Name]

...

### Integration Points

1. **[Integration 1]**: How to connect with existing code
2. **[Integration 2]**: ...

### Related Code

- `path/file.ts:123` - [Description]
- `path/other.ts:45` - [Description]

## Technology Decisions

### Decision 1: [Topic]

- **Choice**: [What we'll use]
- **Rationale**: [Why]
- **Alternatives considered**: [What else]

### Decision 2: [Topic]

...

## Recommended Architecture Direction

### Recommended Architecture

[Plain-language summary of the architecture direction this feature should use]

### Architecture Options Considered

| Option     | Why choose it | Why not choose it now |
| ---------- | ------------- | --------------------- |
| [Option 1] | [Benefit]     | [Trade-off]           |
| [Option 2] | [Benefit]     | [Trade-off]           |

## Constraints & Considerations

- [Constraint 1]: [Impact on implementation]
- [Constraint 2]: ...

## Open Questions

- [ ] [Question needing user input]
- [ ] [Another question]

## Recommendations

1. [Key recommendation for implementation]
2. [Another recommendation]

`````

---

## Step 5.5: Generate Proposal Review Document

Write to `{FEATURE_DIR}/proposal-review.md`:

````markdown
---
feature: '[Feature Name]'
created: [ISO timestamp]
status: pending_review
recommendedScenario: '[short label]'
recommendedArchitecture: '[short label]'
selectedOption: ''
approvedBy: ''
approvedAt: ''
---

# Proposal Review: [Feature Name]

## What We Found

[Short, evidence-backed summary of the research findings]

## Business Scenarios Considered

| Scenario | User Value | Delivery Trade-off | Recommendation |
| -------- | ---------- | ------------------ | -------------- |
| [Option 1] | [Value] | [Trade-off] | [Adopt/defer] |
| [Option 2] | [Value] | [Trade-off] | [Adopt/defer] |

## Recommended Business Scenario

[What should be specified next and why]

## Technology Architecture Recommendation

### Recommended Architecture

[Plain-language architecture direction]

### Architecture Options

| Option | Why choose it | Why not choose it now |
| ------ | ------------- | --------------------- |
| [Option 1] | [Benefit] | [Trade-off] |
| [Option 2] | [Benefit] | [Trade-off] |

## Key Decisions and Why

- [Decision]: [Rationale]
- [Decision]: [Rationale]

## What Can Change Before Specification

- Scope changes the user may request
- Architecture changes the user may request
- Options that can be revisited before writing spec.md

## Open Questions

- [ ] [Question needing user input]
- [ ] [Another question]

## User Feedback and Overrides

- Pending user review

## Approval

- Status: pending_review
- Next action: user approves or requests changes before `#2_gofer_specify`
`````

---

## Step 6: Review, Discuss, and Gate Specification

After saving `research.md` and `proposal-review.md`:

1. **Present summary** to user:
   - What was found
   - Business scenarios considered
   - Recommended business scenario
   - Recommended architecture direction
   - Options and trade-offs
   - Any open questions needing input

2. **Ask the user to choose one path**:
   - Approve and continue to specification
   - Revise the business scenario
   - Revise the architecture recommendation
   - Explore an alternative option
   - Stop after research

3. **Run architecture questions one-by-one (MANDATORY when architecture options
   exist)**:
   - Ask exactly ONE architecture question at a time using AskUserQuestion
   - After each answer, ask whether the user wants to discuss that question
     before locking the answer
   - If the user asks clarifying questions, answer them first, then re-ask the
     same question for a final decision
   - Record the final answer in `proposal-review.md` before moving to the next
     question
   - Never bundle multiple architecture decisions into a single prompt

   Suggested order:
   1. Confirm preferred architecture option
   2. Confirm the key trade-off priority (speed, flexibility, reliability, cost)
   3. Confirm non-negotiable constraints/integration boundaries

4. **If the user approves**:
   - Update `proposal-review.md` with `status: approved`
   - Record `approvedBy`, `approvedAt`, and any selected option or override
   - Immediately invoke `#2_gofer_specify`

5. **If the user requests changes**:
   - Update `proposal-review.md` with the feedback in
     `User Feedback and Overrides`
   - Set `status: needs_revision` if the recommendation must change
   - Revise the recommendation and stop until the user approves

6. **Signal completion**:

```

✓ Research complete: {FEATURE_DIR}/research.md
✓ Proposal review ready: {FEATURE_DIR}/proposal-review.md

Key findings:

- [Finding 1]
- [Finding 2]

```


---

## LLM Council Integration (Optional)

When council mode is enabled in `.specify/memory/council-config.yaml` for
`research_codebase` stage:

1. Each parallel agent queries ALL configured LLM providers
2. Different LLMs may find different patterns and connections
3. Chairman synthesizes diverse findings for comprehensive research
4. Usage logged to `.specify/logs/council-usage.jsonl`

---

## Step 6.5: Brownfield/Legacy Analysis (For Existing Codebases)

When working in an existing codebase, add this section to research.md:

```markdown
## Brownfield Analysis

### Constraints & Limitations

| Constraint Type   | Description                               | Impact on Implementation       |
| ----------------- | ----------------------------------------- | ------------------------------ |
| Framework         | [e.g., React 17 - no concurrent features] | [How this limits our approach] |
| Database          | [e.g., PostgreSQL 12, existing schema]    | [Schema constraints]           |
| API Compatibility | [e.g., Must maintain v1 endpoints]        | [Backward compatibility needs] |
| Performance       | [e.g., Response time < 200ms]             | [Optimization requirements]    |

### Technical Debt to Avoid

The following patterns are deprecated or problematic - do NOT use:

| Pattern       | Found In          | Why Avoid | Use Instead          |
| ------------- | ----------------- | --------- | -------------------- |
| [Old pattern] | `path/to/file.ts` | [Reason]  | [Preferred approach] |

### Areas Requiring Extra Caution

- **[Area 1]**: [Why it's fragile and what to watch for]
- **[Area 2]**: [Known issues or gotchas]

### Integration Requirements

| Existing Service | Integration Method | Notes                          |
| ---------------- | ------------------ | ------------------------------ |
| [Service 1]      | [API/Import/Event] | [Authentication, format, etc.] |

### Downstream Dependencies

Code that depends on areas we're modifying:

- `path/to/dependent.ts:45` - [What it depends on]
- `path/to/consumer.ts:123` - [What it expects]
```

### Brownfield Checklist

Before modifying existing code:

- [ ] Understand current behavior (read and trace code flow)
- [ ] Document what must NOT change (protected boundaries)
- [ ] Identify downstream dependencies
- [ ] Add characterization tests if modifying complex logic
- [ ] Plan rollback strategy for risky changes

---

## Step 6.5: Journey Variant Generation (Optional)

**If a base journey exists** at
`.specify/specs/{feature}/journeys/base-journey.md`:

Generate industry variants to discover innovative approaches from other domains.

### Generate Variant Count

Pick a random number between 10-50:

```bash
VARIANT_COUNT=$((RANDOM % 41 + 10))
echo "Generating $VARIANT_COUNT industry variants"
```

### Load Industry Templates

Read `.specify/templates/journey/industry-variants.yaml` for industry-specific
patterns.

### Generate Variants

For each variant, create a file at:
`.specify/specs/{feature}/journeys/variants/{industry}-{number}.md`

Example: `healthcare-1.md`, `retail-2.md`, `finance-1.md`

**Distribute proportionally across 10 industries:**

- retail, healthcare, finance, education, hospitality
- logistics, manufacturing, legal, real_estate, entertainment

**Each variant should include:**

````markdown
---
id: {feature}-{industry}-{number}
baseJourneyId: {feature}-journey
industry: {industry}
variantNumber: {number}
created: {ISO-timestamp}
---

# Journey Variant: {Industry} #{number}

## Base Journey Reference

Based on: [base-journey.md](../base-journey.md)

## Industry Context

{Description of how this industry typically handles similar journeys}

## Adaptations

{How the base journey is adapted for this industry}

1. **Step N adapted**: {How step N changes in this industry}
2. **Actor change**: {Different actors in this industry context}

## Innovation Insights

Key innovations from {industry} that could apply to your feature:

1. **{Innovation 1}**: {Description and how it could be applied}
2. **{Innovation 2}**: {Description and how it could be applied}

## Modified Diagram

```mermaid
sequenceDiagram
    {Industry-specific sequence diagram}
```
````

## Potential Application

How these insights could enhance your feature:

- {Specific suggestion 1}
- {Specific suggestion 2}

````

### Document Innovation Summary

Add an "Innovation Insights" section to `research.md`:

```markdown
## Innovation Insights (from Industry Variants)

Generated {N} journey variants across 10 industries.

### Top Innovations to Consider

| Industry | Innovation | Application Potential |
|----------|------------|----------------------|
| Healthcare | AI symptom checker | Could add AI-powered input validation |
| Finance | Real-time fraud detection | Could add anomaly detection |
| Retail | Personalized recommendations | Could add user-specific suggestions |

### Variant Summary

| Industry | Count | Key Patterns |
|----------|-------|--------------|
| Retail | 5 | Cart recovery, recommendations |
| Healthcare | 4 | Patient portal, telehealth |
| ... | ... | ... |
````

### Skip Conditions

Skip variant generation if:

1. No base journey exists (user skipped journey mapping)
2. Feature is purely technical (no user-facing journey)
3. Context window is at Warning level (>50%)

---

## Step 7: Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 1_research --complete --tokens [N] --compactions [N]
```

This tracks:

- Stage duration
- Token usage
- Compaction events
- Quality metrics snapshot

Logs to: `.specify/logs/pipeline.jsonl`

---

## Important Notes

- **All output goes to `.specify/specs/{feature}/`** - not thoughts/shared/
- **Run agents in parallel** for efficiency
- **Include specific file paths and line numbers** for all references
- **Structured Problem Statement + Persona + Value Proposition are required** in
  `research.md`
- **Research must remain usable by novices without external docs**
- **Research should inform the proposal review and specification** - focus on
  what helps users discuss the business scenario and architecture before
  `spec.md` is written
- **Maximum 5 open questions** - make informed decisions for the rest
- **Do not continue to specification until `proposal-review.md` is approved**
- **Log stage completion** for observability tracking

---

## Optional Helpers: Vocabulary Extraction and Zoom-Out

If the operator explicitly requests the `vocabulary` selector after
`research.md` exists, run `gofer:vocabulary` inline and write
`.specify/specs/{feature}/glossary.md` using the same artifact contract as the
standalone helper.

If the operator explicitly requests the `zoom-out` selector after `research.md`
exists, run `gofer:zoom-out` inline and write
`.specify/specs/{feature}/zoom-out-report.md` using the same artifact contract
as the standalone helper.

If `research.md` is missing, continue the stage normally and report that the
helper was not run.

These selectors are optional and do not change stage progress, routing, or
pipeline state.


## Pipeline Continuation

This completes the 1_gofer_research stage. To continue the Gofer pipeline:

**Next Command:** `#2_gofer_specify`

The next stage will read the artifacts from this stage and continue the workflow automatically.

**Note:** Copilot Chat supports context preservation. Your conversation history will be maintained as you progress through pipeline stages.
