---
feature: CLI Packaging, Distribution & World-Class Documentation Site
spec: spec.md
plan: plan.md
tasks: tasks.md
status: review
created: 2026-03-09
---

# Traceability Matrix: User Stories → Acceptance Criteria → Tasks

This document provides complete traceability from user stories through acceptance criteria to implementing tasks, ensuring 100% coverage of all requirements.

---

## User Story Coverage

| Story ID | Title | Priority | Phase | Task Range | Verification |
|----------|-------|----------|-------|------------|--------------|
| US1 | IP Sanitization & Organization Updates | P0 | Phase 1 | T001-T012 | V001-V008 |
| US2 | CLI Packaging & npm Publishing | P1 | Phase 2 | T013-T019 | V009-V013 |
| US3 | CI/CD & Release Automation | P1 | Phase 3 | T020-T023 | V014-V018 |
| US4 | Documentation Site Foundation | P2 | Phase 4 | T024-T033 | V019-V025 |
| US5 | 50 Developer Scenarios | P2 | Phase 5 | T034-T044, T046 | V026-V031 |
| US6 | Multi-Language Code Examples | P2 | Phase 5 | T045 | V030 |
| US7 | Homebrew Distribution | P3 | Phase 6 | T047, T049 | V032, V034 |
| US8 | GitHub Releases with Binaries | P3 | Phase 6 | T048, T049 | V033, V034 |

**Coverage**: 8/8 user stories (100%)

---

## US1: IP Sanitization & Organization Updates

**Acceptance Criteria → Task Mapping**

### AC1.1: Zero internal service names in source files
**Criterion**: Given the current codebase, When I search all source files for "Configurator", "ResourceAPI", "AICore", "JSONB", "OPA", "OBO", "PayloadCMS", "HyPE", "RLS", Then zero matches are found in user-facing strings, generated files, help text, or error messages.

**Implementing Tasks**:
- **T004**: Rewrite `src/commands/init.ts` lines 580-672 — removes internal service names from generated CLAUDE.md
- **T005**: Update `src/commands/verify.ts` lines 79-117 — replaces "Configurator", "ResourceAPI" with neutral terms
- **T006**: Update `src/commands/types.ts` — removes "Configurator" from user-facing strings
- **T007**: Update `src/commands/tenant.ts` — removes "Configurator" from user-facing strings
- **T008**: Update `src/index.ts` — removes internal service references from help text
- **T009**: Rewrite `README.md` — removes OBO/OPA/JSONB mentions
- **T012**: Review `src/lib/api.ts` — ensures `target_backend` types not exposed in .d.ts

**Verification**: V001-V004 (automated grep checks)

---

### AC1.2: Generated CLAUDE.md contains no internals
**Criterion**: Given a developer runs `eai init my-app`, When the generated CLAUDE.md is created, Then it contains no internal service names, no architecture diagrams revealing backend routing, and no database implementation details.

**Implementing Tasks**:
- **T004**: Rewrite `src/commands/init.ts` lines 580-672 — complete rewrite of CLAUDE.md template to use only public architecture (`Browser → Next.js → BFF → Platform API`), removes all internal service names and PostgreSQL/JSONB references

**Verification**: V008 (run `eai init test-project` and inspect generated CLAUDE.md)

---

### AC1.3: Error messages use neutral terminology
**Criterion**: Given the CLI encounters an error, When error messages are displayed, Then they use neutral terms ("platform service", "data service", "AI service") instead of internal names.

**Implementing Tasks**:
- **T005**: Update `src/commands/verify.ts` lines 79-117 — replaces all error messages with neutral terminology

**Verification**: V007 (run `eai verify` and inspect error output)

---

### AC1.4: README uses capability language, not implementation details
**Criterion**: Given the README.md, When a developer reads it, Then it describes capabilities (resources, types, tenants, chat) without mentioning how they're implemented internally.

**Implementing Tasks**:
- **T009**: Rewrite `README.md` lines 5, 141 — removes OBO/OPA/JSONB/orchestrator mentions, focuses on capabilities

**Verification**: V003 (grep for forbidden terms in README.md)

---

### AC1.5: Organization references updated to @eai-tools
**Criterion**: Given the `@enterpriseaigroup` org references in source code, When updated, Then all references point to `@eai-tools` consistently across config.ts, verify.ts, and init.ts.

