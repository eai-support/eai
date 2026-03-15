---
description: Deep codebase and technology research for feature implementation
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
5. Document technology decisions and constraints

**Output**: `.specify/specs/{feature}/research.md`

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

2. **Use discovery to guide agent prompts**:
   - Codebase Locator: Focus on areas related to the discovered problem
   - Codebase Analyzer: Analyze patterns relevant to target users
   - Pattern Finder: Find examples that deliver similar value

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

**Claude Code only**: Launch these specialized agents **in parallel** using the
Task tool. In Copilot Chat, perform this research inline by searching the
codebase directly using the available tools.

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

## Step 4: Synthesize Findings

Once all agents complete:

1. **Compile findings** from all sources
2. **Identify key integration points** in the codebase
3. **Document patterns to follow** from existing code
4. **Note constraints and considerations**

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

## Constraints & Considerations

- [Constraint 1]: [Impact on implementation]
- [Constraint 2]: ...

## Open Questions

- [ ] [Question needing user input]
- [ ] [Another question]

## Recommendations

1. [Key recommendation for implementation]
2. [Another recommendation]

```

---

## Step 6: Report and Continue

After saving research.md:

1. **Present summary** to user:
   - Key findings
   - Integration points identified
   - Any open questions needing input

2. **Signal completion**:
```

✓ Research complete: {FEATURE_DIR}/research.md

Key findings:

- [Finding 1]
- [Finding 2]

````

## Next Steps (Manual Chaining — Copilot Chat)

Research is complete. To continue the pipeline, run the next stage:

```
/2_gofer_specify
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

| Constraint Type | Description | Impact on Implementation |
|-----------------|-------------|--------------------------|
| Framework | [e.g., React 17 - no concurrent features] | [How this limits our approach] |
| Database | [e.g., PostgreSQL 12, existing schema] | [Schema constraints] |
| API Compatibility | [e.g., Must maintain v1 endpoints] | [Backward compatibility needs] |
| Performance | [e.g., Response time < 200ms] | [Optimization requirements] |

### Technical Debt to Avoid

The following patterns are deprecated or problematic - do NOT use:

| Pattern | Found In | Why Avoid | Use Instead |
|---------|----------|-----------|-------------|
| [Old pattern] | `path/to/file.ts` | [Reason] | [Preferred approach] |

### Areas Requiring Extra Caution

- **[Area 1]**: [Why it's fragile and what to watch for]
- **[Area 2]**: [Known issues or gotchas]

### Integration Requirements

| Existing Service | Integration Method | Notes |
|------------------|-------------------|-------|
| [Service 1] | [API/Import/Event] | [Authentication, format, etc.] |

### Downstream Dependencies

Code that depends on areas we're modifying:

- `path/to/dependent.ts:45` - [What it depends on]
- `path/to/consumer.ts:123` - [What it expects]
````

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
- **Research should inform the specification** - focus on what helps write a
  good spec
- **Maximum 5 open questions** - make informed decisions for the rest
- **Log stage completion** for observability tracking
