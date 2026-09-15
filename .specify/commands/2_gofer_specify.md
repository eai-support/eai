---
name: 2_gofer_specify
description: "Generate a feature specification from research findings and any supporting review context."
title: "Gofer Specify"
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
aliases: [gofer:specify]
---
---
description: Create feature specification informed by codebase research
---

# Gofer Specify

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

## Delivery Lineage Contract

Before completing this stage, read `.specify/references/delivery-lineage.md`
and update `.specify/specs/{feature}/delivery-lineage.json` with the approved
requirements and their research evidence. Preserve the customer-only trust
plane and terminate EAI dependencies at published PublicAPI capability nodes.

## Execution Profile And Artifact Churn

Carry forward the `fast` / `standard` / `full` / `dynamic` profile chosen in
research. Keep labels generic: `docs-only`, `single-repo-code`, `cross-repo`,
`api-contract`, `auth-security`, `data-model`, `infra-config`,
`release-critical`, `broad-fanout`, `unknown-blast-radius`, `unknown`.

Also read `execution-profile.md` when present. Keep the same
`effectiveProfile` unless new evidence changes the risk labels; if that
happens, update the file and explain the new `profileFloor`,
`effectiveProfile`, and reason in `traceability.md`.

- **fast** specs should be short and scoped, with no new optional artifact set
  unless research found implementation risk.
- **standard** specs should include normal user stories, acceptance criteria,
  test expectations, and protected boundaries.
- **full** specs must explicitly capture contract, security, data, infra,
  rollout, and validation obligations with evidence references.
- **dynamic** specs must capture decomposition boundaries, shard ownership,
  unresolved blast-radius questions, reducer evidence expectations, and
  confirmation gates.

Do not rediscover context already summarized in `research.md` or
`proposal-review.md`; consume it, cite it, and only reopen files when a claim is
ambiguous.

## Prerequisites

This command expects:

- Feature directory already created at `.specify/specs/{feature}/`
- `research.md` completed from `/1_gofer_research`
- `goal-ledger.json` seeded from `/1_gofer_research`
- `loop-contract.json` seeded from `/1_gofer_research`
- `service-fit-matrix.md` when the feature is EAI app delivery
- `proposal-review.md` if research created supporting review context

If these don't exist, prompt user to run `/1_gofer_research` first.

---

## Spec Artifact Guarantee

This stage is the first point where the placeholder `spec.md` created by
feature bootstrap becomes a real feature specification. Before this command
finishes or auto-chains to `/3_gofer_plan`, verify that
`{FEATURE_DIR}/spec.md` exists, is non-empty, and no longer contains the raw
template placeholders such as `[FEATURE NAME]`, `[###-feature-name]`,
`[Describe this user journey]`, `System MUST [specific capability]`, or
`ACTION REQUIRED`. If the check fails, write or repair `spec.md` immediately and
do not continue to planning.

Downstream stages use repo scripts that fail on missing, empty, or still-template
specs. Treat that failure as a required return to `/2_gofer_specify`, not as a
script problem to bypass.

## EAI Platform Requirement Capture

For EAI app delivery, the specification must carry the platform decision into
testable requirements.

1. Read `service-fit-matrix.md` and
   `.specify/references/platform/eai-service-patterns.md`.
2. State which user journeys need authentication, tenant access, data storage,
   file handling, search, content understanding, workflows, goals, targets, and
   platform AI services.
3. Prefer EAI Platform services before Azure.
4. Use non-EAI platforms only as explicit exceptions.
5. Include acceptance criteria for login, tenant selection, storage behavior,
   workflow readiness, AI-service behavior, and error recovery when relevant.
6. Keep secrets, private tenant IDs, and `.env` values out of `spec.md`.

## Outline

1. Context health check
2. Validate any supporting proposal review context and load existing findings
3. Dispatch specification agents (sub-agents handle heavy generation)
4. Review agent output, handle clarifications
5. Optional multi-perspective review
6. Output: `.specify/specs/{feature}/spec.md`
7. Stakeholder PR/FAQ output: `working-backwards-prfaq.md`,
   `prfaq-history/02-specify.md`, `spec-summary.md`,
   `business-owner-summary.md`, and `stakeholder-review-index.md`
8. EnterpriseAI profile output: `.specify/specs/{feature}/contract-pack.md`

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
   - Note whether goal-ledger.json exists and which goals, metrics, delivery
     states, and re-loop triggers it records
   - Note whether loop-contract.json exists and which evaluation commands,
     success criteria, stop conditions, and escalation rules it records
   - If loop-contract.json is missing, initialize it with
     `node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 2_specify --init --json`

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

