---
feature: CLI Packaging, Distribution & World-Class Documentation Site
spec: spec.md
research: research.md
status: complete
created: 2026-03-09
completedAt: 2026-03-09
---

# Implementation Plan: CLI Packaging & Documentation

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Summary

Deliver a production-ready EAI CLI package, world-class documentation site, and 50 developer scenarios. This plan is organized into 5 phases: IP sanitization (P0), packaging/CI (P1), documentation site foundation (P2), scenarios/examples content (P2), and distribution expansion (P3).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict mode, ESM)
**CLI Framework**: Commander.js 13.x
**Doc Site Generator**: Starlight (Astro)
**CI/CD**: GitHub Actions
**Package Registry**: npm (public, scoped @eai-tools)
**Target Platform**: Node.js 20+, GitHub Pages
**Testing**: TypeScript compilation, ESLint
**Constraints**: No internal IP in any published artifact

### Integration Points

| Component | File | Integration Type |
|-----------|------|------------------|
| CLI version | `src/index.ts:8` | Modify to read from package.json |
| Org references | `src/lib/config.ts:96-97` | Update dependency names |
| Org references | `src/commands/verify.ts:252,258` | Update dependency names |
| Org references | `src/commands/init.ts:618` | Update generated example |
| IP in generated CLAUDE.md | `src/commands/init.ts:580-672` | Rewrite to remove internals |
| IP in verify output | `src/commands/verify.ts:79-117` | Neutral error messages |
| IP in types output | `src/commands/types.ts` | Remove "Configurator" references |
| IP in tenant output | `src/commands/tenant.ts` | Remove "Configurator" references |
| IP in index help | `src/index.ts` | Remove internal service names |
| IP in README | `README.md` | Rewrite without internals |
| Package metadata | `package.json` | Add license, repo, homepage, publishConfig |
| npm exclusions | `.npmignore` (new) | Exclude internal docs |
| CI workflow | `.github/workflows/ci.yml` (new) | Build/lint/typecheck on PR |
| Release workflow | `.github/workflows/release.yml` (new) | Publish on tag |
| Docs workflow | `.github/workflows/docs.yml` (new) | Deploy docs on push |
| Docs site | `docs/` (new Starlight project) | Documentation site |

## Project Structure

### Source Code (modifications to existing)

```text
src/
├── index.ts                    # MODIFY: dynamic version, remove IP
├── commands/
│   ├── init.ts                 # MODIFY: rewrite generated CLAUDE.md, update org
│   ├── verify.ts               # MODIFY: neutral error messages, update org
│   ├── types.ts                # MODIFY: remove "Configurator" references
│   └── tenant.ts               # MODIFY: remove "Configurator" references
└── lib/
    ├── api.ts                  # MODIFY: consider making orchestrate private
    ├── config.ts               # MODIFY: update @enterpriseaigroup → @eai-tools
    └── output.ts               # NO CHANGE
```

### New Files

```text
.npmignore                      # NEW: exclude docs/, .specify/, .github/
.github/workflows/
├── ci.yml                      # NEW: build/lint/typecheck on PR
├── release.yml                 # NEW: npm publish + GitHub Release on tag
└── docs.yml                    # NEW: build & deploy docs to GitHub Pages
docs/                           # NEW: Starlight documentation site
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── public/
│   ├── llms.txt                # AI agent documentation index
│   └── llms-full.txt           # Complete docs for AI agents
└── src/
    └── content/docs/
        ├── index.mdx           # Landing page
        ├── getting-started/    # 4 pages
        ├── guides/             # 8 pages
        ├── concepts/           # 5 pages
        ├── reference/          # commands/, schema, API, env vars, errors
        ├── examples/           # 7 language pages
        └── scenarios/          # 10 industry dirs, 50 scenario pages
```

---

## Implementation Phases

### Phase 1: IP Sanitization & Org Updates (P0)

**Goal**: Remove all internal IP from public-facing code and update organization references. This MUST complete before any publishing.

