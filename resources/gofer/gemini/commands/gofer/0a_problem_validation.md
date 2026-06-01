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
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host gemini --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.

---
description:
  Validate business problem using 5 Whys analysis, stakeholder impact mapping,
  and market landscape research before any solution design
---

# Gofer Problem Validation

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

## Outline

This stage sits BEFORE `/1_gofer_research` in the pipeline. Your job is to:

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
Task: subagent_type="research-market-scanner", model="haiku"
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

## Step 8a: Always Emit Market and Business Analysis Artifacts (FR-035)

Regardless of the `competitiveAnalysisEnabled` constitutional setting, this
stage MUST emit BOTH baseline traceability artifacts so downstream stages and
audits can find them at deterministic paths:

- `{FEATURE_DIR}/market-analysis.md` — competitive landscape and build-vs-buy
  reasoning. When `competitiveAnalysisEnabled=false`, this file is still created
  and contains a clearly worded **disabled-state notice** explaining that
  competitive analysis was skipped per constitution and that the section is
  reserved for future enrichment.
- `{FEATURE_DIR}/business-analysis.md` — business case, ROI sketch,
  cost-of-doing-nothing summary, and stakeholder impact mapping. Emitted
  unconditionally; this is the primary record consumed by
  `/7a_stakeholder_comms` and the validation council.

When `competitiveAnalysisEnabled=false`, the market-analysis.md file includes
the following stub at the top so consumers can detect the disabled state
programmatically:

```markdown
> **Notice:** Competitive analysis is disabled in this project's constitution
> (`competitiveAnalysisEnabled: false`). This file is emitted as a baseline
> traceability artifact only and contains no competitor research. Re-enable in
> `.specify/memory/constitution.md` if you want full market analysis on the next
> pipeline run.
```

Both files participate in the same audit trail and are referenced from the
`7_gofer_save` checkpoint and the `7a_stakeholder_comms` package.

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
  - {FEATURE_DIR}/market-analysis.md
  - {FEATURE_DIR}/business-analysis.md

  Recommendation: [PROCEED/INVESTIGATE/RECONSIDER]

════════════════════════════════════════════════════════════════
```

If recommendation is PROCEED or user confirms they want to continue:

**AUTO-CHAIN (MANDATORY)**: You MUST immediately invoke the next pipeline stage
by calling the Skill tool with skill="/1_gofer_research". Do NOT ask the user
for confirmation. Do NOT output "Ready for next stage". Just invoke the skill
NOW.

If recommendation is RECONSIDER:

Present alternatives and let user decide whether to proceed or stop.

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
  /1_gofer_research
       ↓ AUTO
  /2_gofer_specify
       ↓ AUTO
  ... (rest of pipeline)
       ↓ AUTO
  /7a_stakeholder_comms
```
