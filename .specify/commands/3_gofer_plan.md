---
name: 3_gofer_plan
description: "Create a detailed technical implementation plan with architecture, data model, and contracts."
title: "Gofer Plan"
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
aliases: [gofer:plan-stage]
---
---
description:
  Generate technical implementation plan with architecture and contracts
---

# Gofer Plan

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
and update `.specify/specs/{feature}/delivery-lineage.json` with customer
architecture, decisions, approvers, evidence, and PublicAPI capability
dependencies. Store concise decision rationale, never hidden reasoning.

## Execution Profile And Planning Surface

Use the research/spec risk classification to choose planning depth:

- **fast**: produce the smallest viable plan, only for docs-only or very small
  low-risk work.
- **standard**: produce the normal plan, data/contracts only when relevant, and
  a concrete test strategy. Standard is the catch-all for work that is not fast,
  full, or dynamic.
- **full**: include contract compatibility, auth/security, data migration,
  infra/config, rollback, and release sequencing where the generic risk labels
  require them.
- **dynamic**: produce a workflow DAG, shard plan, reducer plan,
  verifier/refuter pass, resumable progress ledger, budget limits, and stop
  conditions before implementation starts.

Avoid artifact churn. Optional diagrams, extended architecture councils,
generated issue packs, and broad release plans are only warranted when risk is
full/dynamic-depth or the user asks for them.

## EAI Platform Service Planning

For EAI app delivery, read `.specify/references/platform/eai-service-patterns.md`
before writing `plan.md`, `data-model.md`, contracts, or `service-fit-matrix.md`.

Make the normal EAI Platform choice on behalf of the business user:

1. Use PostgreSQL for relational, transactional, reporting, workflow state,
   audit, and structured tenant business data.
2. Use DocumentDB for flexible JSON documents, nested records, high-change
   schemas, and user-authored document state.
3. Use Blob Storage for large files, binary content, exports, and file-like
   resources behind API-mediated access.
4. Use AI Search as a derived search projection, not as the source of record.
5. Use EAI content understanding and document services for extraction,
   classification, summarization, and Retrieval-Augmented Generation.
6. Use EAI workflows, goals, and targets for approvals, long-running work,
   service goals, operating targets, and auditable process state.
7. Use platform AI services and workflow-backed agents before direct provider
   SDKs or provider keys.
8. Ask the user only when the choice affects cost, security, compliance,
   deployment, data residency, external systems, or material business scope.
9. Record each choice, reason, evidence, and exception in `service-fit-matrix.md`.

## Prerequisites

This command expects in `.specify/specs/{feature}/`:

- `research.md` - Codebase analysis (from /1_gofer_research)
- `spec.md` - Feature specification (from /2_gofer_specify)
- `goal-ledger.json` - Objective ledger and re-loop triggers (from /1 and /2)
- `loop-contract.json` - Bounded check-repair contract (from /1 and /2)

If missing, prompt user to run the prerequisite stage.

---

## Spec Artifact Guard

`spec.md` is the source of truth for scope, acceptance criteria, protected
boundaries, and downstream traceability. Before planning, the setup script must
confirm `{FEATURE_DIR}/spec.md` exists, is non-empty, and is not the raw
`spec-template.md` placeholder seeded by feature bootstrap. If
`.specify/scripts/bash/setup-plan.sh --json` reports that `spec.md` is missing,
empty, or `template`, stop and run `/2_gofer_specify`; do not create or refresh
`plan.md` from research alone.

## Outline

1. Context health check
2. Load context (lightweight)
3. Dispatch parallel planning agents (sub-agents handle heavy generation)
4. Review agent outputs
5. Optional multi-perspective review
6. Spec coverage validation
7. Output: `plan.md`, `data-model.md`, `contracts/`, `quickstart.md`, and
   for app delivery an updated `build-map.md`
8. Stakeholder PR/FAQ output: `working-backwards-prfaq.md`,
   `prfaq-history/03-plan.md`, `cto-architecture-summary.md`, and
   `stakeholder-review-index.md`
9. EnterpriseAI profile output: task-ready references to `context-bundle.md`,
   `contract-pack.md`, `reuse-scan.md`, `audit-history.md`, and for app
   delivery `ui-review-log.md`, `ui-show-and-tell.md`, and
   `service-fit-matrix.md`, including public-readiness, block-porting, source platform
   decoupling, Storybook, theme override, and package-profile decisions