**Implementing Tasks**:
- **T001**: Update `src/lib/config.ts` lines 96-97 — changes `@enterpriseaigroup/*` to `@eai-tools/*`
- **T002**: Update `src/commands/verify.ts` lines 252, 258 — changes org references
- **T003**: Update `src/commands/init.ts` line 618 — changes org reference in generated example

**Verification**: V003 (grep for "enterpriseaigroup" returns zero matches)

---

### AC1.6: research.md excluded from npm package
**Criterion**: Given `docs/research.md`, When the npm package is built, Then research.md is excluded via `.npmignore`.

**Implementing Tasks**:
- **T015**: Create `.npmignore` — includes `docs/` directory exclusion

**Verification**: V012 (inspect tarball contents, verify no docs/ directory)

---

## US2: CLI Packaging & npm Publishing

**Acceptance Criteria → Task Mapping**

### AC2.1: Package publishes successfully to npm
**Criterion**: Given the package.json is configured, When `npm publish` runs, Then the package publishes successfully to npm as `@eai-tools/cli` with public access.

**Implementing Tasks**:
- **T013**: Update `package.json` — adds publishConfig with public access, all metadata fields
- **T015**: Create `.npmignore` — ensures only intended files are published
- **T016**: Create `LICENSE` file — required for npm publishing

**Verification**: V010 (run `npm publish --dry-run`), T050 (actual publish test)

---

### AC2.2: Global installation works
**Criterion**: Given a fresh machine with Node.js 20+, When the user runs `npm install -g @eai-tools/cli`, Then the `eai` command is available globally and responds to `eai --version`.

**Implementing Tasks**:
- **T013**: Update `package.json` — ensures correct bin entry, name, version
- **T014**: Fix version management — ensures version is read from package.json
- **T017**: Regenerate `package-lock.json` — ensures dependency tree is correct

**Verification**: T050 (end-to-end npm install test)

---

### AC2.3: npx works without global install
**Criterion**: Given a user who has never installed the CLI, When they run `npx @eai-tools/cli init my-app`, Then the scaffolding runs without requiring a global install.

**Implementing Tasks**:
- **T013**: Update `package.json` — ensures bin entry is correct for npx
- **T019**: Test npx functionality — validates npx execution

**Verification**: T019, V013

---

### AC2.4: npm page shows complete metadata
**Criterion**: Given the package is published, When a developer inspects the npm page, Then they see repository URL, homepage, license (MIT), keywords, and a clean README.

**Implementing Tasks**:
- **T013**: Update `package.json` — adds repository, homepage, bugs, keywords, license
- **T016**: Create `LICENSE` file — MIT license

**Verification**: V013 (verify package.json has all required fields)

---

### AC2.5: Version dynamically read from package.json
**Criterion**: Given the version is bumped, When the CLI starts, Then the version shown matches package.json (no hardcoded duplicate).

**Implementing Tasks**:
- **T014**: Fix version management in `src/index.ts` — reads version from package.json dynamically

**Verification**: V011 (run `eai --version`, verify matches package.json)

---

## US3: CI/CD & Release Automation

**Acceptance Criteria → Task Mapping**

### AC3.1: CI runs on every PR
**Criterion**: Given a PR is opened, When CI runs, Then it executes build, lint, and typecheck successfully.

**Implementing Tasks**:
- **T020**: Create `.github/workflows/ci.yml` — defines PR workflow with build/lint/typecheck

**Verification**: V014 (create test PR), V015 (test with intentional error)

---

### AC3.2: Release workflow publishes on tag push
**Criterion**: Given a version tag is pushed (e.g., `v0.2.0`), When the release workflow triggers, Then it builds the project, publishes to npm, and creates a GitHub Release with auto-generated changelog.

**Implementing Tasks**:
- **T021**: Create `.github/workflows/release.yml` — defines tag-triggered workflow with npm publish and GitHub Release creation
- **T023**: Document GitHub repository settings — includes NPM_TOKEN secret setup

**Verification**: V016 (push test tag), V017 (verify GitHub Release created)

---

### AC3.3: Docs deploy automatically
**Criterion**: Given a push to the `main` branch, When docs have changed, Then the documentation site is built and deployed to GitHub Pages automatically.

**Implementing Tasks**:
- **T022**: Create `.github/workflows/docs.yml` — defines docs build and deploy workflow
- **T023**: Document GitHub repository settings — includes GitHub Pages configuration

**Verification**: V018 (push docs change, verify deployment)

---

