---
name: 7a_stakeholder_comms
description: "Generate stakeholder-facing communications: release notes, demo scripts, and change briefs."
title: "Stakeholder Communications"
category: utility
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
aliases: [gofer:comms]
---
---
description:
  Generate stakeholder communications package including release notes, demo
  script, change management brief, and success metrics
---

# Gofer Stakeholder Communications

## Continuation And Stop Contract
<!-- gofer:continuation:start -->

1. Preserve the requested scope and mode, including read-only, plan-only, research-only and MVP work. Keep the full applicable pipeline, stage functions, artifacts, reviews and validation; do not expand an MVP into an unapproved release.
2. After a stage's required evidence is complete, read and follow the next internal file in .specify/commands/ in the same conversation. Do not require a numbered command or a host-specific skill dispatcher. Optional helpers remain optional; maintenance and control commands do not start delivery work.
3. After explicit business-specification approval, continue routine planning, tasks, implementation and validation within that approved scope. Record the approval source and scope; missing or ambiguous approval is not approval. A proposal or generated status is not user consent.
4. Preserve any explicit plan/task approval requirement unless it is already satisfied by recorded user approval covering that work. Rejected, revoked, changed or unclear approval requires a pause. Never invent approvedBy, approvedAt or a new approval event when reusing an existing approval.
5. Pause for material scope, security, cost, deployment, destructive or protected files/boundary changes and any outstanding user gate. Business approval does not authorize publishing, spending, external changes or bypassing host permissions. Complete safe authorized work without bypassing the blocked gate.
6. A tool proposal is not execution. If host consent is required, wait for it. After the tool result or approved proposal returns, inspect the result and resume the next authorized action within approved scope; do not end with only a plan or a proposed tool call. A denied tool or unavailable capability must not be bypassed through another host or CLI.
7. Use the current agent's available native tools. Optional Gofer/MCP tools are conveniences, not prerequisites. If the current agent lacks a required capability, report that limitation and the safe next action; do not pretend a handoff button transfers control automatically.
8. Stop after research only when research-only work was requested, the user paused, or a real gate blocks progress. Otherwise continue to specification. At validation, report completion only when the requested scope's required evidence passes; failures remain unfinished work.
9. Respect budget, context and retry limits from the existing loop contract. Repair safe within-scope failures only within those limits. Preserve a checkpoint before an orderly context stop; resume by reading its recorded stage and rechecking scope, approvals and evidence. Never claim an abrupt host termination was handled.
10. Report concise Progress during work. At every controlled stop, report Progress, Stop reason and Next action, including the exact missing input or approval and unfinished work. Reasons are requested scope complete, user pause, approval required, material change, missing capability/access, validation blocked, or budget/context/retry limit. Stage completion alone is not pipeline completion.

**Blocker Mediation**

- Before repeating a failed action or asking for missing input, read .specify/references/blocker-mediation.md and inspect the private blocker register with gofer-blocker-control.mjs. Reuse the same state directory and goal, subject and condition keys across stages, restarts and surfaces. Different wording, models or tools do not create a new blocker.
- Classify the cause first. Missing user decisions, access, external dependencies and unavailable capabilities require a recorded wait. Reserve an ask event before asking; ask once, explain the business impact and required change, then stop affected work. An unanswered question is not new evidence. Do not poll or rephrase it to keep running.
- Technical ask events require a fresh verification file under .specify/references/priority-outcome-protection.md: actual diagnosis, self-cause check and why no authorized repair is available. Business choices need no failed command. For feature tasks, use gofer-priority-check.mjs and the saved direction before switching work; this does not start delivery during maintenance or conversation.
- For AI-solvable or unknown causes, reserve each attempt before execution. Allow one investigation and one different recovery within existing tighter budgets. Record its result even when interrupted or unsuccessful. An unfinished reservation must not launch again. Do not reset the register, change keys or switch surfaces to obtain more attempts.
- Resume only after a real user answer or changed external evidence has been recorded and checked. The helper allows one evidence-backed resumption; exhausted limits need human review. Never invent approval or evidence. Successful model output and a running server do not resolve a blocker without the relevant check.
- Save the blocker, unfinished tasks and next action before stopping. Continue only approved tasks that do not depend on it. Keep the original goal; update specs, plans, tasks and validation for accepted direction changes, and reopen stale checks. Do not quietly drop requirements to make progress.
- Use node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <private-state-directory> --event <private-event.json> before controlled actions; inspect with --state-dir alone, or add --task T001 for an independent task. A denied action, invalid record or missing helper means stop and explain the limitation, not bypass it. Use the installed plugin script path if no repo scaffold exists. Conversation-only work uses a private session state directory and does not require app setup or feature files.
- Strict loop validation checks every recorded feature blocker. Shared instructions guide native chats; this helper cannot intercept calls that a host sends directly. Do not claim native enforcement from package tests alone.
<!-- gofer:continuation:end -->