10. Dynamic-only output: `workflow-dag.md` with shards, inputs, outputs,
   reducer expectations, verifier/refuter evidence, budget limits, stop
   conditions, and resumable progress location

---

## Step 0: Context Health Check

Before starting planning, assess context window health:

```bash
.specify/scripts/bash/check-context-health.sh
```

- If **< 50%**: Proceed normally
- If **50-70%**: Consider `/compact` - planning loads multiple documents
- If **> 70%**: Start new session with handoff summary

Planning dispatches multiple agents — keep main context lightweight.

---

## Step 1: Load Context (Lightweight)

1. **Run setup script**:

   ```bash
   .specify/scripts/bash/setup-plan.sh --json
   ```

   Parse JSON for FEATURE_DIR, FEATURE_SPEC, BRANCH

2. **Scan existing documents** (do NOT load full content — agents read
   directly):
   - Note feature name from FEATURE_DIR
   - Note whether `discovery.md`, `.specify/memory/constitution.md` exist
   - Note whether `ui-preview-brief.md`, `ui-review-log.md`,
     `ui-show-and-tell.md`, and `service-fit-matrix.md` exist
   - Note external/internal/hybrid profile choice, package lane, coupling
     status, Storybook story IDs, theme override points, custom-block
     exceptions, and public-readiness status when app delivery applies
   - Note whether `goal-ledger.json` exists and which goals, delivery states,
     and re-loop triggers must remain valid through planning
   - Note whether `loop-contract.json` exists and which evaluation commands,
     maximum iterations, stop conditions, and escalation triggers must be
     reflected in implementation phases
   - If loop-contract.json is missing, initialize it with
     `node .specify/scripts/node/gofer-loop-audit.mjs --feature-dir {FEATURE_DIR} --stage 3_plan --init --json`
   - Note whether `{FEATURE_DIR}/sequence-diagrams/selected-option.md` exists

3. **Note template path**: `.specify/templates/plan-template.md`

---

## Step 2: Dispatch Planning Agents

**CRITICAL**: You **MUST** launch these agents using the Task tool. Do NOT
perform this work inline in the main context. The main context should only
orchestrate and review agent outputs. Each agent reads source documents
independently and writes its output artifact.

### Agent 1: Implementation Plan Writer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Generate a complete technical implementation plan for [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files for full context:
- {FEATURE_DIR}/research.md — Technology decisions, integration points, patterns, constraints
- {FEATURE_DIR}/spec.md — User stories, requirements, success criteria
- {FEATURE_DIR}/goal-ledger.json — business goals, metrics, delivery states, and re-loop triggers
- {FEATURE_DIR}/loop-contract.json — bounded loop objective, evaluation commands, max iterations, stop conditions, and escalation rules
- {FEATURE_DIR}/ui-preview-brief.md — app-delivery preview brief (read if exists, skip if not)
- {FEATURE_DIR}/ui-review-log.md — app-delivery preview iteration history (read if exists, skip if not)
- {FEATURE_DIR}/ui-show-and-tell.md — app-delivery show-and-tell state, latest opened preview, and user feedback (read if exists, skip if not)
- {FEATURE_DIR}/service-fit-matrix.md — app-delivery capability selections (read if exists, skip if not)
- .specify/templates/plan-template.md — Plan template structure
- .specify/memory/constitution.md — Project principles (read if exists)
- {FEATURE_DIR}/sequence-diagrams/selected-option.md — Selected approach (read if exists)

Generate the COMPLETE plan.md with these sections:

1. YAML frontmatter: feature, spec, research, status: ready, created (ISO date)
2. Technical Context:
   - Tech Stack (language, framework, database, testing — from research)
   - Architecture (how components fit together, with diagram description)
   - Integration Points table (Component | File | Integration Type)
   - Key Dependencies (existing modules, libraries)
3. Selected Implementation Approach (if selected-option.md exists):
   - Option number, scores, Gen AI touchpoints
4. Constitution Check (if constitution.md exists):
   - Verify alignment with each project principle