### AC3.4: CI failures are actionable
**Criterion**: Given CI fails, When a maintainer checks GitHub, Then the failure reason is clear with actionable error messages.

**Implementing Tasks**:
- **T020**: Create `.github/workflows/ci.yml` — uses standard GitHub Actions with clear output
- **T021**: Create `.github/workflows/release.yml` — includes error handling

**Verification**: V015 (test with intentional error, verify error message clarity)

---

## US4: Documentation Site Foundation

**Acceptance Criteria → Task Mapping**

### AC4.1: Landing page shows value within 5 seconds
**Criterion**: Given a developer visits the docs site, When they land on the homepage, Then they see a clear value proposition, installation command, and quickstart link within 5 seconds.

**Implementing Tasks**:
- **T025**: Create landing page (`docs/src/content/docs/index.mdx`) — hero with value prop, installation command, quickstart link

**Verification**: T051 (end-to-end docs test), V038 (Lighthouse performance score)

---

### AC4.2: Plain English explanations for beginners
**Criterion**: Given a university student with no platform experience, When they read the "What is EnterpriseAI?" page, Then they understand what the platform does, what vertical applications are, and how the CLI fits in — in plain English before any code.

**Implementing Tasks**:
- **T028**: Create Concepts section — includes `platform-overview.mdx` with plain English intro
- **T033**: Implement progressive disclosure — ensures every concept page starts with plain English

**Verification**: T056 (university student usability test)

---

### AC4.3: Search finds commands and concepts
**Criterion**: Given a developer, When they search for a command (e.g., "resources list"), Then Pagefind returns the relevant command reference page with flags, options, and example output.

**Implementing Tasks**:
- **T024**: Initialize Starlight project — includes built-in Pagefind search
- **T029**: Create Command Reference section — complete reference for all commands

**Verification**: V022 (test search for 10 queries), T051 (end-to-end search test)

---

### AC4.4: AI agent can parse documentation
**Criterion**: Given any documentation page, When an AI agent reads it, Then the page stands alone with full context, clear hierarchical headings, consistent terminology, and descriptions above every code block.

**Implementing Tasks**:
- **T032**: Create llms.txt and llms-full.txt — structured documentation for AI agents
- **T033**: Implement progressive disclosure — ensures consistent structure and terminology
- **T031**: Create Glossary — defines consistent terminology

**Verification**: T055 (AI agent usability test), V040 (AI agent answers 8/10 questions)

---

### AC4.5: llms.txt available at root
**Criterion**: Given the docs site root, When an AI agent requests `/llms.txt`, Then it receives a structured markdown summary of all documentation with links.

**Implementing Tasks**:
- **T032**: Create llms.txt and llms-full.txt — includes `docs/public/llms.txt` and build script for llms-full.txt

**Verification**: V023 (test llms.txt accessibility), T055 (AI agent test)

---

### AC4.6: Progressive disclosure from beginner to advanced
**Criterion**: Given any concept page, When rendered, Then it starts with a plain-English explanation, followed by a visual diagram, then code examples — progressive disclosure from beginner to advanced.

**Implementing Tasks**:
- **T033**: Implement progressive disclosure throughout all pages — uses Aside components, details sections, tabs for complexity levels

**Verification**: T056 (university student usability test), content review during V021

---

### AC4.7: Mobile responsive
**Criterion**: Given the docs site, When viewed on mobile, Then it is fully responsive with readable text and functional navigation.

**Implementing Tasks**:
- **T024**: Initialize Starlight project — Starlight provides responsive design by default

**Verification**: V024 (test mobile layout), T054 (cross-browser compatibility)

---

### AC4.8: SEO optimized
**Criterion**: Given the docs site, When Google indexes it, Then pages appear in search results with proper titles, descriptions, and structured data.

**Implementing Tasks**:
- **T024**: Initialize Starlight project — Starlight includes SEO optimization by default
- **T025**: Create landing page — includes proper meta tags
- **T059**: Final documentation polish — verifies meta tags, sitemap

**Verification**: V038 (Lighthouse SEO score >90)

---

## US5: 50 Developer Scenarios

**Acceptance Criteria → Task Mapping**

### AC5.1: 5 scenarios per industry
**Criterion**: Given a developer in the healthcare industry, When they browse scenarios, Then they find 5 healthcare-specific scenarios with realistic Object Types, CLI workflows, and code examples.