## Step 1.25: Optional Proposal Review Context

`proposal-review.md` is optional supporting context between research and specification.

- If `proposal-review.md` is missing: continue using `research.md` as the
  source of truth.
- If `proposal-review.md` exists: capture any business-scenario guidance,
  architecture direction, selected option, and user overrides it records.
- If `proposal-review.md` records a clear user-approved direction: treat that as
  authoritative. Otherwise, treat it as advisory context.

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

If proposal-review.md exists, also pass this mapping:

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
- {FEATURE_DIR}/goal-ledger.json — machine-readable goals, metrics, delivery states, and re-loop triggers
- {FEATURE_DIR}/loop-contract.json — bounded loop objective, evaluation commands, success criteria, stop conditions, and escalation rules
- {FEATURE_DIR}/proposal-review.md — Supporting business scenario, architecture direction, options, overrides (read if exists, skip if not)
- .specify/templates/spec-template.md — Template structure to follow
- {FEATURE_DIR}/discovery.md — Business discovery findings (read if exists, skip if not)
- {FEATURE_DIR}/journeys/base-journey.md — AI-augmented four-step application journey (read if exists, skip if not)
- {FEATURE_DIR}/ui-preview-brief.md — UI-first preview brief for app delivery (read if exists, skip if not)
- {FEATURE_DIR}/service-fit-matrix.md — approved or draft service-fit evidence (read if exists, skip if not)
- {FEATURE_DIR}/build-map.md — plain-language build picture and status (read if exists, skip if not)
- {FEATURE_DIR}/context-bundle.md — Compact EnterpriseAI context (read if exists, skip if not)
- {FEATURE_DIR}/reuse-scan.md — Reuse-before-create evidence (read if exists, skip if not)

Generate the COMPLETE spec.md following this structure:

1. YAML frontmatter: id, title, status: draft, created (ISO date), updated, author: Gofer
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
12. Goal Ledger Alignment — Goal IDs, outcomes, metrics/targets, linked stories, linked requirements
13. Loop Contract Alignment — loop objective, success criteria, required eval commands, max-iteration stop rules, and human escalation triggers
14. AI-Augmented 4-Step Journey — required for app delivery, not applicable for explicit non-app work
15. UI Preview And Show-And-Tell Loop — required for app delivery, not applicable for explicit non-app work
16. EAI Platform/Azure App Stack Policy — required for app delivery, not applicable for explicit non-app work
17. EnterpriseAI Service Fit — required for app delivery, not applicable for explicit non-app work
18. EnterpriseAI Contract Pack Summary — actors, object types, workflows, permissions, APIs/events, runtime assumptions, acceptance tests

If discovery.md exists, use it to:
- Use Problem Statement for Overview motivation
- Use Target Users persona for 'As a [user type]' in stories
- Use Success Metrics as targets in Success Criteria
- Use Value Proposition for primary value framing
- Keep goal-ledger.json aligned with the measurable outcomes and scope decisions
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
- Require the first MVP preview to stay inside the selected EAI App Template
  blocks before any create-new UI concept is proposed
- Require the specification to preserve the selected external/internal/hybrid
  profile choice, package lane, coupling status, public-readiness target, and
  block-porting decision for each UI block
- Require every proposed UI building block to cite an `eai blocks describe`
  result by stable ID; ambiguous display names are not acceptable
- Require any unknown UI component to be recorded as a custom-block exception
  with manifest shape, component owner, data/resource binding, and review path
- Require Storybook story IDs and theme override points for every reusable or
  ported block; if no story exists, make story creation or an approved exception
  part of the requirements
- Require source-platform-coupled blocks to define the decoupling boundary through
  `eai resources schema`, an adapter, or an explicit restricted-source exception
- Carry forward branding/logo requirements as explicit scope, not as implied
  polish
- Require a fast preview runtime with a command or URL, local preview address,
  and integrated-browser/external-browser fallback
- Require `gofer-ui-preview.mjs` to run after every UI-facing change and record
  the opened URL, screenshot/browser evidence, and self-review notes before the
  agent reports the change as complete
- Require `{FEATURE_DIR}/business-scenarios.json` to map every in-scope user
  story and outcome to the ordered screens/states and executable browser tests;
  require integrated-browser show-and-tell where supported plus a repeatable
  Playwright/Cypress run and passing `business-scenario-report.json`
- Require preview self-review evidence such as screenshot, local render proof,
  opened-browser proof, or Playwright-style checks before stakeholder presentation