5. Implementation Phases (5 phases):
   - Phase 1: Setup & Foundation (directory structure, config, deps, base types)
   - Phase 2: Data Layer (entities, persistence, validation)
   - Phase 3: Business Logic (services per user story, business rules, integrations)
   - Phase 4: API/Interface Layer (endpoints per contracts, validation, auth)
   - Phase 5: Polish & Integration (logging, docs, performance, final testing)
   Each phase must have: Goal, Tasks (checkboxed), Verification criteria
6. File Structure (tree diagram of all new/modified files)
7. Risk Assessment table (Risk | Impact | Mitigation)
8. Spec Traceability:
   - User Story Coverage (Story | Status | Plan References)
   - Requirement Coverage (FR-ID | Status | Plan Reference)
   Verify 100% coverage of all user stories and functional requirements.
9. Goal Reconciliation And Dual-State Delivery:
   - Goal IDs, outcome metrics, target thresholds, and where they are delivered
   - Delivery states (`mock`, `hybrid`, `live`) plus promotion criteria
   - Re-loop triggers that should send the feature back to specify, plan, tasks,
     or validate when contracts, UX scope, assumptions, or implementation drift
10. Loop Engineering Plan:
   - Evaluation commands from loop-contract.json and where they run
   - Maximum check-repair iteration count per implementation/validation loop
   - Stop conditions and human escalation triggers
   - Required ledger evidence to append after each focused loop
11. AI-Readable Blocks Bridge:
   - Package profile choice: external, internal, or hybrid
   - Package lane for each UI block or package surface
   - Coupling status, including source-platform decoupling boundary or approved
     restricted-source exception
   - Block porting plan with stable block IDs, Storybook story IDs, theme
     override points, and custom-block exceptions
   - Public-readiness tasks required before an external or hybrid package is
     considered complete

Rules:
- Every user story from spec.md MUST have plan coverage
- Every acceptance criterion MUST map to a plan component
- Every functional requirement MUST be addressed
- Reference specific file paths for all components
- Plan must be specific enough for task generation
- Resolve all unknowns — no NEEDS CLARIFICATION in the plan
- App-delivery plans MUST make public-readiness, block porting, source platform
  decoupling, Storybook coverage, theme overrides, and package-profile work
  visible enough for `/4_gofer_tasks` to emit first-class runnable tasks
- Keep `goal-ledger.json` aligned with any planning-level changes to goals,
  delivery states, or re-loop triggers
- Keep `loop-contract.json` aligned with plan-level verification commands, stop
  conditions, and release-critical escalation paths

Write the complete plan to {FEATURE_DIR}/plan.md.

Return a structured summary:
- Phase count and task count per phase
- User story coverage: N/N covered
- FR coverage: N/N covered
- Key architecture decisions made
- Any risks flagged as HIGH"
```

### Agent 2: Data Model Designer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Design the data model for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — User stories, requirements, key entities
- {FEATURE_DIR}/research.md — Existing data patterns, database context

If spec.md defines Key Entities or the feature involves data:

Generate {FEATURE_DIR}/data-model.md with:
1. Entity definitions with field tables (Field | Type | Required | Description)
2. Validation rules for each entity
3. Relationships between entities
4. State transition diagrams (Mermaid stateDiagram-v2) where applicable
5. Database considerations (indexing, migration approach)
6. Entity-to-UserStory mapping (which stories need which entities)

If the feature does NOT involve data entities:
Write a minimal data-model.md noting 'No data entities required for this feature.'

Return: entity count, relationship count, entities with state machines"
```

### Agent 3: API Contract Designer

```
Task: subagent_type="general-purpose", model="sonnet"
Prompt: "Design API contracts for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — Functional requirements implying API endpoints
- {FEATURE_DIR}/research.md — Existing API patterns, conventions

If spec.md implies API endpoints (REST, internal, events):

Create contract files in {FEATURE_DIR}/contracts/:
- api.md — For REST/HTTP endpoints
- internal-api.md — For service-to-service contracts
- events.md — For event-based contracts

Each endpoint must include:
- Method and path
- Description
- Request schema (JSON example)
- Response schema (JSON example with status code)
- Error codes table (Code | Description)
- Which user story/FR it serves

If the feature has NO APIs:
Create {FEATURE_DIR}/contracts/api.md noting 'No API endpoints required.'

Return: endpoint count, contract files created, user stories served"
```

### Agent 4: Quickstart Guide Writer

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Generate a quickstart testing guide for feature [FEATURE_NAME].

