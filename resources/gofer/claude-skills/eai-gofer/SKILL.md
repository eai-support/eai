---
name: eai-gofer
description: "Use Gofer's repo-owned pipeline, scripts, and validation tools without duplicating every slash command in the picker."
---

# EAI Gofer

Version: 3.7.14
Host: Claude Code

Use this skill when the user asks to install, update, diagnose, run, or understand Gofer from an AI coding app. Prefer this umbrella skill for app-level discovery. Use the plain slash commands for individual pipeline stages.

## Clean Surface Contract

- Stage work uses the plain repo slash commands, for example `/0_gofer_start`, `/1_gofer_research`, and `/6_gofer_validate`.
- App-level setup, troubleshooting, and explanation should use this `eai-gofer` skill plus the repo-owned scripts in `.specify/scripts/`.
- Do not expose a second full set of namespaced stage commands in the same picker when plain slash commands are available.
- Check workspace health before stage work: `node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json`.
- If missing or stale, ask the user before running: `node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host auto --include-mirrors`.

## Light Plugin And Repo Scripts

The light plugin installs durable Gofer knowledge and app integration metadata. The repository remains the source of truth for executable scripts, commands, templates, specs, and memory. After bootstrap, agents should prefer repo-local scripts over bundled fallback copies because the repo can be updated by `eai gofer refresh` or the VS Code extension.

## First EAI Platform App

If the user is starting a first EAI Platform app, run `/gofer:eai-first-run` before `/0_gofer_start`. It is intentionally allowed before `.specify/` exists.

## Current Pipeline

- `/0_gofer_start` - Start Gofer, confirm EAI readiness, and route the delivery pipeline.
- `/0a_problem_validation` - Validate the business problem using 5 Whys root-cause analysis and stakeholder mapping.
- `/10_gofer_cloud` - Deploy and configure the Gofer cloud integration for remote pipeline execution.
- `/1_gofer_research` - Research codebase, CLI integrations, and technology landscape for the target feature.
- `/2_gofer_specify` - Generate a feature specification from research findings and any supporting review context.
- `/3_gofer_plan` - Create a detailed technical implementation plan with architecture, data model, and contracts.
- `/4_gofer_tasks` - Break down the implementation plan into dependency-ordered, parallelisable tasks.
- `/5_gofer_implement` - Execute all tasks from tasks.md phase by phase with feedback loops and engineering review.
- `/6_gofer_validate` - Validate implemented work with evidence-backed scoring, blast-radius analysis, and engineering review.
- `/7_gofer_save` - Save session state and create a handoff checkpoint for resumption in a new context.
- `/7a_stakeholder_comms` - Generate stakeholder-facing communications: release notes, demo scripts, and change briefs.
- `/8_gofer_branding` - Brand Gofer templates and stakeholder documents for a company or consulting-firm look and feel.
- `/9_gofer_tests` - Generate comprehensive test suites from four testing perspectives for a target component.
- `/gofer_bootstrap_workspace` - Create or update the repo-owned Gofer scaffold for the current workspace.
- `/gofer_check_workspace` - Check whether this repo is initialized for Gofer and explain any missing or stale scaffold.
- `/gofer_constitution` - Create or update project constitution with coding principles and guidelines.
- `/gofer_diagnose` - Run a reproduce-minimize-instrument-fix loop for bugs and failing tests.
- `/gofer_eai_first_run` - Prepare a new machine or repo for the first EAI Gofer app build.
- `/gofer_hydrate` - Reverse-engineer specification from existing code (Hydration).
- `/gofer_personality` - Set the assistant personality for this Gofer session: friendly, pragmatic, or none (default).
- `/gofer_plan` - Toggle plan mode in the active CLI session for the next user prompt; non-pipeline control command.
- `/gofer_side` - Open a side conversation in the active CLI without disturbing the main pipeline state; resumable.
- `/gofer_spec_summary` - Generate a business-friendly summary of feature value and scope.
- `/gofer_tdd` - Guide a red-green-refactor loop tied to spec acceptance criteria.
- `/gofer_vocabulary` - Extract domain terminology into a canonical feature glossary.
- `/gofer_zoom_out` - Show how the current feature connects to broader system boundaries.