## MVP Capability-Based Validation

Use `.specify/references/mvp-capability-validation.md` as the source of
truth. Validate the work that the active feature specification requires now.
Do not apply later delivery requirements to an early MVP.

1. Create `.specify/specs/{feature}/` before app or operator-tool source work.
2. Keep `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and the validation scope aligned.
3. Mark each relevant capability as `not_applicable`, `planned`, `implemented`, `verified`, or `blocked`.
4. Require evidence only for an implemented capability or a capability required by the current delivery decision.
5. Treat `run.sh`, `run.bat`, and `run.ps1` as launch evidence only. They do not prove authentication, sessions, EAI access, or deployment readiness.
6. For a user-facing change, store the local HTTP check, screenshot, and review outcome in the feature validation report.
7. If browser validation is blocked, mark that user journey `unverified`. Do not call it complete.
8. If the user changes scope, update the feature artifacts before continuing. Explain what changed, what remains valid, and what now needs evidence.
9. Use truthful completion language. For example: `The server runs. Authentication is not in the current MVP scope.`
10. When the feature claims a release or deployed outcome, create `release-capability-ledger.md` from `.specify/templates/release-capability-ledger-template.md`.
11. Do not report a release complete or score 100% when a required capability is missing from traceability, remains on an open PR, is absent from the release branch, or lacks required deployed evidence.

## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using the application signals in `.specify/commands/0_gofer_start.md`.
2. Create `.specify/specs/{feature}/` and record the active delivery scope before app or operator-tool source work.
3. If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision and mark app-only capabilities `not_applicable`. Do not run `eai whoami`, `eai tenant select`, `eai init`, or `/gofer:eai-first-run`.
5. For local MVP app work, validate the implemented user journey, repo runner, and preview evidence. Do not require EAI setup, authentication, or deployment when the active specification does not require them.
6. When the feature uses EAI Platform services, requires a tenant, or prepares deployment, run `eai whoami` and record the EAI readiness evidence in `eai-preflight.md`.
7. When the feature creates, changes, or validates an EAI Platform app integration, run `node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json`. A missing checker or status other than `ready` blocks that EAI capability. It does not block unrelated local MVP work.
8. When authentication is implemented or required, validate provider, callback, sign-in, session, first protected API call, and safe denied access.
9. When deployment is requested or claimed, require the relevant EAI template, security, configuration, and deployment evidence before completion.
10. For durable app delivery, use EAI Platform first, Azure second, and every other stack only by explicit exception.
11. If the user changes scope, update `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and validation scope before continuing. Explain the business effect and evidence change.
12. Do not accept copied marker files, partial scaffolds, or custom templates as readiness evidence for an EAI capability.
13. Do not write tokens, secrets, private tenant IDs, or local `.env` values into Gofer artifacts; record only product-safe readiness status and evidence.

**Authentication Access Decision**

When adding or changing authentication, read `.specify/references/platform/eai-auth-access.md`. Ask: **"Who should be able to use this app: only members of its EAI workspace (recommended), or any authenticated EAI user?"** Default to `workspace-only`. Wait for the answer before changing auth code. An unanswered question must not widen access. Preserve stricter existing rules. Record the answer in the feature spec; do not repeat a confirmed question unless its scope changes.

Confirm the sign-in method separately: EAI sign-in or client SSO through EAI. Verify platform support and CLI syntax; do not invent SSO commands. Enforce trusted server-side workspace membership and app permissions. A session, CIAM directory ID, or email domain alone is not workspace access. Platform-wide sign-in never grants access to another workspace's data. Test allowed and denied users, revoked membership, unavailable membership checks, and cross-tenant requests. These checks apply only when authentication is implemented or required, not to non-app work or an auth-free local MVP.

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Google Antigravity (Gemini models): Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
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
**Business Updates And Goal Checks**