Feature directory: {FEATURE_DIR}

Read these files:
- {FEATURE_DIR}/spec.md — What to test (acceptance criteria)
- {FEATURE_DIR}/research.md — Tech stack and testing framework info

Write {FEATURE_DIR}/quickstart.md with:
1. Prerequisites (what needs to be installed/configured)
2. Setup steps (how to get the feature running)
3. Manual Testing section (step-by-step test scenarios from acceptance criteria)
4. Automated Tests section (test commands)
5. Key Files table (File | Purpose)
6. Common Issues section (anticipated problems and solutions)

Return: scenario count, prerequisite count"
```

**Run all 4 agents in parallel.** Agents 2-4 read spec.md independently while
Agent 1 generates the plan.

### Agent 5-7: Visual Writers (Persona-Pack)

After the planning agents complete and write plan.md, data-model.md, and
contracts, dispatch three visual-writer sub-agents in parallel to produce the
developer-persona-pack visuals:

```
Task: subagent_type="visual-c4-writer", model="haiku"
Prompt: "Generate C4 Context and Container diagrams for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read spec.md, research.md, plan.md.
Output to {FEATURE_DIR}/visuals/c4-context.md and c4-container.md."

Task: subagent_type="visual-bounded-context-writer", model="haiku"
Prompt: "Generate bounded-context map for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read plan.md, data-model.md, contracts/.
Output to {FEATURE_DIR}/visuals/bounded-context.md."

Task: subagent_type="visual-erd-writer", model="haiku"
Prompt: "Generate data-model ERD for {FEATURE_NAME}.
Feature dir: {FEATURE_DIR}. Read data-model.md.
Output to {FEATURE_DIR}/visuals/data-model-erd.md."
```

These three artifacts (c4-container.md, bounded-context.md, data-model-erd.md)
are required for the developer persona pack. The persona-pack completeness gate
at /4_gofer_tasks start will warn if any are missing.

Visual quality requirements for all planning visuals:

- Answer one review question per visual; split rather than crowding when a
  diagram has more than about seven primary nodes or steps.
- Include a plain-language preamble, audience, source inputs, and how to read
  the visual.
- Use C4 context/container for boundaries and runtime units, ERD for data,
  sequence/state for flows, heatmaps for risk/capability priority, and
  screenshots/storyboards for UI behavior.
- Keep visuals source-controlled and renderable via Mermaid/D2/Structurizr-style
  text where practical; otherwise include a markdown-table/text fallback.
- Generate Marp slide output when stakeholder review needs a simple presentation
  story; skip it only for small docs-only or mechanical changes where Markdown is
  clearer.
- Ensure every human-facing document produced by planning starts with a
  three-to-five-bullet executive summary in plain language.
- Link each visual to the requirement, plan decision, contract, code/test path,
  EAI service/template asset, or validation evidence it summarizes.
- Do not include tenant-private data, secrets, customer identifiers, or
  screenshots containing private content.

### Dynamic-Only: Workflow DAG Writer

When `effectiveProfile=dynamic`, write `{FEATURE_DIR}/workflow-dag.md` before
task generation. It must define:

- independent shards and why they can run separately
- input artifacts each shard may read
- output artifacts each shard must produce
- reducer synthesis expectations
- verifier/refuter checks for contradictions or overreach
- budget limits, stop conditions, and confirmation gates
- resumable progress location outside the chat transcript

---

## Step 3: Review Agent Outputs

After all agents complete:

1. **Review plan.md** — Verify from Agent 1:
   - All user stories have plan coverage (check Spec Traceability section)
   - All functional requirements are addressed
   - Implementation phases are specific enough for task generation
   - File structure is consistent with existing codebase patterns

2. **Review data-model.md** — Verify from Agent 2:
   - All spec entities are covered
   - Relationships make sense
   - Validation rules are complete

3. **Review contracts** — Verify from Agent 3:
   - All implied API endpoints are defined
   - Request/response schemas are realistic
   - Error codes are appropriate

4. **Review quickstart.md** — Verify from Agent 4:
   - Test scenarios cover key acceptance criteria
   - Setup steps are realistic

5. **Fix any gaps** — Make targeted edits to any artifact with missing coverage

---

## Step 4: Spec Coverage Validation (GAP-01)

Dispatch a validator agent to cross-check plan against spec:

```
Task: subagent_type="general-purpose", model="haiku"
Prompt: "Validate plan coverage of specification for feature at {FEATURE_DIR}.

