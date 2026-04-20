---
name: 0a_problem_validation
description: >-
  Validate business problem using 5 Whys analysis, stakeholder impact mapping,
  and market landscape research before any solution design
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
  canonicalSource: .claude/commands/0a_problem_validation.md
  canonicalChecksum: a7dcf9393c34e13c5ec99c01a7f279e9e533130357166906e508d1a1907b0010
  metadataSource: scripts/generate-commands.ts
---


# Gofer Problem Validation

You are validating a business problem BEFORE any solution design begins. This is
a **pre-pipeline stage** that ensures the right problem is being solved and that
it's worth solving.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

This stage sits BEFORE `#1_gofer_research` in the pipeline. Your job is to:

1. Deconstruct the problem statement
2. Run 5 Whys root cause analysis
3. Map stakeholder impact
4. Assess business case (cost of doing nothing vs value of solving)
5. Check if software is even the right answer
6. Research the market for existing solutions
7. Track initial assumptions
8. Produce a validated Problem Brief

**Output**: `.specify/specs/{feature}/problem-brief.md`,
`.specify/specs/{feature}/assumptions.md`

---

## Step 0: Context Health Check

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Be concise with outputs
- If **> 70%**: Start new session with handoff summary

---

## Step 1: Get Problem Statement

If no problem description provided in $ARGUMENTS:

Use the AskUserQuestion tool:

**"What business problem are you trying to solve?"**

| Option | Description                                          |
| ------ | ---------------------------------------------------- |
| Custom | Describe the problem in your own words (Recommended) |

Encourage the user to describe the PROBLEM, not the SOLUTION. If they describe a
solution ("I need a dashboard"), probe deeper: "What problem would the dashboard
solve?"

---

## Step 2: Create Feature Directory

Once you have the problem statement:

1. **Generate a short name** (2-4 words) for the feature
2. Run `.specify/scripts/bash/create-new-feature.sh --json "$DESCRIPTION"` with
   `--short-name "your-short-name"` to create the feature directory
3. Parse JSON output for FEATURE_DIR and BRANCH_NAME

---

## Step 3: Problem Deconstruction

Parse the user's problem statement and extract:

- **Stated Problem**: What they said is wrong
- **Implied Solution**: What they think should be built (if any)
- **Context Clues**: Industry, scale, urgency
- **Emotional Signals**: Frustration points, pain intensity

Present back to the user:

**"Let me make sure I understand the problem correctly:"**

| Element          | My Understanding         |
| ---------------- | ------------------------ |
| Core Problem     | [extracted]              |
| Who's Affected   | [extracted]              |
| Current Impact   | [extracted or "unknown"] |
| Implied Solution | [extracted or "none"]    |

Use AskUserQuestion: "Is this correct? Would you like to adjust anything?"

---

## Step 4: Run 5 Whys Analysis

Spawn the business-problem-validator agent:

```
Task: subagent_type="business-problem-validator", model="sonnet"
Prompt: "Validate this business problem using 5 Whys analysis:

Problem: [USER'S PROBLEM STATEMENT]
Context: [ANY ADDITIONAL CONTEXT]

Perform:
1. 5 Whys root cause analysis
2. Stakeholder impact mapping
3. Business case assessment
4. Problem-solution fit check

Return structured report (<2000 tokens)."
```

---

## Step 5: Market Landscape Research

Spawn the market scanner agent **in parallel** with the problem validator:

```
Task: subagent_type="research-market-scanner", model="sonnet"
Prompt: "Research the market landscape for this business problem:

Problem: [USER'S PROBLEM STATEMENT]
Industry: [EXTRACTED FROM CONTEXT]

Find:
1. Commercial SaaS solutions that address this
2. Open-source alternatives
3. Industry standards or regulations
4. Build vs Buy analysis

Return structured report (<2000 tokens)."
```

**Run both agents in parallel.**

---

## Step 6: Synthesize Findings

Once both agents complete:

### 6.1 Present Root Cause

Use AskUserQuestion to confirm the root cause:

**"Based on my analysis, the root cause appears to be:"**

| Element        | Finding                                     |
| -------------- | ------------------------------------------- |
| Stated Problem | [What user said]                            |
| Root Cause     | [From 5 Whys]                               |
| Gap            | [How far stated problem is from root cause] |

| Option                                   | Description                  |
| ---------------------------------------- | ---------------------------- |
| A. Root cause is correct                 | Proceed with this root cause |
| B. Root cause needs adjustment           | Let me clarify further       |
| C. I want to solve the symptom, not root | Focus on the stated problem  |