Use `.specify/references/business-updates-and-goal-checks.md`. Before each reply, explain the result, business effect, and next action in plain language. For progress, use two or three short sentences. Run `node .specify/scripts/node/gofer-response-check.mjs --input <private-draft-file>` before sending a drafted progress update; rewrite failed drafts. Use `--kind answer` for answers and `--technical` only when technical detail was requested. Do not repeat unchanged progress. This helper cannot intercept messages that the host sends directly.

Before each work batch, read the current goal, specification, tasks, and latest findings. After new knowledge or an approved change, update affected feature documents and explain the effect. Never weaken acceptance criteria to match failing code or invent user approval. Mark a task complete only after its linked checks pass; reopen affected tasks when evidence is stale. For app and non-app features with a spec and tasks, enable `requireDeliveryCheckpoint` in `loop-contract.json` and run `node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir>` before advancing or claiming completion. Follow the reference to capture a reviewed checkpoint, not merely to clear a failure. Keep existing MVP exemptions, reviews, loops, and release gates. Conversation-only requests need no feature files.

**Priority And Outcome Protection**

Follow `.specify/references/priority-outcome-protection.md`. Before implementing a task, record the latest material user direction in decisions.md and maintain priority-plan.json with ordered tasks, dependencies, allowedEditScope and the current outcome. Enable requirePriorityPlan for new feature contracts. Run `node .specify/scripts/node/gofer-priority-check.mjs --feature-dir <feature-dir> --task T001` before the action, and include --workspace <repo-root> plus --changed-file for each proposed or actual changed repo-relative path. Follow its nextTask; only recorded prerequisites and approved parallel work may precede the current priority. Do not switch to unrelated work when blocked. On resume, state the agreed outcome and next task in plain language after reading the last recorded direction. Keep routine conversation free of feature paperwork.

Before technical escalation, attach fresh diagnosis through the blocker helper's ask event verification field. Check the exact command, route, environment, own mistake and existing authority. Do not invent a tenant, ask for login without checking it, require an unsafe alternative, or equate administrator access with permission. Business decisions need no failing command. At completion, run the priority checker with --finish; a missing or stale outcome receipt means unverified, regardless of test scores. Use --completion for the final gofer-closed-loop-audit.mjs run; a routine drift audit alone does not prove completion. Preserve detailed test results, early local MVP scope, non-app work, independent approved tasks and all release/security checks.

<!-- gofer:business-progress:end -->

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. Restart only this app. Before stopping a process, verify its exact checkout, process ID, start time and command, then recheck immediately before stopping it. Never stop another app, an unknown process, or every process on a port. If ownership is uncertain, leave it running and ask the user. Inspect older runners before use; do not run one that kills by port alone.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
9. Check the exact preview page and the current implemented user journey after each change. A running process, open browser, screenshot alone, error page or dry run is not proof that it works. Say ready to view only after those checks pass. Otherwise explain what is unchecked or failing; do not claim readiness. Record fresh browser and test evidence. Local MVP checks cover only implemented behaviour; do not add future auth or deployment gates. Keep showing clearly labelled drafts without adding approval stops.
<!-- gofer:app-preview-runner:end -->

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `validation-report.md` — Feature validated (PASS) from /6_gofer_validate
- `problem-brief.md` — Original business problem (from /0a_problem_validation)
- `spec.md` — Feature specification (from /2_gofer_specify)
- `spec-summary.md` — Executive summary (from /2_gofer_specify)
- `assumptions.md` — Tracked assumptions
- `working-backwards-prfaq.md` — Running product release PR/FAQ updated by stages 0-6
- `business-owner-summary.md` — Business Owner summary updated by stages 1, 2, 5, and 6
- `cto-architecture-summary.md` — CTO/Architecture summary updated by stages 3, 5, and 6
- `ciso-security-summary.md` — CISO/Risk summary updated by /6_gofer_validate
- `stakeholder-review-index.md` — Current stakeholder review status and approve/revise/defer asks

If `validation-report.md` doesn't exist or shows FAIL, do NOT generate comms.
Instead, inform the user that validation must pass first.

---

## Outline

1. Context health check
2. Load all feature context
3. Spawn comms-writer agent
4. Spawn business-metrics-analyzer agent
5. Generate stakeholder communications package
6. Generate business metrics dashboard
7. Final assumption review
8. Completion summary

