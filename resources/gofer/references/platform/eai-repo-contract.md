# EAI Repo Contract

Use this file when a repository is already initialized from the EAI app
template, or when Gofer is about to initialize one.

## Purpose

This is the repo-owned fallback contract for any AI agent working in an
EAI-oriented repository. It defines the minimum safe behavior even when live
docs are unavailable.

Treat this file and the adjacent fallback references as repo-owned guidance in
the same trust boundary as `AGENTS.md`, `CLAUDE.md`, and other checked-in
instruction files. They are not a cryptographic proof of external platform
state.

## Detecting An EAI Repo

Treat the repo as EAI-initialized when either of these marker sets exists:

- both `src/eai.config/object-types.ts` and `src/eai.config/register.ts`
- `manifest.yml` together with the `src/eai.config/` directory

The broader EAI app shape often also includes `.env.example`, `.npmrc`, and a
template-owned `package.json`, but those are supporting signals rather than the
primary identification markers.

## Mandatory First Actions

Before app-delivery research, planning, implementation, or validation:

1. Read `.specify/specs/{feature}/eai-preflight.md` when it exists.
2. Read `.specify/references/platform/eai-error-catalog.yaml`.
3. If CLI, login, tenant, template, or Gofer readiness is missing or stale,
   run `/gofer:eai-first-run`.
4. Use current CLI discovery instead of memory:
   - `eai update --check`
   - `eai --describe`
   - `eai whoami`
   - `eai tenant list --format json`
5. When the repo is an EAI project, check drift before further build work:
   - `eai template check --format json`
   - `eai gofer refresh --check --format json`
   - `eai workflow readiness --format json` when advertised by the CLI

## Stack Policy

For application delivery:

1. EAI Platform first, including the EAI app template.
2. Azure second, where it fits the documented EAI operating model.
3. Everything else only by explicit exception recorded in the feature artifacts.

Do not silently replace an unavailable EAI capability with a non-EAI primary
runtime, database, or hosting stack.

## Ordered App-Delivery Gates

Unless the live CLI advertises a different authoritative dependency, preserve
this gate order:

1. Template init or verify current template ownership
2. Dependency install
3. Login and tenant selection
4. App list/create/select
5. `eai vertical provision`
6. `eai provision entra` when required
7. `eai env pull` when required
8. `eai types validate`
9. `eai types seed`
10. `eai types diff`
11. `eai resources schema`
12. Storage diagnostics and verification
13. Workflow readiness and resource-call verification
14. Preview or dev startup

Treat these as separate gates:

- provisioning
- object-type publish
- schema/storage health
- workflow readiness
- preview readiness

## Error Recovery Rule

When an EAI CLI or platform command fails:

1. Match the failure against `.specify/references/platform/eai-error-catalog.yaml`.
2. Record the last completed gate, blocked gate, and next recovery command in
   `.specify/specs/{feature}/eai-preflight.md`.
3. Do not invent a new order or mark the repo ready when a prior gate is still
   blocked.

## Privacy And Safety

- Do not record tokens, secrets, or `.env.local` values in Gofer artifacts.
- Record tenant and app state in product-safe labels only.
- Keep repo-owned fallback references public-safe and non-sensitive.