Read:
- {FEATURE_DIR}/spec.md — Source of truth for requirements
- {FEATURE_DIR}/plan.md — Implementation plan to validate
- {FEATURE_DIR}/data-model.md — Data model to validate
- {FEATURE_DIR}/contracts/ — API contracts to validate (read all .md files)

Check these coverage dimensions:

1. USER STORY COVERAGE: Every user story in spec.md has at least one plan phase
2. ACCEPTANCE CRITERIA MAPPING: Every AC maps to a plan component
3. FUNCTIONAL REQUIREMENT COVERAGE: Every FR-XXX is addressed in plan
4. DATA MODEL COMPLETENESS: All Key Entities from spec appear in data-model.md
5. API CONTRACT COMPLETENESS: All implied APIs from spec have contracts

For each dimension, report:
- COVERED items with references
- MISSING items (ERROR — must be fixed)

Return:
- Coverage percentage per dimension
- List of MISSING items
- Overall PASS/FAIL status"
```

If validator reports MISSING items:

- Add missing components to the appropriate artifact
- Re-validate (max 3 iterations)
- **Proceed only when ALL spec items are traced to plan components**

---

## Step 5: Multi-Perspective Plan Review (Optional)

After generating the initial plan, optionally run multi-perspective strategies
to stress-test architectural decisions. **Skip this step if the plan is
straightforward or time-constrained.**

### Strategy #2: Solution Architecture Diverger

For features with significant architectural decisions, spawn 5 agents each using
a different pattern:

```
Task: subagent_type="plan-architecture-diverger", model="sonnet"
Prompt: "Design architecture for [FEATURE] using Pattern [1-5].
Pattern 1: Microservices/modular  2: Monolithic/cohesive  3: Event-sourced
4: CQRS  5: Plugin-based
Spec: [FEATURE_DIR]/spec.md  Plan context: [summary of current plan]"
```

Run all 5 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: architecture selection.
Select the best architecture for this feature considering codebase fit, complexity, and testability.
[paste all 5 agent outputs]"
```

### Strategy #5: API Design Comparator

For features with API surfaces, compare paradigms:

```
Task: subagent_type="plan-api-comparator", model="sonnet"
Prompt: "Design API for [FEATURE] using Paradigm [1-4].
Paradigm 1: REST  2: GraphQL  3: RPC  4: Event-based
Requirements: [API requirements from spec]"
```

Run 3-4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: API paradigm selection.
[paste all agent outputs]"
```

### Strategy #7: Refactor vs Rewrite Advisor

For features that modify existing code significantly:

```
Task: subagent_type="plan-refactor-rewrite-advisor", model="sonnet"
Prompt: "Perspective [1/2] for changing [CODE AREA].
Perspective 1: Plan minimal incremental refactor
Perspective 2: Plan clean rewrite
Current code: [file paths and summary]"
```

Run both in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: refactor vs rewrite decision.
[paste both agent outputs]"
```

### Strategy #12: Migration Path Finder

When the feature requires migrating existing code or data:

```
Task: subagent_type="plan-migration-path-finder", model="sonnet"
Prompt: "Design migration for [CHANGE] using Strategy [1-4].
Strategy 1: Big bang  2: Strangler fig  3: Feature-flagged  4: Adapter/facade
Migration scope: [what needs changing]"
```