---

## Step 0: Context Health Check

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Use sub-agents heavily
- If **> 70%**: Run `/7_gofer_save` first

---

## Step 1: Load Feature Context

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --require-tasks
   ```

   Parse JSON for FEATURE_DIR

2. **Load all business artifacts**:
   - `working-backwards-prfaq.md` — Running product release PR/FAQ and internal FAQ
   - `stakeholder-review-index.md` — Review status and required approvals
   - `business-owner-summary.md` — Business scenario, process, value, assumptions
   - `cto-architecture-summary.md` — Architecture, EAI Platform/Azure fit, auth/tenant/data/contracts
   - `ciso-security-summary.md` — Security posture, controls, residual risk, validation evidence
   - `problem-brief.md` — Original problem and business case
   - `discovery.md` — Business discovery context
   - `spec-summary.md` — Executive summary
   - `assumptions.md` — Assumption register
   - `validation-report.md` — Quality verification results
   - `tasks.md` — Implementation status

3. **Verify validation passed**:
   - Check `validation-report.md` for `status: PASS`
   - If FAIL: "Validation must pass before generating communications. Current
     score: [N]/110. Run /6_gofer_validate first."

---

## Step 2: Spawn Parallel Agents

Launch both agents **in parallel**:

### Agent 1: Communications Writer

```
Task: subagent_type="comms-writer", model="haiku"
Prompt: "Generate stakeholder communications for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read and use:
- working-backwards-prfaq.md for the product-release story and FAQ
- stakeholder-review-index.md for review status and approval asks
- business-owner-summary.md for business scenario, process, value, and assumptions
- cto-architecture-summary.md for architecture, EAI Platform/Azure fit, auth, tenancy, data, and contracts
- ciso-security-summary.md for controls, residual risk, security evidence, and launch gates
- problem-brief.md for original problem context
- discovery.md for business discovery findings
- spec.md for what was specified
- spec-summary.md for business summary
- validation-report.md for quality status
- assumptions.md for tracked assumptions

Generate:
1. Executive summary (3 sentences)
2. Non-technical release notes
3. 5-minute demo script with talking points
4. Change management brief with rollout plan
5. Success metrics with baseline and targets
6. Communication timeline

Return structured report (<2000 tokens)."
```

### Agent 2: Business Metrics Analyzer

```
Task: subagent_type="business-metrics-analyzer", model="haiku"
Prompt: "Analyze pipeline metrics for business reporting.

Feature directory: {FEATURE_DIR}
Logs directory: .specify/logs/

Read pipeline logs and feature artifacts to produce:
1. Feature velocity (delivery time for this feature)
2. Stage duration breakdown
3. Quality metrics (validation score, iterations)
4. Cost analysis (token usage)
5. Portfolio status (active top-level features in .specify/specs/, excluding `_archived/`)
6. Scope health indicators

Return structured report (<2000 tokens)."
```

**Run both agents in parallel.**

---

## Step 3: Generate Stakeholder Communications

Write to `{FEATURE_DIR}/stakeholder-comms.md` using the template at
`.specify/templates/stakeholder-comms-template.md`.

Populate with comms-writer agent findings and the running PR/FAQ/persona
summaries. Ensure:

- **All language is non-technical** — no jargon, no acronyms without explanation
- **Impact is quantified** — use numbers from problem-brief.md
- **Demo script is actionable** — someone could run the demo from this document
- **Change management is realistic** — phased rollout with success criteria
- **Metrics are tied to problem** — connect back to original business case
- **The PR/FAQ is preserved** — include a "Product Release PR/FAQ" section or
  direct links to `working-backwards-prfaq.md` and its stage snapshots
- **Persona summaries are visible** — include links and decision status for
  `business-owner-summary.md`, `cto-architecture-summary.md`, and
  `ciso-security-summary.md`

---

## Step 4: Generate Business Metrics Dashboard

Write to `{FEATURE_DIR}/business-metrics.md` using the template at
`.specify/templates/business-metrics-template.md`.

Populate with business-metrics-analyzer agent findings.

---

## Step 5: Final Assumption Review

Spawn the assumption-tracker agent to do a final review:

```
Task: subagent_type="assumption-tracker", model="haiku"
Prompt: "Final assumption review for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read assumptions.md and cross-reference against:
- validation-report.md (did implementation reveal any disproven assumptions?)
- tasks.md (any tasks that changed because of assumption issues?)

