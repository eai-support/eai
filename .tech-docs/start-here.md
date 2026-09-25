---
generated: false
title: Start Here
---

# Start Here

Choose the route that matches your situation. Do not complete every route.

## Set Up This Computer

**Recommended for most people.** Use [EAI Setup](./installer-setup.md) on a new
Windows, macOS, or Ubuntu/Debian computer.

You download the installer, sign in in your browser, and name your first
project. EAI Setup prepares the tools and creates the project.

The current CLI release is **v3.18.0** (2026-09-23): Add safe template adoption plans and backed-up Gofer update maintenance.

## Connect An Existing Project

Use [EAI App Template](./eai-app-template.md) when you already have a project
and want to add EAI services, documents, or tenant-aware patterns.

## Use Manual Or Managed Setup

Use [Manual and Managed Setup](./manual-and-managed-setup.md) when you work in
CI, on a managed device, behind a proxy, or need to control each command.

## After Your Project Is Ready

- Use [eai-gofer](./eai-gofer.md) to prepare your AI coding workspace.
- Use [Examples](./examples/index.md) to start from an application pattern.
- Use [EAI CLI](./eai-cli.md) for commands and daily operations.
- Use [Error Guidance](./error-guidance.md) when setup does not complete.

When you publish Object Types, use PascalCase for the model name and use the exact published Object Type slug in lowercase kebab-case for storage and transport.

<details>
<summary>Advanced: AI workspace support</summary>

Run `eai start --check`, then `eai start`, when the project is ready. The check
only reads local metadata. It does not access provider accounts or project files.

Current handoff support, in catalog order:

| AI workspace | What EAI does | Remaining action |
|---|---|---|
| GitHub Copilot in VS Code | Opens the project and EAI prompt. | Sign in if asked. |
| GitHub Copilot app | Opens the project through the supported capability. | Choose the folder if asked. |
| Google Antigravity 2.0 | Opens the verified desktop app. | Add the project folder. |
| Claude Desktop | Opens a Code session when supported. | Confirm the project folder. |
| ChatGPT desktop (Codex) | Opens the project and EAI prompt where supported. | Choose the folder if asked. |
| Grok Bot | Opens the verified cloud client. | Use Grok Build for local work. |
| GitHub Copilot CLI | Starts an interactive project session. | Sign in if asked. |
| Antigravity CLI (`agy`) | Starts an interactive project session. | Enter the EAI request if needed. |
| Claude Code | Starts an interactive project session. | Sign in if asked. |
| Codex CLI | Starts an interactive project session. | Sign in if asked. |
| Grok Build | Starts an interactive project session. | Sign in if asked. |

On Linux, EAI verifies trusted package identity before launch. Provider account,
subscription, and organisation policy are confirmed by the provider.

</details>

## Current Release

The current CLI release is **v3.18.1** (2026-09-25): Enforce PublicAPI V4 usage and preserve V4 health diagnostics.