**Tasks**:

- [ ] **1.1** Update `src/lib/config.ts:96-97`: Change `@enterpriseaigroup/platform-sdk` and `@enterpriseaigroup/core` to `@eai-tools/platform-sdk` and `@eai-tools/core`
- [ ] **1.2** Update `src/commands/verify.ts:252,258`: Change `@enterpriseaigroup/platform-sdk` references to `@eai-tools/platform-sdk`
- [ ] **1.3** Update `src/commands/init.ts:618`: Change `@enterpriseaigroup/platform-sdk` import example to `@eai-tools/platform-sdk`
- [ ] **1.4** Rewrite `src/commands/init.ts:580-672` (generated CLAUDE.md): Remove all internal service names (Configurator, ResourceAPI, AICore, OPA, JSONB). Replace architecture diagram with simplified public-only version:
  ```
  Browser → Next.js App → BFF Proxy → EAI Platform API
  ```
  Remove PostgreSQL/JSONB references from generated object-types.ts comments (line 297)
- [ ] **1.5** Update `src/commands/verify.ts:79-117`: Replace error messages — "Configurator" → "platform service", "ResourceAPI" → "data service"
- [ ] **1.6** Update `src/commands/types.ts`: Replace all user-facing "Configurator" references with "platform" (command descriptions, spinner text, success messages)
- [ ] **1.7** Update `src/commands/tenant.ts`: Replace "Configurator" references with "platform"
- [ ] **1.8** Update `src/index.ts`: Remove any Configurator/internal service references from help text
- [ ] **1.9** Rewrite `README.md:5,141`: Remove mentions of OBO tokens, OPA policies, JSONB, orchestrator. Focus on capabilities, not implementation
- [ ] **1.10** Update `src/lib/config.ts:67`: Change `storageBackend: 'postgresql' | 'cosmosdb'` to `storageBackend?: string` or remove entirely from public interface
- [ ] **1.11** Update generated Object Types scaffold (`src/commands/init.ts:441,481`): Remove `storageBackend: 'postgresql'` from scaffold, or use neutral value
- [ ] **1.12** Consider making `api.ts:orchestrate()` method not expose `target_backend` types publicly. At minimum, ensure the type `'payload' | 'mid' | 'resources'` is not in any published `.d.ts` file

**Verification**:

- [ ] `grep -r "Configurator" src/` returns only internal method bodies (not user-facing strings)
- [ ] `grep -r "ResourceAPI\|AICore" src/` returns zero user-facing matches
- [ ] `grep -r "enterpriseaigroup" src/` returns zero matches
- [ ] `grep -r "JSONB\|OPA\|OBO\|PayloadCMS\|HyPE\|RLS" src/` returns zero user-facing matches
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] Run `eai --help` and verify no internal terms appear
- [ ] Generated CLAUDE.md from `eai init test-project` contains no internal service names

---

### Phase 2: Packaging & npm Publishing (P1)

**Goal**: Make the CLI installable via npm and npx with proper metadata.

**Tasks**:

- [ ] **2.1** Update `package.json`:
  - Add `"license": "MIT"` (or user's choice)
  - Add `"repository": { "type": "git", "url": "https://github.com/eai-tools/eai-cli.git" }`
  - Add `"homepage": "https://eai-tools.github.io/eai-cli"`
  - Add `"bugs": { "url": "https://github.com/eai-tools/eai-cli/issues" }`
  - Add `"publishConfig": { "access": "public" }`
  - Add `"keywords": ["cli", "enterprise", "ai", "vertical", "platform", "eai"]`
  - Update `"files"` to remove non-existent `"templates"` — set to `["dist"]`
  - Add `"prepublishOnly": "npm run build && npm run lint"`
- [ ] **2.2** Fix version management in `src/index.ts`: Read version from package.json at runtime instead of hardcoded string. Use `import { readFileSync } from 'fs'` or `import pkg from '../package.json' with { type: 'json' }` (Node.js 20+ supports JSON import assertions)
- [ ] **2.3** Create `.npmignore`:
  ```
  src/
  docs/
  .specify/
  .github/
  .claude/
  .vscode/
  CLAUDE.md
  AGENTS.md
  tsconfig.json
  *.tsbuildinfo
  .gitignore
  .DS_Store
  ```
- [ ] **2.4** Create `LICENSE` file (MIT license with proper copyright)
- [ ] **2.5** Regenerate `package-lock.json` with `npm install` to pick up new package name
- [ ] **2.6** Test packaging: run `npm pack` and inspect tarball contents — verify only `dist/`, `package.json`, `README.md`, `LICENSE` are included
- [ ] **2.7** Test npx: verify `npx @eai-tools/cli --version` works (may need to test after publish)

**Verification**:

- [ ] `npm pack --dry-run` shows only intended files
- [ ] `npm publish --dry-run` succeeds without errors
- [ ] Version in `eai --version` matches package.json
- [ ] No internal files (src/, docs/, .specify/) in the tarball

---

### Phase 3: CI/CD & Release Automation (P1)

**Goal**: Automated build/lint/test on PRs, automated npm publish and GitHub Release on version tags.

**Tasks**:

- [ ] **3.1** Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI
  on:
    pull_request:
      branches: [main]
    push:
      branches: [main]
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npm ci
        - run: npm run build
        - run: npm run lint
        - run: npm run typecheck
  ```

- [ ] **3.2** Create `.github/workflows/release.yml`:
  - Trigger on tag push matching `v*`
  - Build the project
  - Publish to npm using `NPM_TOKEN` secret
  - Create GitHub Release with auto-generated changelog from conventional commits
  - Upload `dist/` as release artifact

- [ ] **3.3** Create `.github/workflows/docs.yml`:
  - Trigger on push to `main` when `docs/**` files change
  - Setup Node.js, install docs dependencies
  - Build Starlight site (`cd docs && npm run build`)
  - Deploy to GitHub Pages using `actions/deploy-pages@v4`

- [ ] **3.4** Document GitHub repository settings needed:
  - Enable GitHub Pages (source: GitHub Actions)
  - Add `NPM_TOKEN` as repository secret
  - Branch protection rules for main

**Verification**:

- [ ] CI workflow runs on a test PR
- [ ] CI catches build failures (test with intentional error)
- [ ] Release workflow publishes on tag push (test with `v0.2.0-beta.1`)
- [ ] Docs workflow deploys to GitHub Pages

---

### Phase 4: Documentation Site Foundation (P2)

**Goal**: Create the Starlight documentation site with core pages — getting started, guides, concepts, command reference.

**Tasks**:

- [ ] **4.1** Initialize Starlight project in `docs/`:
  ```bash
  cd docs && npm create astro@latest -- --template starlight
  ```
  Configure `astro.config.mjs` with:
  - Site URL: `https://eai-tools.github.io/eai-cli`
  - Base path: `/eai-cli`
  - Sidebar navigation matching the IA from spec
  - Social links (GitHub)
  - Expressive Code for multi-language tabs
  - Mermaid diagram support

- [ ] **4.2** Create landing page (`docs/src/content/docs/index.mdx`):
  - Hero with value proposition
  - Installation command (tabbed: npm, npx, brew)
  - Quick feature overview
  - Links to Getting Started and Scenarios

- [ ] **4.3** Create Getting Started section (4 pages):
  - `installation.mdx` — npm, npx, Homebrew, from source. Prerequisites (Node.js 20+)
  - `quickstart.mdx` — 5-minute tutorial: init → login → types validate → types seed → dev
  - `authentication.mdx` — Device code flow explanation, token management, logout
  - `first-vertical.mdx` — Build a complete mini-vertical from scratch

- [ ] **4.4** Create Guides section (8 pages):
  - `object-types.mdx` — Defining data models with properties, links, actions, side effects
  - `resources.mdx` — CRUD operations, querying, pagination, filtering
  - `environment.mdx` — Env pull/push/list, Azure App Config integration
  - `deployment.mdx` — Deploy setup, trigger, status, CI/CD with GitHub Actions
  - `ai-features.mdx` — Chat (send/stream), documents (upload/classify/index), RAG
  - `multi-tenant.mdx` — Tenant create/list/info, multi-tenant patterns
  - `security.mdx` — Authentication, roles (tenant-user/staff/admin), access control
  - `troubleshooting.mdx` — Common issues, `eai doctor`, `eai verify`

- [ ] **4.5** Create Concepts section (5 pages):
  - `platform-overview.mdx` — What is EnterpriseAI? (public-only, no IP)
  - `verticals.mdx` — What are vertical applications? Industry examples
  - `architecture.mdx` — Public architecture only: CLI → Platform API → Resources/Chat/Documents
  - `data-model.mdx` — Object Types as the core abstraction, field types, relationships
  - `security-model.mdx` — Roles, tenants, data isolation (no OPA/RLS details)

- [ ] **4.6** Create Command Reference section:
  - Auto-generate or manually create a page for each command group (init, login, env, types, resources, tenant, chat, docs, deploy, verify, whoami, dev)
  - Each page: synopsis, description, options/flags table, examples with expected output
  - Include `eai doctor` in diagnostics reference

- [ ] **4.7** Create Reference pages:
  - `object-type-schema.mdx` — Full Object Type specification (field types, link types, actions, side effects)
  - `api-surface.mdx` — Public API endpoints, request/response formats
  - `environment-vars.mdx` — All environment variables with descriptions
  - `error-codes.mdx` — Common errors and resolution steps

- [ ] **4.8** Create Glossary page (`glossary.mdx`):
  - All platform terminology defined in plain English
  - Cross-linked from other pages

- [ ] **4.9** Create `/llms.txt` and `/llms-full.txt`:
  - `llms.txt` — Structured navigation with links to all documentation pages
  - `llms-full.txt` — Script or build step that concatenates all documentation into a single markdown file for AI agent consumption

- [ ] **4.10** Ensure progressive disclosure throughout:
  - Every concept page starts with plain English before code
  - Collapsible "Learn More" sections for advanced topics via Starlight's `<details>` or Aside components
  - Prerequisites box at top of each guide
  - Beginner/Advanced tabs where appropriate

**Verification**:

- [ ] `cd docs && npm run build` succeeds
- [ ] `npm run preview` shows functional site with navigation, search, dark mode
- [ ] Every page passes content review: no IP leakage, progressive disclosure, code examples with copy buttons
- [ ] Search finds commands, concepts, and guides
- [ ] `/llms.txt` is accessible and structured correctly
- [ ] Mobile layout works
- [ ] Lighthouse score > 90

---

### Phase 5: Scenarios, Examples & Content (P2)

**Goal**: Create 50 developer scenarios and multi-language code examples.

**Tasks**:

- [ ] **5.1** Create scenario template structure:
  - Each scenario as its own `.mdx` file in `docs/src/content/docs/scenarios/{industry}/`
  - Template: persona, business problem, Object Types (table), CLI workflow (step-by-step), code examples (tabbed), architecture diagram (Mermaid), key takeaways

- [ ] **5.2** Create Healthcare scenarios (5):
  - `patient-intake.mdx`, `clinical-trials.mdx`, `telemedicine.mdx`, `pharmacy-inventory.mdx`, `mental-health.mdx`
  - Each with 3-8 Object Types, full property/link/action definitions

- [ ] **5.3** Create Finance scenarios (5):
  - `kyc-verification.mdx`, `loan-processing.mdx`, `transaction-monitoring.mdx`, `insurance-claims.mdx`, `portfolio-management.mdx`

- [ ] **5.4** Create Government scenarios (5):
  - `planning-permits.mdx`, `citizen-services.mdx`, `regulatory-compliance.mdx`, `public-records.mdx`, `grant-management.mdx`

- [ ] **5.5** Create Retail scenarios (5):
  - `product-compliance.mdx`, `loyalty-program.mdx`, `inventory-management.mdx`, `ecommerce-returns.mdx`, `supplier-onboarding.mdx`

- [ ] **5.6** Create Education scenarios (5):
  - `course-management.mdx`, `admissions-portal.mdx`, `learning-analytics.mdx`, `accreditation.mdx`, `research-grants.mdx`

- [ ] **5.7** Create Real Estate scenarios (5):
  - `property-management.mdx`, `lease-management.mdx`, `maintenance-requests.mdx`, `property-inspection.mdx`, `real-estate-crm.mdx`

- [ ] **5.8** Create Manufacturing scenarios (5):
  - `quality-control.mdx`, `production-tracking.mdx`, `defect-management.mdx`, `supply-chain.mdx`, `equipment-maintenance.mdx`

- [ ] **5.9** Create Legal scenarios (5):
  - `contract-review.mdx`, `case-management.mdx`, `compliance-monitoring.mdx`, `e-discovery.mdx`, `billing-time-tracking.mdx`

- [ ] **5.10** Create Non-Profit scenarios (5):
  - `beneficiary-tracking.mdx`, `donor-management.mdx`, `volunteer-coordination.mdx`, `impact-measurement.mdx`, `grant-reporting.mdx`

- [ ] **5.11** Create Logistics scenarios (5):
  - `shipment-tracking.mdx`, `route-optimization.mdx`, `warehouse-management.mdx`, `fleet-management.mdx`, `last-mile-delivery.mdx`

- [ ] **5.12** Create Examples section (7 language pages):
  - `typescript.mdx` — Platform SDK usage, resource CRUD, chat, types
  - `python.mdx` — requests/httpx patterns for all operations
  - `csharp.mdx` — HttpClient patterns
  - `java.mdx` — HttpClient patterns
  - `go.mdx` — net/http patterns
  - `rust.mdx` — reqwest patterns
  - `shell.mdx` — curl commands for all operations
  - Each page: auth, create resource, list resources, query, chat integration

- [ ] **5.13** Review all 50 scenarios for IP compliance:
  - No internal service names
  - No storage implementation details
  - No authentication flow internals
  - Object Type definitions use only public schema format

**Verification**:

- [ ] Count 50 scenario files across 10 industry directories
- [ ] Each scenario has: persona, Object Types, CLI workflow, 3+ language examples
- [ ] `eai types validate` passes on each scenario's Object Types (or documented as conceptual)
- [ ] All 7 language example pages have complete code for core operations
- [ ] Zero IP leakage in any scenario or example

---

### Phase 6: Distribution Expansion (P3)

**Goal**: Homebrew tap and GitHub Releases with downloadable artifacts.

**Tasks**:

- [ ] **6.1** Create Homebrew tap repository `eai-tools/homebrew-tap`:
  - Create Formula/eai.rb with npm-based installation
  - Add CI workflow to test formula
  - Document `brew install eai-tools/tap/eai` in docs

- [ ] **6.2** Enhance release workflow to create GitHub Releases with:
  - Changelog from conventional commits
  - npm tarball as downloadable asset
  - Installation instructions in release notes

- [ ] **6.3** Update documentation installation page with all distribution channels:
  - npm (primary)
  - npx (zero-install)
  - Homebrew (macOS/Linux)
  - From source (contributors)
  - GitHub Releases (binary)

**Verification**:

- [ ] `brew install eai-tools/tap/eai` installs and `eai --version` works
- [ ] GitHub Release includes changelog and downloadable assets
- [ ] All installation methods documented in docs

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| npm scope `@eai-tools` not available | High | Low | Check availability early; fallback to `@eai-tools-cli` |
| IP accidentally exposed in docs content | High | Medium | Automated grep check in CI for forbidden terms |
| 50 scenarios take longer than expected | Medium | High | Start with 10 (from existing research.md), iterate |
| Starlight breaking changes | Low | Low | Pin Astro/Starlight versions |
| GitHub Pages not enabled | Medium | Low | Document setup steps clearly |
| Vertical-Template repo is private | Low | Medium | Note access requirements in docs |
| Object Types in scenarios don't validate | Medium | Medium | Run validation as part of CI; mark conceptual if needed |

## Notes

- Phase 1 must complete fully before Phase 2 begins (IP is a hard blocker)
- Phases 2 and 3 can be done in parallel
- Phase 4 can begin as soon as Phase 1 completes
- Phase 5 (content) can begin in parallel with Phase 4 (site structure)
- Phase 6 is independent and can be deferred
- The 50 scenarios are the largest content effort — consider batching by industry (5 at a time)
- Each scenario should be independently reviewable and publishable
- The `docs/research.md` file (existing) must NOT be part of the new documentation site — it's internal IP

---

## Spec Traceability

### User Story Coverage

| Story | Priority | Plan Phase(s) | Components |
|-------|----------|---------------|------------|
| US1: IP Sanitization | P0 | Phase 1 | Tasks 1.1-1.12 |
| US2: npm Publishing | P1 | Phase 2 | Tasks 2.1-2.7 |
| US3: CI/CD Automation | P1 | Phase 3 | Tasks 3.1-3.4 |
| US4: Documentation Site | P2 | Phase 4 | Tasks 4.1-4.10 |
| US5: 50 Scenarios | P2 | Phase 5 | Tasks 5.1-5.13 |
| US6: Multi-Language Examples | P2 | Phase 5 | Task 5.12 |
| US7: Homebrew | P3 | Phase 6 | Task 6.1 |
| US8: GitHub Releases | P3 | Phase 6 | Task 6.2 |

### Requirement Coverage

| Requirement | Plan Phase | Task(s) |
|-------------|-----------|---------|
| FR-001: Remove internal service names | Phase 1 | 1.4-1.8 |
| FR-002: Hide orchestrate exposure | Phase 1 | 1.12 |
| FR-003: Remove storage tech references | Phase 1 | 1.4, 1.10, 1.11 |
| FR-004: Remove auth/policy references | Phase 1 | 1.9 |
| FR-005: Update org references | Phase 1 | 1.1-1.3 |
| FR-006: Exclude research.md from npm | Phase 2 | 2.3 |
| FR-007: Package.json metadata | Phase 2 | 2.1 |
| FR-008: Dynamic version | Phase 2 | 2.2 |
| FR-009: Fix files field | Phase 2 | 2.1 |
| FR-010: prepublishOnly script | Phase 2 | 2.1 |
| FR-011: npx support | Phase 2 | 2.7 |
| FR-012: CI on PRs | Phase 3 | 3.1 |
| FR-013: Release on tag | Phase 3 | 3.2 |
| FR-014: Docs on push | Phase 3 | 3.3 |
| FR-015: Starlight + GitHub Pages | Phase 4 | 4.1 |
| FR-016: Pagefind search | Phase 4 | 4.1 (built-in) |
| FR-017: llms.txt | Phase 4 | 4.9 |
| FR-018: Progressive disclosure | Phase 4 | 4.10 |
| FR-019: Code blocks with tabs | Phase 4 | 4.1 (Expressive Code) |
| FR-020: Command reference | Phase 4 | 4.6 |
| FR-021: Glossary | Phase 4 | 4.8 |
| FR-022: 50 scenarios | Phase 5 | 5.2-5.11 |
| FR-023: Scenario completeness | Phase 5 | 5.1 (template) |
| FR-024: Object Types validate | Phase 5 | 5.13 |
| FR-025: No IP in scenarios | Phase 5 | 5.13 |
| FR-026: 7 languages | Phase 5 | 5.12 |
| FR-027: Language example coverage | Phase 5 | 5.12 |
| FR-028: Homebrew tap | Phase 6 | 6.1 |
| FR-029: GitHub Release artifacts | Phase 6 | 6.2 |

**Coverage**: 100% of user stories (8/8), 100% of functional requirements (29/29)