Run all 4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: migration strategy selection.
[paste all 4 agent outputs]"
```

### Strategy #16: Data Model Stress Tester

For features with data models, stress-test before finalizing:

```
Task: subagent_type="plan-data-model-stress-tester", model="haiku"
Prompt: "Stress-test data model from Perspective [1-4].
Perspective 1: 10x scale  2: Concurrent access  3: Schema evolution  4: Edge-case shapes
Data model: [entities and relationships from plan]"
```

Run all 4 in parallel, then judge:

```
Task: subagent_type="multi-perspective-judge", model="opus"
Prompt: "Judge verdict type: data model robustness assessment.
[paste all 4 agent outputs]"
```

Incorporate judge recommendations into the plan before proceeding to validation.

---

## Step 6: Update Agent Context

Run the agent context update script:

```bash
.specify/scripts/bash/update-agent-context.sh claude
```

This updates AI agent context files with new technology from this plan.

---

## Step 7: Engineering Review Gate (Up to 5 cycles)

Before proceeding to the next stage, run an iterative engineering review to
catch misalignment early.

### Review Cycle (repeat up to 5 times)

**You MUST dispatch 3 review agents in parallel** using the Task tool:

**Agent 1**: engineer-review (sonnet) — cross-check spec↔plan alignment

```
Task: subagent_type="engineer-review", model="sonnet"
Prompt: "Review alignment between spec.md and plan.md in {FEATURE_DIR}.
Find every gap, inconsistency, and misalignment between the specification
and the implementation plan. Report Red/Yellow/Gray findings."
```

**Agent 2**: codebase-analyzer (sonnet) — verify file paths and code patterns

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Verify that the plan at {FEATURE_DIR}/plan.md references correct
file paths and follows existing codebase patterns from {FEATURE_DIR}/research.md.
Report Red/Yellow/Gray findings."
```

**Agent 3**: validation-correctness (sonnet) — verify acceptance criteria
coverage

```
Task: subagent_type="validation-correctness", model="sonnet"
Prompt: "Verify that every acceptance criterion in {FEATURE_DIR}/spec.md
is addressed by the plan at {FEATURE_DIR}/plan.md.
Report Red/Yellow/Gray findings with coverage gaps."
```

**After agents return:**

1. Classify findings: Red (blocking) / Yellow (should fix) / Gray
   (informational)
2. If NO Red or Yellow findings → PASS → proceed to auto-chain
3. If Red or Yellow findings exist: a. Fix findings directly in plan artifacts
   (Red first, then Yellow) b. Increment cycle counter c. If cycle <= 5 → re-run
   review agents d. If cycle > 5 → log remaining findings, proceed with warnings

---

## Step 8: Report and Continue

Before reporting completion, update the stakeholder-facing architecture pack:

1. Update `{FEATURE_DIR}/working-backwards-prfaq.md`.
   - Add the current architecture story to Internal FAQ CTO / Architecture.
   - Explain how the solution uses EAI Platform first, the EAI App Template
     when app delivery applies, Azure as the preferred supporting substrate,
     and any approved exception.
   - Summarize auth, authorization, tenant boundary, data model, integration,
     contract, and deployment assumptions in plain language.
2. Write `{FEATURE_DIR}/prfaq-history/03-plan.md` as an immutable snapshot.
3. Create or update `{FEATURE_DIR}/cto-architecture-summary.md` from
   `.specify/templates/cto-architecture-summary-template.md` using
   `plan.md`, `contract-pack.md`, `data-model.md`, C4 diagrams,
   `service-fit-matrix.md`, and `eai-preflight.md` when present.
4. For application delivery, update `{FEATURE_DIR}/build-map.md` so the EAI
   Platform, data/workflow, login/security, integrations, and preview/release
   rows reflect the selected architecture in plain language. The latest update
   should say what is being connected, why it matters, and what remains to
   prove before implementation.
5. Update `{FEATURE_DIR}/stakeholder-review-index.md` and explicitly ask
   CTO / Architecture to approve, revise, or defer the architecture,
   EAI/Azure fit, auth/tenant model, data model, and integration contracts.
6. Preserve the existing loop contract: if planning changed eval commands,
   stop conditions, or escalation rules, update `loop-contract.json` and keep
   those changes visible in the stakeholder index rather than replacing loop
   audit behavior.

After all artifacts are created and review gate passes:

```
✓ Plan complete: {FEATURE_DIR}/plan.md

Artifacts created:
- plan.md: Implementation phases and architecture
- loop-contract.json: Bounded evaluation commands and stop rules
- data-model.md: Entity definitions
- contracts/: API specifications
- quickstart.md: Testing guide
- working-backwards-prfaq.md: Updated product release PR/FAQ
- prfaq-history/03-plan.md: Architecture-stage PR/FAQ snapshot
- cto-architecture-summary.md: CTO/EAI Platform architecture review summary
- stakeholder-review-index.md: Review status and approval asks
- workflow-dag.md: Dynamic shard/reducer plan (only when effectiveProfile=dynamic)

Engineering Review: PASSED (cycle [N] of 5)
```