Update assumption statuses based on implementation evidence.
Flag any assumptions that remain UNVALIDATED and could affect launch.

Return structured report (<2000 tokens)."
```

### Update Assumptions

Based on agent findings, update `{FEATURE_DIR}/assumptions.md`:

- Mark assumptions validated by implementation as `VALIDATED`
- Mark assumptions disproven during development as `DISPROVEN`
- Flag remaining `UNVALIDATED` assumptions with recommended verification actions

---

## Step 6: Generate Scope Creep Report (If problem-brief exists)

If `{FEATURE_DIR}/problem-brief.md` exists, run scope creep detection:

```
Task: subagent_type="scope-creep-detector", model="haiku"
Prompt: "Analyze scope creep for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Compare the final implementation (tasks.md, spec.md) against the original
problem brief (problem-brief.md). Calculate scope creep score.

Return structured report (<2000 tokens)."
```

If scope creep score > 25%, include a "Scope Evolution" section in the
stakeholder communications explaining what changed and why.

---

## Step 7: Completion Summary

```
════════════════════════════════════════════════════════════════
  STAKEHOLDER COMMUNICATIONS COMPLETE: [Feature Name]
════════════════════════════════════════════════════════════════

  Deliverables:
  - {FEATURE_DIR}/working-backwards-prfaq.md
  - {FEATURE_DIR}/business-owner-summary.md
  - {FEATURE_DIR}/cto-architecture-summary.md
  - {FEATURE_DIR}/ciso-security-summary.md
  - {FEATURE_DIR}/stakeholder-review-index.md
  - {FEATURE_DIR}/stakeholder-comms.md
  - {FEATURE_DIR}/business-metrics.md
  - {FEATURE_DIR}/assumptions.md (updated)

  Package includes:
  - Product Release PR/FAQ
  - Executive Summary
  - Business Owner Summary
  - CTO Architecture Summary
  - CISO Security Summary
  - Release Notes (non-technical)
  - Demo Script (5-minute walkthrough)
  - Change Management Brief
  - Success Metrics & KPIs
  - Communication Timeline
  - Business Metrics Dashboard
  - Assumption Status Report

  Scope Creep Score: [N]% ([Healthy/Warning/Alert])
  Assumptions: [N] validated, [N] unvalidated, [N] disproven

════════════════════════════════════════════════════════════════
  FEATURE PIPELINE COMPLETE!

  Full Pipeline Summary:
  0a. /0a_problem_validation  ✓ (Problem validated)
  1.  /1_gofer_research        ✓ (Codebase + market research)
  2.  /2_gofer_specify         ✓ (Spec + business summary)
  3.  /3_gofer_plan            ✓ (Technical architecture)
  4.  /4_gofer_tasks           ✓ (Task breakdown)
  5.  /5_gofer_implement       ✓ (Implementation)
  6.  /6_gofer_validate        ✓ (Quality: [score]/110)
  7a. /7a_stakeholder_comms    ✓ (Communications package)

  The feature is ready for stakeholder review and deployment.
════════════════════════════════════════════════════════════════
```

---

## Marp Presentation Deck (Opt-In; EnterpriseAI Recommended)

Marp deck generation is opt-in for the standard Gofer workflow and is
recommended only for `workflowProfile=enterpriseai`, where stakeholders usually
need a simple walkthrough. When enabled, generate the general stakeholder deck
and, for larger changes, the persona deck pack. Skip decks only for small
docs-only or purely mechanical changes where a short Markdown summary is clearer.
Release Notes and the Demo Script (5-minute walkthrough) remain core
deliverables as `release-notes.md` and `demo-script.md`.

When a deck is generated, write `{FEATURE_DIR}/presentation.marp.md`. The file
MUST use Marp frontmatter and the canonical stakeholder slide deck structure:

```markdown
---
marp: true
theme: default
paginate: true
---

# Problem Statement

{{problem-statement}}

---

# EnterpriseAI Solution Overview

{{enterpriseai-fit}}

---

# Architecture Diagram Reference

See `plan.md` → architecture section.

---

# Demo Script Summary

See Release Notes and the Demo Script (5-minute walkthrough) above.

