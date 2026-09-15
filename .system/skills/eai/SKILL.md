---
name: eai
description: "Run Gofer through one public entrypoint while preserving the full internal pipeline."
---

# Eai

Version: 3.12.7

Apply this skill to every request when the plugin is enabled. The user does not need to type a Gofer command. Keep the user's request unchanged and route it through Gofer internally. Use the separate update skill only when the user explicitly asks to install or update Gofer.

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

## Clean Surface Contract

- User-facing command and skill pickers should expose only `eai`.
- Do not ask users to run numbered/helper stage commands such as `/0_gofer_start`, `/1_gofer_research`, or `/6_gofer_validate` unless they explicitly ask for low-level internals.
- Preserve all Gofer functions by routing internally through the stage contracts in `.specify/commands/*.md`.

## Workspace First

Before stage work, resolve the repository root and run `node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json` when available. If the repo is missing or stale, ask before running `node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host auto --include-mirrors`, then resume the original command.

## Local Settings Cleanup Contract

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

## App Preview Runner Contract

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

## Controlled English Contract

Use ASD-STE100 Simplified Technical English as the target writing standard for all Gofer-authored chat, documents, commands, summaries, PR notes, error guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of ASD; do not bundle the protected ASD dictionary and do not claim ASD certification.

Apply these rules before any user-facing output:

1. Use short sentences. Keep instructions to 20 words or fewer where possible.
2. Use one action per instruction.
3. Use active voice. Use passive voice only when the actor is unknown or not important.
4. Use simple present, simple past, simple future, infinitive, or imperative verb forms.
5. Use approved project terms and necessary technical nouns only. Define acronyms on first use.
6. Use direct words. Avoid idioms, marketing adjectives, vague praise, and hedging.
7. Use vertical lists for complex information.
8. Put one topic in each paragraph.
9. For errors, write: what happened, why it matters, what to do next, and the exact safe command when one exists.
10. Keep raw logs, stack traces, IDs, and secrets out of chat unless the user asks for technical detail.

## User-Facing Response Gate

Before each user-facing reply, check the draft against these rules:

1. Lead with the business outcome, effect, risk, or decision.
2. Use concise, simple language.
3. Include technical detail only when it supports a decision or the user asks for it.
4. If any check fails, rewrite the reply before sending it.

## Always-On EAI Contract
<!-- gofer:always-on-eai:start -->

Apply this contract to every request after Gofer is installed for this repo or AI coding app. The user does not need to type `/eai`, `$eai`, or `#eai`.

1. Preserve the user's request. Do not rewrite it or add a visible command prefix.
2. Treat an explicit `/eai`, `$eai`, or `#eai` prefix as an idempotent request for the same contract.
3. Apply the Controlled English Contract to every Gofer-authored message and artifact.
4. Keep the reply short unless the user asks for detail.
5. Explain the business effect first.
6. Put technical evidence in durable artifacts.
7. Do not make the user choose pipeline stages. Select the next internal stage yourself.
8. Do not repeat workspace setup on every message. Check it before meaningful repo work, tool use, or a pipeline stage.
9. Keep the update and installation path separate. When the user explicitly asks to update Gofer, run only its maintenance contract.
<!-- gofer:always-on-eai:end -->

## Business-Friendly Progress

- Keep user-facing progress short and business-level by default.
- Explain what is being connected, changed, checked, or fixed and why it matters.
- Use `.specify/specs/{feature}/build-map.md` as the shared picture of the build when app delivery applies.
- Keep technical detail, logs, tests, and security evidence in artifacts; show deeper detail when the user asks.

## App vs Non-App Routing

- Classify each request before EAI readiness as EAI app delivery, non-application work, or ambiguous.
- If the request is EAI app delivery or ambiguous, continue directly into the EAI app delivery path and run EAI readiness.
- If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
- If the user confirms non-app, do not run `eai whoami`, tenant selection, `eai init`, or first-run setup. Record the decision and continue the appropriate non-app path.
- If the user says it is app work, switch to EAI app delivery and run EAI app preflight.

## Journey State

Before routing work, decide where the user is now.

1. Read current feature state from `.specify/specs/`, `goal-ledger.json`, `eai-preflight.md`, `research.md`, `spec.md`, `plan.md`, `tasks.md`, validation reports, loop evidence, and handoff notes when they exist.
2. Classify the request as conversation, research/docs/audit, EAI app delivery, or ambiguous.
3. For conversation or research/docs/audit, continue the non-app Gofer path after the one required non-app confirmation.
4. For EAI app delivery or ambiguous app work, continue directly into EAI readiness.
5. Find the earliest missing pipeline artifact or blocked EAI gate.
6. Run that internal stage next, then continue forward.
7. Keep the user-facing explanation at the business level.