After required evidence and approval checks pass, read and follow
`.specify/commands/4_gofer_tasks.md` in the same conversation under the
Continuation And Stop Contract. Preserve any outstanding explicit plan
approval or material-change gate; do not ask for a numbered command.

---

## EnterpriseAI Deployment Convention and EAI CLI Pinning Requirements

> When `gofer.workflowProfile=enterpriseai`, the following conventions apply.
> standard profile outputs remain unchanged.

When the workflow profile is `enterpriseai`, `plan.md` MUST capture:

1. **EAI CLI version pin** — record the installed `eai` version as a
   `major.minor` pin (for example `2.0`). The plan stage resolves the local
   version via `eai --version`, strips the patch component, and writes the
   pin to the `EnterpriseAI Profile Metadata` block of `plan-template.md` so
   every downstream task is reproducible. Plans MUST apply
   `pin guidance to `major.minor`` and never to a specific patch release.
   If `{FEATURE_DIR}/eai-preflight.md` exists, use its CLI version/install
   evidence as the primary source and re-run `eai --version` only to confirm
   local drift.
2. **EAI app-readiness handoff** — for EAI app delivery, reference
   `{FEATURE_DIR}/eai-preflight.md` before making platform or template
   assumptions. The plan MUST preserve:
   - whether the user is logged in or still needs an EAI Platform account
   - the selected tenant role/readiness and whether app enrollment is allowed
   - whether the repo already has EAI template markers or still needs
     `eai init <app-name>`
   - whether app creation/selection is confirmed, deferred, or blocked
   - block-catalog readiness and package-profile compatibility evidence
   - the last completed gate, blocked gate, and next recovery command from the
     EAI preflight artifact
   If EAI readiness is blocked, plan only the smallest unblock task group and
   do not invent object types, tenant IDs, app keys, or platform capabilities.
3. **EAI app lifecycle ordering handoff** — keep the platform lifecycle
   explicit inside the plan. Resource provisioning, object-type publish,
   schema/storage health, workflow readiness, and preview readiness must remain
   distinct gates with the recovery path carried forward from
   `{FEATURE_DIR}/eai-preflight.md`.
4. **EAI Platform/Azure app stack decision** — for app delivery, the plan MUST
   use EAI Platform, including the EAI app template, as the primary app
   substrate and Azure as the preferred cloud/supporting substrate. The plan MUST
   NOT select Firebase, Supabase, Vercel as the primary runtime, AWS, GCP,
   bespoke backends, unmanaged databases, or unrelated SaaS platforms as the
   default app stack. Any non-EAI technology must be recorded as an integration
   target, migration reference, or approved exception with rationale, owner,
   expiry, and validation evidence.
   Capabilities unavailable in EAI Platform/Azure must be recorded in
   `{FEATURE_DIR}/service-fit-matrix.md` as platform work, operator-required, or
   upgrade-required rather than substituted silently.
5. **Deployment convention** — reference the configured deployment
   documentation for the target project and note which environment
   (dev/staging/prod) each deliverable targets.
6. **Integration map handoff** — restate the App → EAI Services →
   Deployment Target chain from `spec.md` and bind each link to a task
   identifier in `tasks.md`.
7. **Contract pack handoff** — reference `{FEATURE_DIR}/contract-pack.md` and
   bind each actor, object type, workflow/journey, permission boundary,
   API/event, runtime assumption, and acceptance test to plan sections and
   downstream tasks.
8. **AI-augmented journey handoff** — for app delivery, reference
   `{FEATURE_DIR}/journeys/base-journey.md` and plan the four-step-or-fewer
   user-facing process as the default scope spine. Each step must include the
   business goal, generative AI assistance mode, screen/user/data context used,
   completion signal, user controls, audit trail, and fallback/escalation path.
   If the plan expands beyond four user-facing steps, document why those steps
   cannot be combined, automated, or handled by the AI assistant.