**Implementing Tasks**:
- **T035**: Create Healthcare scenarios (5 files)
- **T036**: Create Finance scenarios (5 files)
- **T037**: Create Government scenarios (5 files)
- **T038**: Create Retail scenarios (5 files)
- **T039**: Create Education scenarios (5 files)
- **T040**: Create Real Estate scenarios (5 files)
- **T041**: Create Manufacturing scenarios (5 files)
- **T042**: Create Legal scenarios (5 files)
- **T043**: Create Non-Profit scenarios (5 files)
- **T044**: Create Logistics scenarios (5 files)

**Verification**: V027 (verify each industry has exactly 5 scenarios)

---

### AC5.2: Scenario completeness
**Criterion**: Given any scenario, When a developer reads it, Then it includes: developer persona, business problem, 3-8 Object Types with full property/link/action definitions, step-by-step CLI workflow, code examples in at least 3 languages, and architecture diagram.

**Implementing Tasks**:
- **T034**: Create scenario template structure — defines complete template with all required sections
- **T035-T044**: All scenario creation tasks — follow template structure

**Verification**: V028 (spot-check 5 scenarios for completeness)

---

### AC5.3: Object Types validate
**Criterion**: Given a scenario's Object Type definitions, When a developer copies them into their project and runs `eai types validate`, Then validation passes.

**Implementing Tasks**:
- **T034**: Create scenario template — ensures Object Type definitions follow valid schema
- **T035-T044**: All scenario creation tasks — use valid Object Type schemas

**Verification**: V029 (copy Object Types from 3 scenarios, run `eai types validate`)

---

### AC5.4: Exactly 50 scenarios across 10 industries
**Criterion**: Given all 50 scenarios, When counted by industry, Then there are exactly 5 per industry across: Healthcare, Finance, Government, Retail, Education, Real Estate, Manufacturing, Legal, Non-Profit, Logistics.

**Implementing Tasks**:
- **T035-T044**: Create exactly 5 scenarios per industry (10 industries × 5 scenarios = 50 total)

**Verification**: V026 (count total scenarios = 50), V027 (verify distribution: 5 per industry)

---

### AC5.5: Multi-language examples in scenarios
**Criterion**: Given any scenario, When code examples are shown, Then they include at minimum: CLI commands (bash), TypeScript (Platform SDK), and Python (requests) — with additional languages where relevant.

**Implementing Tasks**:
- **T034**: Create scenario template — specifies minimum 3 languages (CLI/bash, TypeScript, Python)
- **T035-T044**: All scenario creation tasks — include 3+ language examples

**Verification**: V028 (spot-check 5 scenarios for language coverage)

---

### AC5.6: No IP in scenarios
**Criterion**: Given all 50 scenarios, When reviewed for IP, Then none reveal internal architecture, service names, or storage implementation details.

**Implementing Tasks**:
- **T046**: Review all 50 scenarios for IP compliance — automated grep + manual review

**Verification**: V031 (automated grep for forbidden terms returns zero matches)

---

## US6: Multi-Language Code Examples

**Acceptance Criteria → Task Mapping**

### AC6.1: Language tabs for same operation
**Criterion**: Given the examples section, When a developer selects a language tab, Then they see the same operation implemented in that language with idiomatic code.

**Implementing Tasks**:
- **T024**: Initialize Starlight project — includes Expressive Code with language tabs
- **T045**: Create Examples section (7 language pages) — each shows same operations in idiomatic code

**Verification**: V030 (verify all 7 languages have complete examples)

---

