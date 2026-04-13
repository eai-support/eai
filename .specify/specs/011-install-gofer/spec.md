# Specification: 011 - Install Gofer

Date: 2026-04-13

## User Story

As a developer creating a new EAI vertical, I want `eai init` to install the Gofer agents, commands, scripts, hooks, templates, and AI terminal metadata so I can immediately run the Gofer workflow from Claude CLI, Codex CLI, Gemini CLI, or GitHub Copilot.

## Acceptance Criteria

- AC-001: `eai init <name>` installs Gofer assets by default after the vertical template is initialized.
- AC-002: The generated repo contains `.specify` scripts, hooks, templates, logs, specs, and memory folders required by the Gofer pipeline.
- AC-003: The generated repo contains Claude CLI commands and agents under `.claude/commands` and `.claude/agents`.
- AC-004: The generated repo contains Codex and Gemini local skills under `.system/skills` and `.agents/skills`.
- AC-005: The generated repo contains GitHub Copilot prompts, instructions, and local skill mirrors under `.github`.
- AC-006: The generated repo documentation explains the first command for Claude CLI, Codex CLI, Gemini CLI, and Copilot.
- AC-007: `eai init --no-gofer <name>` skips all Gofer-specific asset installation.
- AC-008: The published npm package includes the vendored Gofer resources.
- AC-009: CLI help and public documentation describe the default Gofer install behavior and the `--no-gofer` escape hatch.
- AC-010: Release metadata and static registry artifacts are updated for version `2.0.5`.

## Non-Goals

- Installing external AI CLI binaries automatically during `eai init`.
- Authenticating Claude, Codex, Gemini, or Copilot accounts.
- Changing the vertical application runtime template beyond Gofer workflow assets.