9. **UI-first show-and-tell handoff** — for app delivery, reference
   `{FEATURE_DIR}/ui-preview-brief.md` and require the planning stage to lock
   the preview loop before plan/tasks are considered complete. The plan MUST:
   - keep the first preview constrained to EAI App Template blocks unless an
     explicit extension exception is recorded
   - cite `eai blocks describe <id>` evidence for every selected block ID,
     plus the ResourceAPI/Object Type fields from `eai resources schema` that
     feed each block
   - record override points for theme tokens, `presentationConfig`, copy,
     data/action bindings, and client extension blocks
   - capture whether client branding/logos are in scope
   - record the repo runner as the preview command or URL, expected local URL,
     and browser target strategy for integrated-browser first and
     external-browser fallback
   - require this helper after every UI-facing change. Prefer
     `./run.sh dev 3001` on macOS/Linux/Codespaces and `run.bat dev 3001` on
     Windows:
     ```bash
     node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --require-scenarios --open auto --screenshot --change "<change summary>"
     ```
   - create `{FEATURE_DIR}/business-scenarios.json` mapping each in-scope user
     story and outcome to every screen/state crossed and its executable browser
     test; require a passing `business-scenario-report.json`
   - require screenshot, local render proof, integrated-browser walkthrough,
     and repeatable Playwright/Cypress scenario evidence before stakeholder
     presentation
   - update `{FEATURE_DIR}/ui-review-log.md` for each iteration and keep
     `{FEATURE_DIR}/ui-show-and-tell.md` current with the latest opened preview,
     screenshot evidence, user feedback, accepted revisions, and unresolved UX
     questions. Do not treat this as release approval or a blocking gate.
10. **EnterpriseAI service-fit handoff** — for app delivery, the plan MUST
   produce or update `{FEATURE_DIR}/service-fit-matrix.md` after a concrete UI
   direction is visible and
   before tasks are treated as complete. The matrix must distinguish:
   - accessible now
   - purchasable but unavailable now
   - unavailable without new platform work
   The plan must source this evidence from `eai --describe`, `eai whoami`,
   `eai tenant select`, `eai resources schema --format json`,
   `eai verify calls --format json`, `eai workflow readiness [workflow-key]
   --format json`, `eai workflow status <workflow-key>`, `eai workflow request
   <workflow-key>`, `eai provision entra --rotate-secret`, or documented
   equivalent public platform evidence.
11. **Reuse-before-create decision log** — reference `{FEATURE_DIR}/reuse-scan.md`
   for every new or extended EnterpriseAI object type, API/event, workflow, or
   module.
12. **Audit history seed** — create or update `{FEATURE_DIR}/audit-history.md`
   with stable finding IDs, decision exceptions, owner, expiry, and review
   cadence so validation can track recurring issues.
13. **Public/private knowledge split** — identify which implementation facts
    are safe for public docs, Gofer guidance, EAI CLI help, or EAI App Template
    comments, and which facts are restricted-source. Plans must express blocked
    states as public-safe actions (`operator_required`, `upgrade_required`, or
    documented support URL) rather than exposing private service topology.

### EnterpriseAI Flow and Journey Separation

Plan both:

- **External user journeys**: the business/user-facing path, decision points,
  adoption impact, and measurable value.
- **AI-augmented app process**: for application delivery, the four-step-or-fewer
  journey with AI assistance, contextual prefill, conversational support,
  completion checks, and human controls at each step.
- **App-delivery preview and show-and-tell loop**: for application delivery, the
  local preview creation, self-review, stakeholder feedback, branding updates,
  and rapid browser/screenshot evidence that must occur before plan/tasks are
  finalized.
- **EnterpriseAI service-fit gate**: for application delivery, the post-preview
  capability-selection discussion that binds chosen platform services to the
  visible UI direction and distinguishes accessible now vs purchasable vs
  unavailable.
- **Internal orchestration flows**: platform services, ResourceAPI calls,
  events, data movement, tenant boundaries, deployment steps, and observability.

### Competitive / market analysis reference

When `includeCompetitiveAnalysis=true`, `plan.md` MUST link to
`market-analysis.md`. When disabled, the competitive-analysis section is omitted
and standard profile outputs remain unchanged.

---

## Observability Logging

At stage completion, log metrics:

```bash
.specify/scripts/bash/log-stage.sh 3_plan --complete --tokens [N] --compactions [N]
```

Logs to: `.specify/logs/pipeline.jsonl`

---

## Key Rules

- Use absolute paths for all file references
- ERROR if constitution gates fail without justification
- All NEEDS CLARIFICATION must be resolved before completing
- Plan must be specific enough for task generation
- Log stage completion for observability tracking

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