- Require a versioned `ui-review-log.md` and `ui-show-and-tell.md` before
  downstream planning/tasks are treated as complete. This is continuous
  visibility, user feedback, and follow-up evidence, not release approval.

If service-fit-matrix.md exists, use it to:
- Separate desired platform capabilities into accessible now, purchasable but
  unavailable now, and unsupported without new platform work
- Bind each chosen capability back to user-facing workflow needs rather than
  generic platform availability
- Keep non-selected or blocked capabilities in Out of Scope, Assumptions, or
  Risks as appropriate

If proposal-review.md exists, use it to:
- Treat explicitly user-approved directions as authoritative scope for the spec
- Reflect the strongest architecture direction in Assumptions, Dependencies, and NFR framing
- Carry forward any user overrides before finalizing requirements
- Place non-selected options in Out of Scope or Assumptions where appropriate

Rules:
- Focus on WHAT and WHY, never HOW to implement
- Written for business stakeholders, not developers
- Maximum 3 [NEEDS CLARIFICATION] markers for genuinely ambiguous items
- Acknowledge ALL constraints from research.md in Assumptions or NFRs
- Reference ALL integration points from research.md in Dependencies
- Prefer explicit user-approved directions in proposal-review.md when present; otherwise treat it as advisory context
- Each functional requirement must include Validation and Integration references
- Explicit non-app work MUST keep the shared numbered stages but MUST NOT be
  forced to create app-only preview, show-and-tell, branding, or service-fit
  sections beyond marking them "Not applicable"

Write the complete specification to {FEATURE_DIR}/spec.md.
When `workflowProfile` is explicitly `enterpriseai`, also write
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
- {FEATURE_DIR}/proposal-review.md — Supporting review decisions to cross-reference when present

Part 1: Research Integration Validation (GAP-04)
For EACH integration point in research.md, check if it's addressed in spec:
- In Dependencies, Functional Requirements, or Assumptions section
For EACH constraint from research.md, check if acknowledged in spec:
- In Assumptions or Non-Functional Requirements
For EACH technology decision, check if reflected in Dependencies.
For EACH decision or override captured in proposal-review.md, check if it is
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
  - Scenario and architecture choices from proposal-review.md are reflected
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
Task: subagent_type="multi-perspective-judge", model="opus"
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
✓ Goal ledger aligned: {FEATURE_DIR}/goal-ledger.json
✓ Loop contract aligned: {FEATURE_DIR}/loop-contract.json

Summary:
- [N] User Stories defined
- [N] Functional Requirements
- [N] Success Criteria

Checklist: {FEATURE_DIR}/checklists/requirements.md

