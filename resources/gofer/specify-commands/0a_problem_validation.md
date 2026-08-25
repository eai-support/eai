---
name: 0a_problem_validation
description: "Validate the business problem using 5 Whys root-cause analysis and stakeholder mapping."
title: "Problem Validation"
category: pipeline
surfaces:
  - claude
  - claude-mirror
  - copilot
  - vscode
  - codex
  - gemini
  - github-prompts
  - agents-skills
  - system-skills
aliases: [gofer:validate-problem]
---
---
description:
  Validate business problem using 5 Whys analysis, stakeholder impact mapping,
  and market landscape research before any solution design
---

# Gofer Problem Validation

## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using
   the signals in `.specify/commands/0_gofer_start.md`.
2. If the request is EAI app delivery or ambiguous, continue directly into the
   EAI app delivery path. Do not ask for confirmation just because app delivery
   is inferred.
3. If the request is clearly non-application work, confirm once before taking
   the non-app path:
   - **"This looks like non-app work, so I will skip EAI tenant/app setup and
     continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision in the feature discovery or
   context bundle, do not run `eai whoami`, `eai tenant select`, `eai init`, or
   `/gofer:eai-first-run`, and continue the appropriate non-app pipeline path.
5. If the user says it is app work, switch to EAI app delivery and run EAI app
   preflight.
6. For EAI app delivery, treat durable delivery as EAI Platform delivery by
   default, with Azure second and every other stack only by explicit exception.
7. For EAI app delivery, run `eai whoami` and confirm the EAI CLI is installed,
   the user is logged in, and an active tenant is visible.
8. If app-delivery readiness is missing, stop and run `/gofer:eai-first-run` or
   ask the user to approve login/setup before continuing.
9. For EAI app delivery, do not continue into research, specification, planning,
   tasks, implementation, or validation until
   `.specify/specs/{feature}/eai-preflight.md` records login, tenant, template,
   app-readiness, and next-action evidence.
10. Do not write tokens, secrets, private tenant IDs, or local `.env` values into
    Gofer artifacts; record only product-safe readiness status and evidence.

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

## Business-Friendly Progress Contract
<!-- gofer:business-progress:start -->

Default user-facing updates must be concise, business-level, and easy to scan.
Keep the technical work rigorous in artifacts, tests, logs, and code, but do
not lead with implementation jargon unless the user asks for it.

Use ASD-STE100 Simplified Technical English as the target writing standard for
all Gofer-authored chat, documents, commands, summaries, PR notes, error
guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of
ASD; do not bundle the protected ASD dictionary and do not claim ASD
certification.

1. Explain progress as what is being connected, changed, checked, or fixed and
   why it matters to the business outcome.
2. Use the running build map: create or update
   `.specify/specs/{feature}/build-map.md` from
   `.specify/templates/build-map-template.md` for application delivery, and
   refer to its plain-language areas in progress updates.
3. When there is a problem, translate it into business impact, current status,
   next action, and what input or approval is needed. Keep raw stack traces,
   command logs, IDs, and acronyms out of chat unless asked.
4. If the user asks for technical depth, provide it on request and point to the
   durable artifact that contains the evidence.
5. Prefer a compact update shape:
   - `Working on`: the build-map area or stakeholder outcome
   - `Why it matters`: user/business impact
   - `Status`: done, checking, fixing, blocked, or needs decision
6. Use one action per instruction.
7. Keep instructions to 20 words or fewer where possible.
8. Use active voice unless the actor is unknown or not important.
9. Use simple verb forms: simple present, simple past, simple future,
   infinitive, or imperative.
10. Define acronyms on first use and use approved project terms.
11. Avoid idioms, marketing adjectives, vague praise, and hedging.
12. Use vertical lists for complex information and one topic per paragraph.
13. For errors, state what happened, why it matters, what to do next, and the
    exact safe command when one exists.
14. Do not remove technical validation, security checks, EAI preflights, tests,
   or loop evidence. This contract changes presentation, not engineering
   standards.
15. Before each user-facing reply, check that it leads with the business effect,
    uses concise simple language, and includes only useful technical detail.
16. If any check fails, rewrite the reply before sending it.
<!-- gofer:business-progress:end -->

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. The runner must stop any process on the selected port before it restarts the app.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
<!-- gofer:app-preview-runner:end -->

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
Populate the **Drift Controls** table with an owner, expiry/revalidation date,
trigger, and reopen stage for every assumption that could invalidate the plan
later.

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

## Local Settings Cleanup Contract
<!-- gofer:local-settings-cleanup:start -->

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - `node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: `node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
   - Windows: `node %USERPROFILE%\plugins\eai-gofer\.specify\scripts\node\gofer-local-settings-cleanup.mjs --workspace . --apply --json`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public `eai` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.
<!-- gofer:local-settings-cleanup:end -->