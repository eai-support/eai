---
generated: false
title: EAI Setup
---

# EAI Setup

**Recommended for most people.** Use EAI Setup to prepare a supported desktop
computer and create your first EAI project.

You need about 10 minutes. You approve system prompts and complete browser
sign-in yourself.

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

## Complete Setup

1. Download and open EAI Setup.
2. Sign in in your browser, or create an EAI account.
3. Name your project and choose where to save it.

EAI Setup prepares the required tools, creates the project, installs its
dependencies, and helps you choose an AI workspace. When it finishes, open the
project folder it shows you.

## What EAI Setup Installs

<details>
<summary>Show setup details</summary>

EAI Setup detects or installs Git, Node.js 24, npm, and the EAI CLI. It also
installs the supported Gofer assets and app template during project creation.

It does not collect EAI passwords, tenant secrets, or AI-provider credentials.
You approve operating-system permissions and browser sign-in yourself.
</details>

## Use Manual CLI Setup Instead

Use the manual route when you work in CI, have a managed developer computer, or
want to control each terminal command. See [Manual and Managed Setup](./manual-and-managed-setup.md).
