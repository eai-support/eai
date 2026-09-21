---
generated: true
generated_at: "2026-09-21T22:03:01.864Z"
source_commit: "8bc76a23ee69066b54726e8040fa51cadde58e6b"
---
# EnterpriseAI CLI

## Executive Summary

The EnterpriseAI CLI (`eai`) is a Node.js command-line tool for scaffolding,
authenticating, configuring, validating, deploying, and operating EAI
applications. It is a client-side tool, not a continuously running service:
the principal blast radius is the signed-in user's tenant and any local project
files or credentials the invoked command can modify.

| Attribute | Verified value |
|---|---|
| Service name | `@enterpriseai/cli` (`eai`) |
| Primary capability | Guided EAI app setup and authenticated platform operations |
| Primary users or consumers | Application developers, tenant administrators, CI agents, and AI coding agents |
| Data sensitivity | High for access tokens, tenant identifiers, user/member data, and uploaded document content; source package is public |
| Current status | Active public npm package; version `3.16.0` in `package.json` |
| Last material change | 2026-09-18 release documentation identifies template scaffolding pinned to published releases |

The CLI is invoked locally with Node.js 24 or newer. It calls regional EAI
PublicAPI v4 endpoints, uses Entra CIAM for browser-based PKCE login, and can
write project-local configuration, generated app assets, Gofer assets, and
deployment workflow files.

## Tech Stack

| Area | Implementation |
|---|---|
| Language | TypeScript, emitted as ESM JavaScript |
| CLI framework | Commander 15 |
| Runtime | Node.js >=24 |
| Authentication | Entra CIAM authorization-code flow with PKCE; encrypted local token file |
| HTTP | Native `fetch` through `src/lib/api.ts` |
| Local state | JSON files under `~/.eai`; optional project `.env.local` |
| Tests | Vitest 4, MSW integration mocks |
| Build and quality | TypeScript compiler, ESLint 10, public-hygiene and API-reference checks |
| Documentation | Docusaurus 3 site sourced from `.tech-docs/` and `docs-site/scenarios/` |
| Distribution | npm (`@enterpriseai/cli` and `eai-cli` alias), GitHub Releases, static registry fallback |

## Entry Points and Local Use

| Entry point | Purpose |
|---|---|
| `src/index.ts` | Commander program, global flags, command registration, help footer |
| `src/commands/` | User-facing command handlers (`create`, `login`, `tenant`, `resources`, `deploy`, and others) |
| `src/lib/api.ts` | Typed PublicAPI v4 client and domain operations |
| `src/lib/auth.ts` | PKCE login, token refresh, encrypted token persistence |
| `package.json` `bin.eai` | Published executable, resolved to `dist/index.js` |

```bash
npm ci
npm run build
node dist/index.js --help
```

For a consumer installation:

```bash
npm install -g eai-cli
eai create my-app
cd my-app
eai login
eai verify
eai dev
```

## Ownership

The package metadata identifies the author as **EAI Tools** and the repository
as `eai-support/eai`. A more specific operational owner is not determined from
the repository.

## Critical Integrations

1. **EAI PublicAPI v4** — regional, authenticated platform contract for
   identity, tenants, users, resource schemas and CRUD, documents, AI chat,
   workflows, integrations, geo, realtime, webhooks, and app provisioning.
2. **Entra CIAM** — browser authorization and token exchange for `eai login`;
   the CLI uses PKCE and a localhost callback.
3. **npm and GitHub Releases** — package publication, provenance, versioned
   tarballs, and the static registry fallback.
4. **EAI App Template and Gofer assets** — scaffolding and AI-workflow assets
   copied or refreshed by `eai create`, `eai init`, and `eai gofer refresh`.
5. **GitHub Actions** — CI, documentation deployment, release publication, and
   optional cross-repository test dispatch.

## Documentation Surfaces

| Path | Purpose | Publishing workflow | Central tech-docs nightly pipeline |
|---|---|---|---|
| `.tech-docs/` | Canonical architecture and operational documentation generated for this repository | Consumed directly by `docs-site` Docusaurus build | No separate nightly pipeline was found; covered on push by `.github/workflows/docs.yml` |
| `docs-site/` | Docusaurus site configuration, theme, static release/registry assets, and scenario package | `.github/workflows/docs.yml` builds and deploys GitHub Pages; it can also open a website sync PR | Covered by the repository docs workflow, not a nightly schedule |
| `docs-site/scenarios/` | Industry and business scenario content | Included by the same Docusaurus build | Covered by the repository docs workflow, not a nightly schedule |
| `README.md` | Public installation and quick-start guide | Maintained in the repository; not a generated site source | No central nightly coverage found |

`docs-site/docusaurus.config.js` excludes the generated architecture,
overview, data-model, deployment, dependencies, and review pages from the
public site navigation while keeping `.tech-docs/` as the source directory.

## Current Status

- Nightly-managed `.tech-docs/` content is present for this repository.
- Source commit: `8bc76a23ee69`
- Additional repo-local docs surfaces detected: 1
