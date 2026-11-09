---
generated: false
title: Manual and Managed Setup
---

# Manual And Managed Setup

Use this route only when EAI Setup is not suitable for your environment.

## Use This Route When

- You set up CI or automation.
- Your organisation manages developer devices.
- Your network requires a proxy or private package registry.
- You need to approve each installed tool and command.

## Choose The Right Guide

| Need | Guide |
| --- | --- |
| Install and operate the CLI yourself | [EAI CLI](./eai-cli.md) |
| Connect an existing application | [EAI App Template](./eai-app-template.md) |
| Configure CLI environment and registry settings | [Configuration](./configuration.md) |
| Prepare an AI coding workspace | [eai-gofer](./eai-gofer.md) |
| Resolve a setup problem | [Error Guidance](./error-guidance.md) |

## Manual Project Creation

After you install the CLI, use `eai create <project-name>` for the guided
terminal path. Use `eai init <project-name>` when you need lower-level scaffold
control.

Do not store tenant IDs, secrets, endpoint URLs, or cloud credentials in source
control.
