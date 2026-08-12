---
name: eai
description: "Start or continue the EAI delivery pipeline."
---

# Eai

Version: 3.8.1
Host: Grok Build

# Eai

Use this as the single user-facing Gofer command. Users should run `/eai`, `$eai`, or `#eai` depending on the host. Do not ask users to run numbered stage commands unless they explicitly request low-level internals.

## User-Facing Contract

- Keep the command window simple: expose `eai` only.
- Treat `.specify/commands/*.md` as internal stage contracts, not user-facing commands.
- Keep all Gofer functions available by routing internally to the right stage contract.
- Explain progress in business language first; provide technical details when the user asks.

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

## Workspace Preflight

1. Resolve the repository root.
2. Run `node .specify/scripts/node/gofer-workspace-check.mjs --host grok --json` when available.
3. If the repo is missing or stale, ask exactly: **"This repo is missing or stale for Gofer. Initialize/update it now?"**
4. If the user says yes, run `node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host grok --include-mirrors`, then resume this command.
5. If the user says no, stop and explain that Gofer needs the repo scaffold before it can safely continue.

## App vs Non-App Routing

1. Classify the request before EAI readiness: EAI app delivery, non-application work, or ambiguous.
2. If the request is EAI app delivery or ambiguous, continue directly into the EAI app delivery path; do not ask for confirmation just because app delivery is inferred.
3. If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
4. When the user confirms non-app, do not run `eai whoami`, tenant selection, `eai init`, or first-run setup. Record the decision and continue the appropriate Gofer research, documentation, audit, migration, or planning path.
5. If the user says it is app work, switch to EAI app delivery and run EAI readiness.

## EAI Platform Readiness

1. Run `eai whoami` only for EAI app delivery work or explicit EAI CLI recovery.
2. Confirm the user is logged in, an active tenant is available, and the repo is ready for the EAI app template.
3. If EAI CLI, login, tenant, or template readiness is missing for app delivery, run the first-run/setup path from `.specify/commands/gofer_eai_first_run.md` when present.
4. After any `eai` error, run `eai errors explain <code-or-reason> --format json` when available before guessing remediation.
5. Do not write tokens, secrets, private tenant IDs, or local `.env` values into artifacts.

## First Conversation

When this is the first EAI conversation for a new app:

1. Start with the business outcome. Ask what the user needs to achieve, who it is for, and how success will be measured.
2. Explain EAI capabilities only when they help the next decision. Do not begin with platform architecture or a list of tools.
3. Use the repository and EAI CLI as sources of truth. Run `eai --describe` before assuming command syntax and explain known errors before recovery.
4. Keep numbered Gofer stages internal. Say what is being learned, designed, built, or checked in business language.
5. Explain why specification-led delivery improves AI quality: it creates a shared, testable statement of the outcome before code changes multiply.
6. Pause once for approval of the business specification. After approval, continue automatically unless a material business, security, cost, deployment, or destructive decision needs approval.
7. Do not create a GitHub repository, deploy, publish, spend money, or change external systems without the relevant user approval.

## Route The Pipeline

1. Read existing feature state from `.specify/specs/`, pipeline state files, checkpoints, validation artifacts, and loop evidence.
2. Decide the next internal stage contract needed to move the feature toward completion.
3. If no feature state exists yet, start from `.specify/commands/0_gofer_start.md`.
4. Execute the selected stage by following the matching file in `.specify/commands/`.
5. Continue through research, specify, plan, tasks, implement, and validate unless a real business, security, release, or user-approval decision blocks progress.
6. When app UI is involved, show the user the working UI as early and as often as practical.
7. Keep stakeholder summaries, build maps, diagrams, loop evidence, tests, and validation artifacts current.

## Internal Function Contracts

- `0_gofer_start` - Start Gofer, confirm EAI readiness, and route the delivery pipeline.
- `0a_problem_validation` - Validate the business problem using 5 Whys root-cause analysis and stakeholder mapping.
- `10_gofer_cloud` - Deploy and configure the Gofer cloud integration for remote pipeline execution.
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
