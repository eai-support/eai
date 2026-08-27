---
name: gofer:bootstrap-workspace
description: "Create or update the repo-owned Gofer scaffold for the current workspace."
title: "Gofer Workspace Bootstrap"
category: control
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
---

# Gofer Workspace Bootstrap

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

## Guardrails

- Preserve existing `.specify/specs/*` work.
- Preserve existing `.specify/memory/constitution.md` if present.
- Do **not** overwrite existing `AGENTS.md`, `CLAUDE.md`, or
  `.github/copilot-instructions.md` by default. Create them only when missing.
- Do **not** add repo-local assistant mirrors (`.claude/commands`,
  `.agents/skills`, `.github/prompts`, `.gemini/`, etc.) unless the user
  explicitly asks for them.

## Step 1: Resolve The Workspace Root

Use the current repository root. If you started inside a subdirectory, walk
upward to the nearest directory containing `.git`, `package.json`,
`pyproject.toml`, `go.mod`, `Cargo.toml`, or `.specify`.

## Step 2: Select A Bootstrap Source

Use the first source that exists:

1. `~/plugins/eai-gofer`
2. `./plugins/eai-gofer` when you are working in the Gofer repo itself
3. Download the latest public bundle zip and extract it to a temporary folder:

```bash
curl -fsSL https://eai-support.github.io/eai-gofer/releases/eai-gofer-agent-plugin-latest.zip \
  -o /tmp/eai-gofer-agent-plugin-latest.zip
rm -rf /tmp/eai-gofer-bootstrap
mkdir -p /tmp/eai-gofer-bootstrap
unzip -q /tmp/eai-gofer-agent-plugin-latest.zip -d /tmp/eai-gofer-bootstrap
```

When using the downloaded bundle, the source root is:

```text
/tmp/eai-gofer-bootstrap/eai-gofer
```

## Step 3: Run The Portable Bootstrap Script

Prefer the scripted bootstrap from the selected source:

```bash
node "$SOURCE_ROOT/.specify/scripts/node/gofer-workspace-bootstrap.mjs" \
  --workspace "$WORKSPACE_ROOT" \
  --host "$GOFER_HOST"
```

Use the host value that matches the current client: `claude`, `codex`,
`copilot`, or `gemini`.

If the user explicitly asks for repo-local assistant mirrors as well, append:

```bash
--include-mirrors
```

The default bootstrap must create/update:

- `.specify/commands/`
- `.specify/templates/`
- `.specify/scripts/bash/`
- `.specify/scripts/node/`
- `.specify/scripts/hooks/`
- `.specify/scripts/powershell/`
- `.specify/specs/`
- `.specify/memory/`
- `.specify/memory/gofer-model-policy.yaml` when missing
- `.specify/.gofer-version`
- `.specify/README.md`
- Gofer runtime `.gitignore` entries

And host-specific repo-owned files:

- **Claude**: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`
- **Codex**: `AGENTS.md`
- **Copilot**: `.github/copilot-instructions.md`
- **Gemini**: no extra required repo-owned file beyond the core scaffold

## Step 4: Re-Run The Workspace Check

After bootstrap completes, run:

```bash
node .specify/scripts/node/gofer-workspace-check.mjs --host "$GOFER_HOST" --json
```

Report what changed and whether the workspace is now healthy.

If the workspace is still stale because the repo-local scripts are older than
the currently installed plugin bundle, explain that clearly and keep the
selected source bundle as the truth for the update.

## Step 5: Continue EAI App First-Run Setup When Needed

If the user is building an EAI Platform app and Git, Node.js, npm, the EAI CLI,
login, tenant access, or EAI app template readiness is still missing, run
`/gofer:eai-first-run` next. Do not ask again when the workspace is healthy;
only ask when an install, browser login, tenant selection, or `eai init` action
is actually needed.

## Step 6: Write The Workspace Bootstrap Report

Write the artifact only to `.specify/logs/workspace-bootstrap-report.md`.

If the target file already exists, replace it and prepend a regeneration note
such as `<!-- regenerated at [ISO timestamp] -->`.

Include the minimum provenance schema:

- `GeneratedAt`
- `SourceCommandId`
- `SourceInputs`
- `OverwriteNoticeWhenApplicable`

The generated workspace bootstrap report must contain these sections:

- `## Provenance`
- `## Workspace Root`
- `## Bootstrap Source`
- `## Host Policy`
- `## Changes Applied`
- `## Post-Check`

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