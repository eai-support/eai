---
name: gofer:bootstrap-workspace
description: "Create or update the repo-owned Gofer scaffold for the current workspace."
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
curl -fsSL https://eai-tools.github.io/eai-gofer/releases/eai-gofer-agent-plugin-latest.zip \
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