---

# Success Metrics

{{success-metrics}}
```

Every section title above (`Problem Statement`,
`EnterpriseAI Solution Overview`, `Architecture Diagram Reference`,
`Demo Script Summary`, `Success Metrics`) is mandatory in both the generated
`presentation.marp.md` and the corresponding
`.specify/templates/stakeholder-comms-template.md`.

### Persona Marp Deck Pack

Generate these additional decks under `{FEATURE_DIR}/presentations/`:

| Deck | Decision-Rights Audience | Required Focus |
| ---- | ------------------------ | -------------- |
| `executive.marp.md` | Executive committee | Strategic value, funding gate, risk appetite |
| `business.marp.md` | Business owner | User journey, operational value, adoption |
| `internal-delivery.marp.md` | Delivery lead | Dependency plan, red/green loop, delivery risks |
| `enterprise-architecture.marp.md` | Enterprise architecture | Platform fit, context bundle, contract pack, reuse decisions |
| `ciso.marp.md` | CISO | Identity, tenant boundary, controls, residual risk |
| `data-architecture.marp.md` | Data architecture | Object types, lineage, quality, governance |
| `cio.marp.md` | CIO | Platform strategy, operating model, reuse roadmap |
| `cfo.marp.md` | CFO | Investment case, benefit tracking, cost risk |
| `coo.marp.md` | COO | Process change, rollout readiness, support model |
| `risk-compliance.marp.md` | Risk/compliance | Obligations, evidence, exceptions, audit trail |

Every persona deck MUST include:

- Executive Summary.
- Decision Focus.
- Problem Statement.
- EnterpriseAI Solution Overview.
- AI-Augmented 4-Step Journey for app delivery, or the non-app classification
  rationale when no app is being built.
- Architecture Diagram Reference with a Mermaid diagram.
- Context Bundle.
- Contract Pack.
- Reuse-Before-Create.
- Audit History.
- Red/Green Validation Loop.
- Demo Script Summary.
- Success Metrics.
- Persona-specific value/risk table and controls table.

---

## Step 7.5: Assemble Stakeholder Visual Pack

After all comms artifacts are generated, compose the stakeholder visual pack
from `{FEATURE_DIR}/visuals/` into a single `stakeholder-pack.md` file. This
runs in deterministic order (impact-canvas → C4 → value-stream → capability
heatmap → bounded-context → ERD → risk-heatmap → ROI projection) and skips
artifacts that were not generated (FR-028, NFR-011, T138).

```bash
node .specify/scripts/node/lib/assemble-stakeholder-pack.mjs $FEATURE_DIR
```

The assembler writes `{FEATURE_DIR}/stakeholder-pack.md` and prints which
artifacts were included vs. missing so the operator can re-run the relevant
visual generators if needed.

Before presenting the pack, review the included visuals against the visual
explanation quality gate used by `/6_gofer_validate`:

- Each visual answers one stakeholder question and is simple enough to read
  without external docs.
- Each visual has a plain-language preamble, audience, source inputs, and
  requirement/plan/code/test/EAI evidence links.
- Each Mermaid/D2/Structurizr-style diagram renders or includes a markdown/text
  fallback; each UI picture has screenshot, Storybook/component, Playwright, or
  equivalent render proof.
- `presentation.marp.md` should exist for substantive stakeholder-facing
  changes unless the change is small, docs-only, or better explained by a short
  Markdown summary. If skipped, record the reason in `stakeholder-comms.md`.
- Every human-facing document starts with a three-to-five-bullet executive
  summary that explains the decision, value, risk, evidence, and next ask in
  simple language.
- Any stale, crowded, private-data-bearing, or untraceable visual is called out
  in `stakeholder-review-index.md` as `revise visuals <artifact>`.

---

## Step 8: Observability Logging

```bash
.specify/scripts/bash/log-stage.sh 7a_stakeholder_comms --complete --tokens [N] --compactions [N]
```

---

## Important Notes

- **Every output must be copy-pasteable** — consultants share these as-is
- **No technical jargon** — write for business executives
- **Connect to business case** — always reference problem-brief.md impact
  metrics
- **Be honest about limitations** — known issues build trust
- **Include timelines** — consultants need to plan around dates
- **Quantify everything** — numbers > adjectives
- **Demo script must work** — test it mentally before writing

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
