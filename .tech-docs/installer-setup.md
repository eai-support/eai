---
generated: false
title: EAI Setup
---

**Recommended for most people.** Use EAI Setup to prepare a supported desktop
computer and create your first EAI project.

You need about 10 minutes. You approve system prompts and complete browser
sign-in yourself.

## Download EAI Setup

Each download is a published release asset, not a temporary GitHub Actions
artifact. Check the [release notes](https://github.com/eai-support/eai-installer/releases/latest)
for current support and signing information.

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