### 6.2 Present Market Findings

Use AskUserQuestion to get build/buy decision:

**"I found these existing solutions in the market:"**

| Option           | Description                                              |
| ---------------- | -------------------------------------------------------- |
| A. Build custom  | No existing solution fits — we should build from scratch |
| B. Buy/subscribe | [Solution X] looks like a good fit — investigate further |
| C. Hybrid        | Use [Solution X] as foundation, customize on top         |
| D. Not sure      | I need more information to decide                        |

### 6.3 Present Business Case

Display the impact assessment:

```
╔══════════════════════════════════════════════════════╗
║  BUSINESS CASE SUMMARY                               ║
╠══════════════════════════════════════════════════════╣
║                                                       ║
║  Problem: [Root cause in plain English]               ║
║                                                       ║
║  Cost of Doing Nothing: [$/hours per year]            ║
║  Estimated Value of Solving: [$/hours per year]       ║
║  Payback Period: [weeks/months]                       ║
║                                                       ║
║  Software Needed? [Yes/No/Partial]                    ║
║  Recommendation: [PROCEED/INVESTIGATE/RECONSIDER]     ║
║                                                       ║
╚══════════════════════════════════════════════════════╝
```

---

## Step 7: Generate Problem Brief

Write to `{FEATURE_DIR}/problem-brief.md` using the template at
`.specify/templates/problem-brief-template.md`.

Populate with:

- User's confirmed root cause
- Stakeholder impact from validator agent
- Business case metrics
- Market landscape findings
- Build/buy decision
- All identified assumptions

---

## Step 8: Generate Initial Assumptions Register

Write to `{FEATURE_DIR}/assumptions.md` using the template at
`.specify/templates/assumptions-template.md`.

Extract assumptions from:

- Problem statement (business assumptions)
- Market research (competitive assumptions)
- Root cause analysis (causal assumptions)
- Stakeholder mapping (user behavior assumptions)

Mark ALL assumptions as `UNVALIDATED` at this stage.

---

## Step 9: Report and Continue

After saving artifacts:

```
════════════════════════════════════════════════════════════════
  PROBLEM VALIDATED: [Feature Name]
════════════════════════════════════════════════════════════════

  Root Cause: [One sentence]
  Business Case: [Cost of doing nothing] vs [Value of solving]
  Market: [Build/Buy/Hybrid decision]
  Assumptions: [N] tracked ([N] critical)

  Artifacts:
  - {FEATURE_DIR}/problem-brief.md
  - {FEATURE_DIR}/assumptions.md

  Recommendation: [PROCEED/INVESTIGATE/RECONSIDER]

════════════════════════════════════════════════════════════════
```

If recommendation is PROCEED or user confirms they want to continue:


---

## Step 10: Observability Logging

```bash
.specify/scripts/bash/log-stage.sh 0a_problem_validation --complete --tokens [N] --compactions [N]
```

---

## Important Notes

- **Write for business people** — no technical jargon in outputs
- **Challenge assumptions** — don't take the problem at face value
- **Quantify impact** — use numbers, not adjectives
- **Consider process solutions** — code is expensive, process is cheap
- **Keep it short** — max 15 minutes of user interaction
- **Don't propose solutions** — this stage is about the PROBLEM, not the answer
- **Track everything as assumptions** — they get validated later in the pipeline

---

## "Explain Like I'm a Consultant" Mode

All outputs from this stage are written in business language by default. This
stage sets the tone for the entire pipeline when `audience: business` is set.

Check `.specify/memory/constitution.md` for audience setting. If
`audience: business` is set, pass this context to all subsequent pipeline stages
so they include plain-English companion sections in their outputs.

---

## Quick Reference: Pipeline Position

```text
  /0a_problem_validation  ← YOU ARE HERE
       ↓ AUTO
  #1_gofer_research
       ↓ AUTO
  #2_gofer_specify
       ↓ AUTO
  ... (rest of pipeline)
       ↓ AUTO
  /7a_stakeholder_comms
```


## Pipeline Continuation

This completes the 0a_problem_validation stage. To continue the Gofer pipeline:

**Next Command:** `#1_gofer_research`

The next stage will read the artifacts from this stage and continue the workflow automatically.

**Note:** Copilot Chat supports context preservation. Your conversation history will be maintained as you progress through pipeline stages.
