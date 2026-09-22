---
generated: false
title: EAI Setup
---

# EAI Setup

**Recommended for most desktop users.** EAI Setup prepares a Windows, macOS, or
Ubuntu/Debian computer for the first EAI project. It keeps setup in a guided
desktop window instead of asking you to assemble tools in a terminal.

## What It Does

EAI Setup detects or installs Git, Node.js 24, npm, and the EAI CLI. It then
opens browser sign-in, lets you select a project folder, creates the project,
installs its dependencies, and helps you open it in a supported AI workspace.

It does not collect EAI passwords, tenant secrets, or AI-provider credentials.
You approve operating-system permissions and complete browser sign-in yourself.

## Download EAI Setup

Download the package that matches your computer from the official
[EAI Setup releases](https://github.com/eai-support/eai-installer/releases/latest).
These links download published release assets, not temporary GitHub Actions
artifacts.

| Computer | Download |
| --- | --- |
| macOS Apple Silicon | [EAI Setup DMG](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-macos-arm64.dmg) |
| macOS Intel | [EAI Setup DMG](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-macos-x64.dmg) |
| Windows x64 | [EAI Setup installer](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-windows-x64.exe) |
| Windows ARM64 | [EAI Setup installer](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-windows-arm64.exe) |
| Ubuntu/Debian x64 | [EAI Setup package](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-ubuntu-amd64.deb) |
| Ubuntu/Debian ARM64 | [EAI Setup package](https://github.com/eai-support/eai-installer/releases/latest/download/eai-setup-ubuntu-arm64.deb) |

On macOS, open the DMG and move **EAI Setup** to Applications. On Windows and
Ubuntu/Debian, open the downloaded package and follow the operating-system
installer prompts. Check the [release notes](https://github.com/eai-support/eai-installer/releases/latest)
for the current support and signing information.

## What Happens Next

1. Open EAI Setup.
2. Review the detected prerequisites and approve only the required system prompts.
3. Sign in in your browser, or create an EAI account if you do not have one.
4. Choose an existing folder or name a new project folder.
5. Choose an AI workspace, or complete the project and install one later.

EAI Setup uses the normal EAI CLI contract. It installs the supported Gofer
assets and app template as part of project creation. When setup finishes, use
the project folder shown by EAI Setup.

## Use Manual CLI Setup Instead

Use the manual route when you work in CI, have a managed developer computer, or
want to control each terminal command. See [Manual CLI Setup](./eai-cli.md).
