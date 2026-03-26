---
feature: 'cli-first-party-auth'
created: '2026-03-26T06:58:40.000Z'
discoveredBy: Claude + User
status: complete
---

# Business Discovery: cli-first-party-auth

## Problem Statement

**Pain Point**: `eai login` requires a `ENTRA_CLIENT_ID` to be set in `.env.local`
or passed via `--client-id` before authentication can succeed. A brand new user
who just installed the CLI cannot log in without first obtaining and configuring
their own App Registration — a friction-heavy, developer-hostile experience.

**Current State**: The CLI reads `clientId` from `.env.local` → `ENTRA_CLIENT_ID`
→ `--client-id` flag. If none are found, it exits with an error. There is no
hardcoded fallback.

**Impact**: Every new user hits an error on first `eai login`. This is a
significant onboarding barrier that breaks the "install and go" experience.

## Target Users

### Primary Users
- **Persona**: Any developer who has installed `@eai-tools/cli`
- **Technical Level**: Varies — from beginners to senior engineers
- **Key Needs**: `eai login` should just work after installation with no config

## Value Proposition

**Primary Value**: Zero-config authentication — install the CLI, run `eai login`,
done. Identical UX to `az login` or `gh auth login`.

**Quantified Goal**: Reduce time-to-first-successful-login from "requires setup
steps + App Registration knowledge" to "under 30 seconds from install".

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Steps to first login | 1 (`eai login`) | Manual test |
| Config required before login | 0 | Code review |
| `ENTRA_CLIENT_ID` references removed | All | Grep codebase |

## Competitive Analysis

**Status**: Researched (from conversation context)

- **`az login`**: Ships with Microsoft's own hardcoded client ID `04b07795-8542-4aa3-0786-83349992f3b4`. All users share this registration.
- **`gh auth login`**: Same pattern — GitHub CLI has its own hardcoded OAuth App ID.
- **Pattern**: First-party CLIs always own their App Registration; users provide only their identity credentials.

## Discovery Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Override support | Removed | User chose hardcoded only — clean, simple, no escape hatches |
| Approach | First-party registration | EAI registers the CLI as its own app in the CIAM tenant |
| ENTRA_CLIENT_ID in init | Remove | No longer needed — removes confusion for new projects |