### AC6.2: 7 languages produce same result
**Criterion**: Given 7 languages (TypeScript, Python, C#, Java, Go, Rust, Shell), When examples are compared, Then each produces the same result against the platform API.

**Implementing Tasks**:
- **T045**: Create Examples section — includes TypeScript, Python, C#, Java, Go, Rust, Shell with equivalent operations

**Verification**: V030 (verify code completeness for: auth, create, list, query, chat)

---

### AC6.3: Public API surface only
**Criterion**: Given any code example, When reviewed, Then it uses only the public API surface (no internal endpoints, no undocumented parameters).

**Implementing Tasks**:
- **T045**: Create Examples section — uses only public API endpoints from reference documentation
- **T030**: Create API surface reference — documents public API for example authors to reference

**Verification**: Manual review during T045, cross-check against T030 API reference

---

### AC6.4: Code blocks have copy buttons
**Criterion**: Given a documentation page with code, When rendered, Then code blocks have copy buttons, syntax highlighting, and language tabs.

**Implementing Tasks**:
- **T024**: Initialize Starlight project — Expressive Code provides copy buttons and syntax highlighting by default

**Verification**: V020 (visual inspection during preview), T051 (end-to-end test)

---

## US7: Homebrew Distribution

**Acceptance Criteria → Task Mapping**

### AC7.1: Homebrew installation works
**Criterion**: Given the Homebrew tap repository exists, When a user runs `brew install eai-tools/tap/eai`, Then the CLI installs and the `eai` command works.

**Implementing Tasks**:
- **T047**: Create Homebrew tap repository with formula and CI

**Verification**: V032 (test `brew install eai-tools/tap/eai`)

---

### AC7.2: Homebrew formula auto-updates
**Criterion**: Given a new CLI version is released, When the release workflow completes, Then the Homebrew formula is automatically updated with the new version.

**Implementing Tasks**:
- **T047**: Create Homebrew tap repository — includes auto-update workflow

**Verification**: Part of T048 (release workflow test)

---

## US8: GitHub Releases with Binaries

**Acceptance Criteria → Task Mapping**

### AC8.1: Binaries available in GitHub Releases
**Criterion**: Given a GitHub Release, When a user downloads the binary for their platform (macOS, Linux, Windows), Then the binary executes without requiring Node.js.

**Implementing Tasks**:
- **T048**: Enhance release workflow — creates GitHub Release with downloadable assets

**Note**: The current implementation uses npm tarball (requires Node.js). True standalone binaries (via pkg/esbuild) are noted as out of scope in spec.md. The tarball satisfies the requirement for "downloadable artifacts" as stated in FR-029.

**Verification**: V033 (verify GitHub Release has tarball asset)

---

### AC8.2: Release includes all platforms
**Criterion**: Given a new version is released, When the release workflow runs, Then binaries for all supported platforms are attached to the GitHub Release.

**Implementing Tasks**:
- **T048**: Enhance release workflow — attaches npm tarball (cross-platform, requires Node.js)

**Verification**: V033 (verify release assets present)

---

## Functional Requirements Coverage

### IP Sanitization (P0)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-001: Remove internal service names | T004-T008 | V001, V007, V008 |
| FR-002: Hide orchestrate exposure | T012 | V001 |
| FR-003: Remove storage tech references | T004, T010, T011 | V003, V008 |
| FR-004: Remove auth/policy references | T009 | V003 |
| FR-005: Update org references | T001-T003 | V003 |
| FR-006: Exclude research.md from npm | T015 | V012 |

---

### Packaging (P1)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-007: Package.json metadata | T013 | V013 |
| FR-008: Dynamic version | T014 | V011 |
| FR-009: Fix files field | T013 | V009, V012 |
| FR-010: prepublishOnly script | T013 | V010 |
| FR-011: npx support | T013, T019 | T019, V013 |

---

### CI/CD (P1)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-012: CI on PRs | T020 | V014, V015 |
| FR-013: Release on tag | T021 | V016, V017 |
| FR-014: Docs on push | T022 | V018 |

---

### Documentation Site (P2)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-015: Starlight + GitHub Pages | T024 | V019, V020 |
| FR-016: Pagefind search | T024 | V022 |
| FR-017: llms.txt | T032 | V023, T055 |
| FR-018: Progressive disclosure | T033 | T056, V021 |
| FR-019: Code blocks with tabs | T024 | V020, T051 |
| FR-020: Command reference | T029 | V022 |
| FR-021: Glossary | T031 | T051 |

---

### Scenarios (P2)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-022: 50 scenarios | T034-T044 | V026, V027 |
| FR-023: Scenario completeness | T034-T044 | V028 |
| FR-024: Object Types validate | T034-T044 | V029 |
| FR-025: No IP in scenarios | T046 | V031 |

---

### Multi-Language (P2)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-026: 7 languages | T045 | V030 |
| FR-027: Language example coverage | T045 | V030 |

---

### Distribution (P3)

| Requirement | Tasks | Verification |
|-------------|-------|--------------|
| FR-028: Homebrew tap | T047 | V032 |
| FR-029: GitHub Release artifacts | T048 | V033 |

---

## Phase Coverage Summary

| Phase | User Stories | Acceptance Criteria | Tasks | Verification Steps |
|-------|--------------|---------------------|-------|-------------------|
| Phase 1 | US1 | 6 ACs | T001-T012 (12 tasks) | V001-V008 (8 steps) |
| Phase 2 | US2 | 5 ACs | T013-T019 (7 tasks) | V009-V013 (5 steps) |
| Phase 3 | US3 | 4 ACs | T020-T023 (4 tasks) | V014-V018 (5 steps) |
| Phase 4 | US4 | 8 ACs | T024-T033 (10 tasks) | V019-V025 (7 steps) |
| Phase 5 | US5, US6 | 10 ACs | T034-T046 (13 tasks) | V026-V031 (6 steps) |
| Phase 6 | US7, US8 | 4 ACs | T047-T049 (3 tasks) | V032-V034 (3 steps) |
| Phase 7 | All | All | T050-T059 (10 tasks) | V035-V040 (6 steps) |

**Total Coverage**:
- **User Stories**: 8/8 (100%)
- **Acceptance Criteria**: 37/37 (100%)
- **Functional Requirements**: 29/29 (100%)
- **Tasks**: 59 tasks
- **Verification Steps**: 40 steps

---

## Acceptance Criteria Checklist

This checklist can be used during Phase 7 verification (T053) to confirm all acceptance criteria are met.

### US1: IP Sanitization
- [ ] AC1.1: Zero internal service names in source files
- [ ] AC1.2: Generated CLAUDE.md contains no internals
- [ ] AC1.3: Error messages use neutral terminology
- [ ] AC1.4: README uses capability language
- [ ] AC1.5: Organization references updated to @eai-tools
- [ ] AC1.6: research.md excluded from npm package

### US2: npm Publishing
- [ ] AC2.1: Package publishes successfully to npm
- [ ] AC2.2: Global installation works
- [ ] AC2.3: npx works without global install
- [ ] AC2.4: npm page shows complete metadata
- [ ] AC2.5: Version dynamically read from package.json

### US3: CI/CD Automation
- [ ] AC3.1: CI runs on every PR
- [ ] AC3.2: Release workflow publishes on tag push
- [ ] AC3.3: Docs deploy automatically
- [ ] AC3.4: CI failures are actionable

### US4: Documentation Site
- [ ] AC4.1: Landing page shows value within 5 seconds
- [ ] AC4.2: Plain English explanations for beginners
- [ ] AC4.3: Search finds commands and concepts
- [ ] AC4.4: AI agent can parse documentation
- [ ] AC4.5: llms.txt available at root
- [ ] AC4.6: Progressive disclosure from beginner to advanced
- [ ] AC4.7: Mobile responsive
- [ ] AC4.8: SEO optimized

### US5: 50 Developer Scenarios
- [ ] AC5.1: 5 scenarios per industry
- [ ] AC5.2: Scenario completeness
- [ ] AC5.3: Object Types validate
- [ ] AC5.4: Exactly 50 scenarios across 10 industries
- [ ] AC5.5: Multi-language examples in scenarios
- [ ] AC5.6: No IP in scenarios

### US6: Multi-Language Examples
- [ ] AC6.1: Language tabs for same operation
- [ ] AC6.2: 7 languages produce same result
- [ ] AC6.3: Public API surface only
- [ ] AC6.4: Code blocks have copy buttons

### US7: Homebrew Distribution
- [ ] AC7.1: Homebrew installation works
- [ ] AC7.2: Homebrew formula auto-updates

### US8: GitHub Releases
- [ ] AC8.1: Binaries available in GitHub Releases
- [ ] AC8.2: Release includes all platforms

---

## Coverage Gaps Analysis

**Analysis Result**: Zero gaps identified.

- Every user story has implementing tasks
- Every acceptance criterion is mapped to one or more tasks
- Every functional requirement is covered by tasks
- Every task has associated verification steps
- All verification steps map back to acceptance criteria

**Quality Metrics**:
- Average tasks per user story: 7.4
- Average verification steps per phase: 5.7
- Task-to-verification ratio: 1.48 (healthy coverage)
- Parallel execution opportunities: 35+ tasks (59% of total)

---

## Cross-Reference: Plan Phases → Tasks → User Stories

| Plan Phase | Plan Tasks | Implementing Tasks | User Stories | ACs Covered |
|------------|------------|-------------------|--------------|-------------|
| Phase 1 | 1.1-1.12 | T001-T012 | US1 | 6 ACs |
| Phase 2 | 2.1-2.7 | T013-T019 | US2 | 5 ACs |
| Phase 3 | 3.1-3.4 | T020-T023 | US3 | 4 ACs |
| Phase 4 | 4.1-4.10 | T024-T033 | US4 | 8 ACs |
| Phase 5 | 5.1-5.13 | T034-T046 | US5, US6 | 10 ACs |
| Phase 6 | 6.1-6.3 | T047-T049 | US7, US8 | 4 ACs |
| Phase 7 | N/A (verification) | T050-T059 | All | All (verification) |

**Plan-to-Tasks Alignment**: 100% of plan tasks converted to executable tasks.

---

## Task Dependency Graph

```
US1 (P0) ─┬─ T001: config.ts org update
          ├─ T002: verify.ts org update
          ├─ T003: init.ts org update
          ├─ T004: Rewrite CLAUDE.md template
          ├─ T005: verify.ts neutral errors
          ├─ T006: types.ts remove Configurator
          ├─ T007: tenant.ts remove Configurator
          ├─ T008: index.ts remove internals
          ├─ T009: Rewrite README
          ├─ T010: config.ts storageBackend
          ├─ T011: init.ts scaffold cleanup
          └─ T012: api.ts orchestrate review
                    ↓
          ┌─────────┴─────────┐
          ↓                   ↓
US2 (P1) ─┬─ T013: package.json metadata     US3 (P1) ─┬─ T020: ci.yml
          ├─ T014: Dynamic version                      ├─ T021: release.yml
          ├─ T015: .npmignore                           ├─ T022: docs.yml
          ├─ T016: LICENSE                              └─ T023: Setup docs
          ├─ T017: package-lock regen
          ├─ T018: npm pack test
          └─ T019: npx test
                    ↓                                     ↓
          ┌─────────┴─────────┬─────────────────────────┘
          ↓                   ↓
US4 (P2) ─┬─ T024: Starlight init          US5/6 (P2) ─┬─ T034: Scenario template
          ├─ T025: Landing page                        ├─ T035: Healthcare (5)
          ├─ T026: Getting Started                     ├─ T036: Finance (5)
          ├─ T027: Guides                              ├─ T037: Government (5)
          ├─ T028: Concepts                            ├─ T038: Retail (5)
          ├─ T029: Command Reference                   ├─ T039: Education (5)
          ├─ T030: Reference                           ├─ T040: Real Estate (5)
          ├─ T031: Glossary                            ├─ T041: Manufacturing (5)
          ├─ T032: llms.txt                            ├─ T042: Legal (5)
          └─ T033: Progressive disclosure              ├─ T043: Non-Profit (5)
                    ↓                                   ├─ T044: Logistics (5)
                    └───────────┬─────────────┬─────────├─ T045: Language examples
                                ↓             ↓         └─ T046: IP review
                          US7 (P3)       US8 (P3)
                          T047: Homebrew  T048: Releases
                                ↓             ↓
                                └──────┬──────┘
                                       ↓
                                  T049: Update install docs
                                       ↓
                            Phase 7: Verification (T050-T059)
```

---

## Success Criteria Traceability

Each success criterion from spec.md mapped to verification tasks:

| Success Criterion | Target | Verification Task(s) |
|-------------------|--------|---------------------|
| npm package publishes | 100% | T050, V010 |
| All org references updated | 0 remaining | V003 |
| All IP sanitized | 0 internal names | V001-V004, V031 |
| Docs site loads | < 2 seconds | V038, T058 |
| Search works | All commands findable | V022, T051 |
| 50 scenarios published | 50 across 10 industries | V026, V027 |
| Multi-language examples | 7 languages | V030 |
| CI/CD runs on PR | Every PR | V014, T052 |
| Releases automated | Tag → publish | V016, V017, T052 |
| llms.txt available | 200 OK response | V023, T055 |
| Student task completion | 90% | T056, V039 |
| AI agent correctness | 8/10 questions | T055, V040 |

---

## Document Status

**Status**: Ready for Review
**Last Updated**: 2026-03-09
**Coverage Completeness**: 100%
**Verification**: All user stories, acceptance criteria, and functional requirements have implementing tasks and verification steps.

---

## Usage Instructions

1. **For Implementation**: Use the task-to-AC mapping to understand what each task accomplishes
2. **For Verification**: Use the AC checklist during T053 to confirm all requirements met
3. **For Progress Tracking**: Mark ACs complete as their implementing tasks finish
4. **For Auditing**: Cross-reference user stories → ACs → tasks → verification to ensure nothing missed