{If sequence diagrams generated:}
Sequence Diagrams: {FEATURE_DIR}/sequence-diagrams/
Selected Option: Option {N} - {Name}
```

Before continuing to planning, verify approval of the business specification
and its scope. If missing or unclear, present the specification and pause for
approval with Progress, Stop reason and Next action. Do not infer consent.
If that scope is already approved and no outstanding gate applies, read and
follow `.specify/commands/3_gofer_plan.md` in the same conversation under the
Continuation And Stop Contract. Do not ask for a numbered command.

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

The standard Gofer workflow is the public default. EnterpriseAI profile outputs
remain opt-in and migration-only.

When the workflow profile is `enterpriseai`, `spec.md` MUST include an explicit
**Integration Map** section that traces the flow from end-user interaction to
the deployed EnterpriseAI app and back. The map must be
expressed as an ordered dependency chain following the pattern:

```
App -> EAI Services -> Deployment Target
```

At minimum the map must name:

1. **App**: the student-facing or business-facing app being
   delivered (maps to the `eai-app-template` reference).
2. **EAI Services**: the EnterpriseAI platform services the app consumes
   (maps to the current public platform documentation or explicitly provided
   project references).
3. **Deployment Target**: the deployment environment and pipeline that will host
   the running app (maps to the configured deployment documentation for the
   target project).

Each link in the chain must reference the internal API contract that carries the
integration payload (for example `IAP-001` → `IAP-002` → `IAP-003`) so the plan
stage can bind implementation tasks directly to specification clauses.

---

## EnterpriseAI Contract Pack Requirements

When `workflowProfile` is explicitly `enterpriseai`, generate
`{FEATURE_DIR}/contract-pack.md` with these required sections:

| Section | Required Content |
| ------- | ---------------- |
| Actors | Business users, administrators, approvers, external systems, support roles |
| Object Types | Reused, extended, and newly proposed EnterpriseAI object types with owners |
| Workflows and Journeys | External user journeys and internal orchestration flows as separate views; app delivery must include the four-step-or-fewer AI-augmented journey |
| UI Preview and Show-and-Tell | For app delivery: preview brief, EAI App Template constraints, branding inputs, preview validation evidence expectations, review-log requirements, and fast user feedback rules; for non-app work: mark not applicable |
| EAI App Delivery Preflight | For EAI app delivery: CLI version/install state, account/login state, tenant role, template initialization readiness, app enrollment readiness, block catalog readiness, and blocked/deferred decisions |
| EAI Platform/Azure Stack Policy | For app delivery: EAI Platform as primary app substrate, Azure as preferred cloud/supporting substrate, custom code constrained to the EAI template, and non-EAI stacks only as approved exceptions |
| AI Assistance Contract | Step goal, assistance mode, context used, generated output, user controls, confidence/evidence, audit trail, completion signal, and escalation for each app step |
| EnterpriseAI Service Fit | For app delivery: desired capabilities, evidence source, accessible now vs purchasable vs unavailable classification, selected direction, and blocked-capability handling |
| Public Platform Boundary | Public docs/help/CLI/PublicAPI behavior the builder may rely on; private platform details intentionally excluded; upgrade/operator-required paths expressed as product-safe user actions |
| Permissions and Tenant Boundaries | Identity, authorization, policy, isolation, and tenant assumptions |
| APIs and Events | ResourceAPI surfaces, events, payload ownership, and contract-test hooks |
| Deployment and Runtime | Environment, config, observability, rollback, and operating assumptions |
| Acceptance Tests | Business, security, data, architecture, operational, and regression checks |

The contract pack must link every new object type/API/workflow back to
`reuse-scan.md` and must flag any "create new" decision that lacks evidence.
For EnterpriseAI public-facing work, the contract pack must also separate:

- **Public builder knowledge**: EAI CLI commands, PublicAPI responses, template
  configuration, support documentation, and user-safe statuses such as
  `available`, `operator_required`, `upgrade_required`, and `not_ready`.
- **Private platform knowledge**: internal service topology, direct downstream
  credentials, private provisioning paths, and any bypass around plan limits or
  AuthZ. These may inform internal implementation tasks, but must not be copied
  into public docs, generated help, templates, or app guidance.

## Step 7: Update Working Backwards PR/FAQ And Business Owner Summary

After `spec.md` is stabilized and before stage completion logging:

1. Create or update `{FEATURE_DIR}/spec-summary.md` using
   `.specify/templates/spec-summary-template.md` if it does not already exist.
   If the optional `gofer:spec-summary` helper was explicitly requested, keep
   using that helper contract; otherwise write the concise stage summary inline.
2. Update `{FEATURE_DIR}/working-backwards-prfaq.md` from the current
   specification.
   - Tighten the Press Release headline, customer problem, launch description,
     customer benefit, and "How To Get Started" around the approved product
     behavior.
   - Fill External FAQ with user-facing behavior, process change, included
     scope, explicit exclusions, success measures, and fallback path.
   - Keep Internal FAQ CTO/CISO sections as `Pending /3` or `Pending /6` where
     the stage has not produced evidence yet.
3. Write `{FEATURE_DIR}/prfaq-history/02-specify.md` as an immutable snapshot of
   the updated PR/FAQ.
4. Update `{FEATURE_DIR}/business-owner-summary.md` from
   `.specify/templates/business-owner-summary-template.md` using
   `problem-brief.md`, `discovery.md`, `spec-summary.md`, assumptions, value
   stream, ROI, and business metrics when present.
5. For application delivery, update `{FEATURE_DIR}/build-map.md` so the scope,
   user process, must-have app experience, EAI Platform areas, risks, and next
   decision match the stabilized specification. If a requirement changes what
   the user will see or how the platform is used, update the relevant build-map
   status row.
6. Update `{FEATURE_DIR}/stakeholder-review-index.md` and explicitly ask the
   Business Owner to approve, revise, or defer:
   - business scenario
   - process change
   - business case / value measures
   - assumptions and exclusions

Do not block the normal auto-chain unless the user explicitly asks to pause for
review. The review index captures pending stakeholder decisions so downstream
stages can reconcile them.

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
- This stage creates or updates a baseline `spec-summary.md` for the
  Business Owner summary and PR/FAQ. If the operator explicitly requests the
  `spec-summary` selector after `spec.md` is stabilized, run
  `gofer:spec-summary` inline to deepen or regenerate
  `.specify/specs/{feature}/spec-summary.md` using the same artifact contract as
  the standalone helper.
- If `spec.md` is missing, continue the stage normally and report that the
  helper was not run.
- These selectors are optional and do not change stage progress, routing, or
  pipeline state.

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