## First EAI Platform App

If the user is starting a first EAI Platform app, use the public `eai` entrypoint, then follow the first-run/setup contract in `.specify/commands/gofer_eai_first_run.md` when it is present. It is allowed before `.specify/` exists and checks Git, Node.js, npm, the scoped EAI registry, EAI CLI, login, tenant, `eai init`, and Gofer scaffold readiness with user approval gates.

## MVP Capability-Based Validation

- Create `.specify/specs/{feature}/` before app or operator-tool source work.
- Classify EAI template readiness as `not_applicable`, `planned`, `implemented`, `verified`, or `blocked`.
- For a local MVP with no EAI or authentication capability, record those states as `not_applicable` or `planned` and continue with local feature validation.
- Treat `run.sh`, `run.bat`, and `run.ps1` as launch evidence only. They do not prove authentication, EAI access, or deployment readiness.
- When the feature creates, changes, or validates an EAI Platform integration, run `node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json`.
- A missing checker or any status other than `ready` blocks that EAI capability. It does not block unrelated local MVP work.
- When authentication is implemented or required, verify provider, callback, sign-in, session, protected access, and safe denied access.
- Record screenshots and local HTTP checks in the feature validation report. A blocked browser check leaves the user journey unverified.
- If the user changes scope, update the feature artifacts before continuing: `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and validation scope.
- For a release or deployed claim, create `release-capability-ledger.md` and link each accepted requirement to evidence, PR, commit, release branch, and deployed proof.
- Do not report a release complete or score 100% if a required capability is on an open PR, absent from the release branch, missing traceability, or lacks deployed evidence.
- Do not accept copied marker files, partial scaffolds, or custom templates as EAI readiness evidence.
- Confirmed non-app work is exempt from app-only gates.

**Authentication Access Decision**

When adding or changing authentication, read `.specify/references/platform/eai-auth-access.md`. Ask: **"Who should be able to use this app: only members of its EAI workspace (recommended), or any authenticated EAI user?"** Default to `workspace-only`. Wait for the answer before changing auth code. An unanswered question must not widen access. Preserve stricter existing rules. Record the answer in the feature spec; do not repeat a confirmed question unless its scope changes.

Confirm the sign-in method separately: EAI sign-in or client SSO through EAI. Verify platform support and CLI syntax; do not invent SSO commands. Enforce trusted server-side workspace membership and app permissions. A session, CIAM directory ID, or email domain alone is not workspace access. Platform-wide sign-in never grants access to another workspace's data. Test allowed and denied users, revoked membership, unavailable membership checks, and cross-tenant requests. These checks apply only when authentication is implemented or required, not to non-app work or an auth-free local MVP.

**Business Updates And Goal Checks**

Use `.specify/references/business-updates-and-goal-checks.md`. Before each reply, explain the result, business effect, and next action in plain language. For progress, use two or three short sentences. Run `node .specify/scripts/node/gofer-response-check.mjs --input <private-draft-file>` before sending a drafted progress update; rewrite failed drafts. Use `--kind answer` for answers and `--technical` only when technical detail was requested. Do not repeat unchanged progress. This helper cannot intercept messages that the host sends directly.

Before each work batch, read the current goal, specification, tasks, and latest findings. After new knowledge or an approved change, update affected feature documents and explain the effect. Never weaken acceptance criteria to match failing code or invent user approval. Mark a task complete only after its linked checks pass; reopen affected tasks when evidence is stale. For app and non-app features with a spec and tasks, enable `requireDeliveryCheckpoint` in `loop-contract.json` and run `node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir>` before advancing or claiming completion. Follow the reference to capture a reviewed checkpoint, not merely to clear a failure. Keep existing MVP exemptions, reviews, loops, and release gates. Conversation-only requests need no feature files.

**Priority And Outcome Protection**

Follow `.specify/references/priority-outcome-protection.md`. Before implementing a task, record the latest material user direction in decisions.md and maintain priority-plan.json with ordered tasks, dependencies, allowedEditScope and the current outcome. Enable requirePriorityPlan for new feature contracts. Run `node .specify/scripts/node/gofer-priority-check.mjs --feature-dir <feature-dir> --task T001` before the action, and include --workspace <repo-root> plus --changed-file for each proposed or actual changed repo-relative path. Follow its nextTask; only recorded prerequisites and approved parallel work may precede the current priority. Do not switch to unrelated work when blocked. On resume, state the agreed outcome and next task in plain language after reading the last recorded direction. Keep routine conversation free of feature paperwork.

Before technical escalation, attach fresh diagnosis through the blocker helper's ask event verification field. Check the exact command, route, environment, own mistake and existing authority. Do not invent a tenant, ask for login without checking it, require an unsafe alternative, or equate administrator access with permission. Business decisions need no failing command. At completion, run the priority checker with --finish; a missing or stale outcome receipt means unverified, regardless of test scores. Use --completion for the final gofer-closed-loop-audit.mjs run; a routine drift audit alone does not prove completion. Preserve detailed test results, early local MVP scope, non-app work, independent approved tasks and all release/security checks.

## EAI App Template Gate

Apply the capability validation rules above before EAI template, tenant, authentication, or deployment work.

## First Conversation

When this is the first EAI conversation for a new app:

1. Start with the business outcome. Ask what the user needs to achieve, who it is for, and how success will be measured.
2. Explain EAI capabilities only when they help the next decision. Do not begin with platform architecture or a list of tools.
3. Use the repository and EAI CLI as sources of truth. Run `eai --describe` before assuming command syntax and explain known errors before recovery.
4. Keep numbered Gofer stages internal. Say what is being learned, designed, built, or checked in business language.
5. Explain why specification-led delivery improves AI quality: it creates a shared, testable statement of the outcome before code changes multiply.
6. Pause once for approval of the business specification. Then continue unless a material business, security, cost, deployment, or destructive decision needs approval.
7. Do not create a GitHub repository, deploy, publish, spend money, or change external systems without the relevant user approval.

## EAI CLI Discovery And Recovery

- Run `eai whoami` only for EAI app delivery work or explicit EAI CLI recovery, not for confirmed non-app research/docs/audit/planning.
- Run `eai update --check` before first EAI platform work when the CLI may be stale.
- Run `eai --describe` before assuming command syntax.
- If advertised, run `eai agent guide --format json` before planning or fixing EAI workflows.
- After any `eai` error, run `eai errors explain <code-or-reason> --format json` before guessing remediation.
- If `eai errors explain` is unavailable, match `.specify/references/platform/eai-error-catalog.yaml`, run read-only diagnostics before mutating fixes, and stop at the retry or escalation condition.
- For `eai user invite` 5xx or `EXTERNAL_SERVICE_ERROR`, check existing members with `eai user list --tenant <tenant-id> --search <email> --format json`; use `eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json` only after verification and user approval, then tell the app user to sign out and sign back in.
- For `MISSING_TENANT`, `app_token_tenant_context_required`, or "Tenant context required for app tokens" on platform user lookup or membership prerequisites, run `eai errors explain app_token_tenant_context_required --format json`, confirm tenant context, and retry `/v4/platform/tenants/<tenant-id>/...` routes before changing tenant members, Entra, role definitions, databases, or cloud portals.
- Use `eai publicapi` only for authorized PublicAPI `/v4/...` routes.

## Verified EAI CLI Command Contract

Do not invent, guess, or complete EAI CLI commands from memory.

1. Before you suggest or run an `eai ...` command, verify the exact command from the installed CLI.
2. Start with `eai --describe` and use its command map as the source of truth.
3. For a specific command, run `eai <command> --help` or the CLI-described equivalent before using flags, subcommands, or examples.
4. Use `eai agent guide --format json` when the CLI advertises it.
5. Use `eai errors explain <code-or-reason> --format json` after errors when the CLI advertises it.
6. If the command is not listed or help fails, do not run it. Say the installed EAI CLI does not expose that command, then choose a safe listed command or ask the user to update EAI CLI.
7. Record the verified command and source in `eai-preflight.md`, `service-fit-matrix.md`, or the active feature notes before the command changes files or external systems.
8. For commands that create, deploy, publish, mutate tenants, change Entra, or spend money, confirm with the user after verification and before execution.

## EAI Platform Decision Contract

For app delivery, make EAI Platform choices for the business user.

1. Read `.specify/references/platform/eai-service-patterns.md`, `.specify/references/platform/eai-repo-contract.md`, and `.specify/references/platform/eai.md` before architecture or storage decisions.
2. Run `eai --describe` before assuming current CLI syntax.
3. Run `eai agent guide --format json` when the CLI advertises it.
4. Run `eai resources schema --format json` and `eai workflow readiness --format json` when advertised and relevant.
5. Create or update `.specify/specs/{feature}/service-fit-matrix.md`.
6. Prefer the EAI app template, PublicAPI, ResourceAPI, object types, workflows, goals, targets, platform AI services, and tenant identity.
7. Prefer PostgreSQL for relational, transactional, reporting, and workflow state.
8. Prefer DocumentDB for flexible JSON documents, nested records, and high-change document models.
9. Prefer Blob Storage for large files and binary content behind API-mediated access.
10. Prefer AI Search as a derived search projection, not as the source of record.
11. Prefer EAI content understanding and document services for classification, extraction, summarization, and Retrieval-Augmented Generation.
12. Prefer EAI workflows, goals, and targets for approvals, long-running work, service goals, operating targets, and auditable process state.
13. Use Azure second when the EAI Platform does not yet expose the needed capability.
14. Use any other platform only as an explicit exception with rationale, owner, expiry, and validation evidence.
15. Ask the user only for material business, security, cost, deployment, destructive, or external-system decisions.

## Token And Cost Policy

- Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. Run the internal bootstrap contract if it is missing.
- Use the cheapest capable model first. Escalate only when a cheaper pass is low-confidence, contradictory, security-sensitive, release-critical, or blocking quality.
- Keep raw search, build, and test output out of the main chat context. Write stable findings to `.specify/specs/{feature}/context-bundle.md` and continue from summaries.
- Prefer provider prompt/context caching for stable non-secret prefixes: Gofer scaffold, repository instructions, constitution, repo map, stage contracts, and validation rubric.
- After large research, planning, implementation, or validation bursts, checkpoint artifacts and compact/clear/resume context when the host supports it.

## Internal Pipeline And Helper Contracts

- `0_gofer_start` - Start Gofer, confirm EAI readiness, and route the delivery pipeline.
- `0a_problem_validation` - Validate the business problem using 5 Whys root-cause analysis and stakeholder mapping.
- `1_gofer_research` - Research codebase, CLI integrations, and technology landscape for the target feature.
- `2_gofer_specify` - Generate a feature specification from research findings and any supporting review context.
- `3_gofer_plan` - Create a detailed technical implementation plan with architecture, data model, and contracts.
- `4_gofer_tasks` - Break down the implementation plan into dependency-ordered, parallelisable tasks.
- `5_gofer_implement` - Execute all tasks from tasks.md phase by phase with feedback loops and engineering review.
- `6_gofer_validate` - Validate implemented work with evidence-backed scoring, blast-radius analysis, and engineering review.
- `7_gofer_save` - Save session state and create a handoff checkpoint for resumption in a new context.
- `7a_stakeholder_comms` - Generate stakeholder-facing communications: release notes, demo scripts, and change briefs.
- `8_gofer_branding` - Brand Gofer templates and stakeholder documents for a company or consulting-firm look and feel.
- `9_gofer_tests` - Generate comprehensive test suites from four testing perspectives for a target component.
- `10_gofer_cloud` - Deploy and configure the Gofer cloud integration for remote pipeline execution.
- `gofer_bootstrap_workspace` - Create or update the repo-owned Gofer scaffold for the current workspace.
- `gofer_check_workspace` - Check whether this repo is initialized for Gofer and explain any missing or stale scaffold.
- `gofer_constitution` - Create or update project constitution with coding principles and guidelines.
- `gofer_diagnose` - Run a reproduce-minimize-instrument-fix loop for bugs and failing tests.
- `gofer_eai_first_run` - Prepare a new machine or repo for the first EAI Gofer app build.
- `gofer_hydrate` - Reverse-engineer specification from existing code (Hydration).
- `gofer_personality` - Set the assistant personality for this Gofer session: friendly, pragmatic, or none (default).
- `gofer_plan` - Toggle plan mode in the active CLI session for the next user prompt; non-pipeline control command.
- `gofer_side` - Open a side conversation in the active CLI without disturbing the main pipeline state; resumable.
- `gofer_spec_summary` - Generate a business-friendly summary of feature value and scope.
- `gofer_tdd` - Guide a red-green-refactor loop tied to spec acceptance criteria.
- `gofer_vocabulary` - Extract domain terminology into a canonical feature glossary.
- `gofer_zoom_out` - Show how the current feature connects to broader system boundaries.

## Stable Local Install Path

Install or update this plugin by replacing the stable local folder:

```text
~/plugins/eai-gofer
```

The public release feed is available at:

```text
https://eai-support.github.io/eai-gofer/releases.json
```

Gemini CLI users can also copy the bundled `.gemini/` directory into a repository root to activate the same public command set there.
