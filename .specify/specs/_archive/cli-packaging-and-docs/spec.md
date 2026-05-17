---
id: cli-packaging-and-docs
title: CLI Packaging, Distribution & World-Class Documentation Site
status: complete
created: 2026-03-09
updated: 2026-03-09
completedAt: 2026-03-09
author: Claude
---

# CLI Packaging, Distribution & World-Class Documentation Site

## Overview

The EAI CLI (`@eai-tools/cli`) is a fully implemented developer tool with 30+ commands for building vertical business applications on the EnterpriseAI platform. However, it cannot be distributed to developers today — there is no npm publishing, no release automation, no documentation site, and internal IP is exposed throughout the codebase.

This feature delivers:

1. A production-ready packaging and distribution pipeline (npm, GitHub Releases, Homebrew)
2. The best CLI documentation site on the internet — built with Starlight (Astro), deployed to GitHub Pages
3. 50 developer scenarios across 10 industry verticals with multi-language code examples
4. Full IP sanitization — removing all references to internal architecture from public-facing content
5. AI-agent-friendly documentation with llms.txt support
6. University-student-accessible progressive disclosure throughout

**Target Users**: Enterprise developers building vertical business applications, university students learning platform development, AI coding agents assisting developers.

**Research Reference**: See `research.md` for codebase analysis, competitive analysis, and technology decisions.

---

## User Stories

### US1: IP Sanitization & Organization Updates (P0)

**As a** platform owner,
**I want** all internal implementation details removed from public-facing code, documentation, and generated files,
**So that** our intellectual property (storage architecture, policy engine, token flows, internal service names) is never exposed to external developers.

**Why this priority**: This is a **prerequisite** for all other work. Nothing can be published until IP is protected. Shipping any artifact (npm package, docs site, README) with internal details exposed is a security and competitive risk.

**Independent Test**: Run `npm pack` and inspect the tarball — no internal service names (Configurator, ResourceAPI, AICore, PayloadCMS), no storage implementation details (JSONB, OPA, OBO, RLS, HyPE). Run `eai init test-project` and verify the generated CLAUDE.md contains no architecture internals. Run `eai verify` and confirm error messages use neutral terminology.

**Acceptance Scenarios**:

1. **Given** the current codebase, **When** I search all source files for "Configurator", "ResourceAPI", "AICore", "JSONB", "OPA", "OBO", "PayloadCMS", "HyPE", "RLS", **Then** zero matches are found in user-facing strings, generated files, help text, or error messages (internal SDK method bodies are allowed as long as they aren't exposed to users)
2. **Given** a developer runs `eai init my-app`, **When** the generated CLAUDE.md is created, **Then** it contains no internal service names, no architecture diagrams revealing backend routing, and no database implementation details
3. **Given** the CLI encounters an error, **When** error messages are displayed, **Then** they use neutral terms ("platform service", "data service", "AI service") instead of internal names
4. **Given** the README.md, **When** a developer reads it, **Then** it describes capabilities (resources, types, tenants, chat) without mentioning how they're implemented internally
5. **Given** the `@enterpriseaigroup` org references in source code, **When** updated, **Then** all references point to `@eai-tools` consistently across config.ts, verify.ts, and init.ts
6. **Given** `docs/research.md`, **When** the npm package is built, **Then** research.md is excluded via `.npmignore`

---

### US2: CLI Packaging & npm Publishing (P1)

**As a** developer,
**I want** to install the EAI CLI with a single command (`npm install -g @eai-tools/cli` or `npx @eai-tools/cli`),
**So that** I can start building vertical applications immediately without cloning a repository.

**Why this priority**: Distribution is the gateway to all developer adoption. Without a published npm package, no one outside the team can use the CLI.

**Independent Test**: Run `npm install -g @eai-tools/cli` from npm registry, then run `eai --version` and `eai --help` — both produce correct output.

**Acceptance Scenarios**:

1. **Given** the package.json is configured, **When** `npm publish` runs, **Then** the package publishes successfully to npm as `@eai-tools/cli` with public access
2. **Given** a fresh machine with Node.js 20+, **When** the user runs `npm install -g @eai-tools/cli`, **Then** the `eai` command is available globally and responds to `eai --version`
3. **Given** a user who has never installed the CLI, **When** they run `npx @eai-tools/cli init my-app`, **Then** the scaffolding runs without requiring a global install
4. **Given** the package is published, **When** a developer inspects the npm page, **Then** they see repository URL, homepage, license (MIT), keywords, and a clean README
5. **Given** the version is bumped, **When** the CLI starts, **Then** the version shown matches package.json (no hardcoded duplicate)

---

### US3: CI/CD & Release Automation (P1)

**As a** maintainer,
**I want** automated CI/CD that builds, tests, lints, and publishes on every release,
**So that** releases are consistent, tested, and require zero manual steps.

**Why this priority**: Automation prevents broken releases and enables rapid iteration. Must be in place before first public release.

**Independent Test**: Push a tag `v0.2.0` to GitHub and verify: CI passes, npm package publishes, GitHub Release is created with changelog.

**Acceptance Scenarios**:

1. **Given** a PR is opened, **When** CI runs, **Then** it executes build, lint, and typecheck successfully
2. **Given** a version tag is pushed (e.g., `v0.2.0`), **When** the release workflow triggers, **Then** it builds the project, publishes to npm, and creates a GitHub Release with auto-generated changelog
3. **Given** a push to the `main` branch, **When** docs have changed, **Then** the documentation site is built and deployed to GitHub Pages automatically
4. **Given** CI fails, **When** a maintainer checks GitHub, **Then** the failure reason is clear with actionable error messages

---

### US4: Documentation Site Foundation (P2)

**As a** developer (or university student),
**I want** a professional documentation site at `eai-tools.github.io/eai` with getting started guides, command reference, and concept explanations,
**So that** I can learn how to use the CLI and platform without reading source code.

**Why this priority**: Documentation is the primary discovery and learning channel. Needed before promoting the CLI to external developers.

**Independent Test**: Visit `eai-tools.github.io/eai`, search for "init", find the command reference, follow the quickstart guide through `eai init` → `eai login` → `eai types seed`.

**Acceptance Scenarios**:

1. **Given** a developer visits the docs site, **When** they land on the homepage, **Then** they see a clear value proposition, installation command, and quickstart link within 5 seconds
2. **Given** a university student with no platform experience, **When** they read the "What is EnterpriseAI?" page, **Then** they understand what the platform does, what vertical applications are, and how the CLI fits in — in plain English before any code
3. **Given** a developer, **When** they search for a command (e.g., "resources list"), **Then** Pagefind returns the relevant command reference page with flags, options, and example output
4. **Given** any documentation page, **When** an AI agent reads it, **Then** the page stands alone with full context, clear hierarchical headings, consistent terminology, and descriptions above every code block
5. **Given** the docs site root, **When** an AI agent requests `/llms.txt`, **Then** it receives a structured markdown summary of all documentation with links
6. **Given** any concept page, **When** rendered, **Then** it starts with a plain-English explanation, followed by a visual diagram, then code examples — progressive disclosure from beginner to advanced
7. **Given** the docs site, **When** viewed on mobile, **Then** it is fully responsive with readable text and functional navigation
8. **Given** the docs site, **When** Google indexes it, **Then** pages appear in search results with proper titles, descriptions, and structured data

### Documentation Site Sections

The site MUST include the following sections:

| Section | Content | Audience |
|---------|---------|----------|
| **Getting Started** | Installation, quickstart (5 min), authentication, first vertical | Beginners, students |
| **Guides** | Object Types, Resources, Environment, Deployment, AI Features, Multi-tenant, Security, Troubleshooting | Intermediate |
| **Concepts** | Platform Overview, What are Verticals?, Architecture (public-only), Data Model, Security Model | All levels |
| **Command Reference** | Every command with flags, options, examples, expected output | All levels |
| **Examples** | Multi-language code in TypeScript, Python, C#, Java, Go, Rust, Shell | Intermediate-Advanced |
| **Scenarios** | 50 industry scenarios (see US5) | All levels |
| **API Reference** | Public API surface, request/response formats, error codes | Advanced |

---

### US5: 50 Developer Scenarios (P2)

**As a** developer evaluating the platform,
**I want** to see a scenario that matches my industry and use case with complete Object Type definitions, CLI workflows, and multi-language code examples,
**So that** I can understand exactly how to build my specific vertical application.

**Why this priority**: Scenarios are the primary sales and education tool. They show developers "someone like me has built something like what I need." 50 scenarios across 10 industries demonstrate platform breadth.

**Independent Test**: Navigate to the Healthcare scenarios page, read "Patient Intake & Triage" scenario, copy the Object Types, run `eai init`, paste types, run `eai types validate` — it works.

**Acceptance Scenarios**:

1. **Given** a developer in the healthcare industry, **When** they browse scenarios, **Then** they find 5 healthcare-specific scenarios with realistic Object Types, CLI workflows, and code examples
2. **Given** any scenario, **When** a developer reads it, **Then** it includes: developer persona, business problem, 3-8 Object Types with full property/link/action definitions, step-by-step CLI workflow, code examples in at least 3 languages, and architecture diagram
3. **Given** a scenario's Object Type definitions, **When** a developer copies them into their project and runs `eai types validate`, **Then** validation passes
4. **Given** all 50 scenarios, **When** counted by industry, **Then** there are exactly 5 per industry across: Healthcare, Finance, Government, Retail, Education, Real Estate, Manufacturing, Legal, Non-Profit, Logistics
5. **Given** any scenario, **When** code examples are shown, **Then** they include at minimum: CLI commands (bash), TypeScript (Platform SDK), and Python (requests) — with additional languages where relevant
6. **Given** all 50 scenarios, **When** reviewed for IP, **Then** none reveal internal architecture, service names, or storage implementation details

### Complete Scenario List

#### Healthcare (5)
1. Patient Intake & Triage
2. Clinical Trial Management
3. Telemedicine Platform
4. Pharmacy Inventory Management
5. Mental Health Assessment

#### Finance (5)
6. KYC/Identity Verification
7. Loan Application Processing
8. Transaction Monitoring
9. Insurance Claims Processing
10. Portfolio Management

#### Government (5)
11. Planning Permit Portal
12. Citizen Service Requests
13. Regulatory Compliance Management
14. Public Records Management
15. Grant Management

#### Retail (5)
16. Product Compliance Tracking
17. Customer Loyalty Program
18. Inventory Management
19. E-Commerce Returns
20. Supplier Onboarding

#### Education (5)
21. Course Management System
22. Student Admissions Portal
23. Learning Analytics Dashboard
24. Accreditation Management
25. Research Grant Tracking

#### Real Estate (5)
26. Property Management Portal
27. Lease Management System
28. Maintenance Request Tracker
29. Property Inspection App
30. Real Estate CRM

#### Manufacturing (5)
31. Quality Control Workflow
32. Production Line Tracking
33. Defect Management
34. Supply Chain Visibility
35. Equipment Maintenance

#### Legal (5)
36. Contract Review Platform
37. Case Management System
38. Compliance Monitoring
39. E-Discovery Workflow
40. Billing & Time Tracking

#### Non-Profit (5)
41. Beneficiary Tracking (dual-tenant)
42. Donor Management
43. Volunteer Coordination
44. Impact Measurement
45. Grant Reporting

#### Logistics (5)
46. Shipment Tracking
47. Route Optimization
48. Warehouse Management
49. Fleet Management
50. Last-Mile Delivery

---

### US6: Multi-Language Code Examples (P2)

**As a** developer who works primarily in Python/C#/Java/Go,
**I want** to see how to interact with the EAI platform from my language of choice,
**So that** I understand the platform is language-agnostic and can integrate into my existing stack.

**Why this priority**: Enterprise developers work in diverse ecosystems. Multi-language support signals enterprise readiness and reduces adoption friction.

**Independent Test**: Visit the Python examples page, copy the "Create a Resource" example, run it with valid credentials — it creates a resource on the platform.

**Acceptance Scenarios**:

1. **Given** the examples section, **When** a developer selects a language tab, **Then** they see the same operation implemented in that language with idiomatic code
2. **Given** 7 languages (TypeScript, Python, C#, Java, Go, Rust, Shell), **When** examples are compared, **Then** each produces the same result against the platform API
3. **Given** any code example, **When** reviewed, **Then** it uses only the public API surface (no internal endpoints, no undocumented parameters)
4. **Given** a documentation page with code, **When** rendered, **Then** code blocks have copy buttons, syntax highlighting, and language tabs

### Languages & Patterns

| Language | HTTP Client | CLI Integration | Primary Use Case |
|----------|-------------|-----------------|------------------|
| TypeScript | Platform SDK | Native | Primary development |
| Python | requests/httpx | subprocess | Data science, ML pipelines |
| C#/.NET | HttpClient | Process | Enterprise .NET apps |
| Java | HttpClient | ProcessBuilder | Enterprise Java apps |
| Go | net/http | exec.Command | Cloud-native services |
| Rust | reqwest | Command | Systems integration |
| Shell/Bash | curl | Direct CLI | Scripting, CI/CD |

---

### US7: Homebrew Distribution (P3)

**As a** macOS/Linux developer,
**I want** to install the CLI via Homebrew (`brew install eai-tools/tap/eai`),
**So that** I can manage CLI updates alongside my other development tools.

**Why this priority**: Homebrew is the preferred package manager for many macOS developers. Lower priority than npm since npm already works.

**Independent Test**: Run `brew install eai-tools/tap/eai`, then run `eai --version`.

**Acceptance Scenarios**:

1. **Given** the Homebrew tap repository exists, **When** a user runs `brew install eai-tools/tap/eai`, **Then** the CLI installs and the `eai` command works
2. **Given** a new CLI version is released, **When** the release workflow completes, **Then** the Homebrew formula is automatically updated with the new version

---

### US8: GitHub Releases with Binaries (P3)

**As a** developer in a CI/CD environment or without Node.js,
**I want** to download a pre-built CLI binary from GitHub Releases,
**So that** I can use the CLI without requiring npm or Node.js installed.

**Why this priority**: Enables CI/CD pipelines and developers who don't use Node.js. Lower priority than npm distribution.

**Independent Test**: Download the binary from a GitHub Release, make it executable, run `eai --version`.

**Acceptance Scenarios**:

1. **Given** a GitHub Release, **When** a user downloads the binary for their platform (macOS, Linux, Windows), **Then** the binary executes without requiring Node.js
2. **Given** a new version is released, **When** the release workflow runs, **Then** binaries for all supported platforms are attached to the GitHub Release

---

### Edge Cases

- What happens when a developer runs `npx @eai-tools/cli` with Node.js < 20? → Clear error message stating minimum version requirement
- What happens when `npm install -g` fails due to permissions? → Documentation covers `npx` as alternative, and common permission fixes
- What happens when the docs site is accessed by a search engine crawler? → Proper meta tags, sitemap.xml, and robots.txt are served
- What happens when a scenario's Object Types conflict with existing platform types? → Each scenario uses unique type names prefixed with the vertical context
- What happens when the Vertical-Template repo is private/inaccessible? → Documentation notes that the template requires access and provides manual scaffolding instructions
- What happens when an AI agent requests `/llms-full.txt`? → Returns a single markdown file with all documentation content, optimized for context window consumption

---

## Requirements

### Functional Requirements

**IP Sanitization (P0)**

- **FR-001**: System MUST remove all references to internal service names ("Configurator", "ResourceAPI", "AICore") from user-facing strings, help text, error messages, and generated files
- **FR-002**: System MUST replace `orchestrate()` method's public exposure — either make it private or rename to neutral terminology
- **FR-003**: System MUST remove all references to internal storage technology (JSONB, PostgreSQL, CosmosDB, RLS) from generated content and type definitions
- **FR-004**: System MUST remove all references to internal auth/policy mechanisms (OPA, OBO, Rego) from README, generated CLAUDE.md, and help text
- **FR-005**: System MUST update all `@enterpriseaigroup` references to `@eai-tools` in source code (config.ts, verify.ts, init.ts)
- **FR-006**: System MUST exclude `docs/research.md` and `.specify/` from npm package via `.npmignore`

**Packaging (P1)**

- **FR-007**: Package.json MUST include: license (MIT), repository, homepage, bugs, publishConfig with public access, keywords
- **FR-008**: CLI version MUST be read from package.json at runtime (not hardcoded in index.ts)
- **FR-009**: The `files` field in package.json MUST accurately reflect published content (remove non-existent `templates` reference)
- **FR-010**: Package MUST include a `prepublishOnly` script that runs build and lint
- **FR-011**: `npx @eai-tools/cli` MUST work for any command without global installation

**CI/CD (P1)**

- **FR-012**: A CI workflow MUST run build, lint, and typecheck on every pull request
- **FR-013**: A release workflow MUST publish to npm and create a GitHub Release when a version tag is pushed
- **FR-014**: A docs workflow MUST build and deploy the documentation site to GitHub Pages on pushes to main

**Documentation Site (P2)**

- **FR-015**: Documentation site MUST be built with Starlight (Astro) and deployed to GitHub Pages at `eai-tools.github.io/eai`
- **FR-016**: Documentation site MUST include built-in search via Pagefind
- **FR-017**: Documentation site MUST serve `/llms.txt` and `/llms-full.txt` for AI agent consumption
- **FR-018**: Every documentation page MUST use progressive disclosure — plain English first, then diagrams, then code
- **FR-019**: Code blocks MUST have copy buttons, syntax highlighting, and language tabs (via Expressive Code)
- **FR-020**: Documentation site MUST include a complete command reference for all 30+ CLI commands with flags, options, examples, and expected terminal output
- **FR-021**: Documentation site MUST include a glossary of all platform terminology

**Scenarios (P2)**

- **FR-022**: Documentation MUST include 50 developer scenarios — 5 per industry across 10 industries
- **FR-023**: Each scenario MUST include: developer persona, business problem, Object Type definitions, step-by-step CLI workflow, code examples in 3+ languages, and architecture diagram
- **FR-024**: All scenario Object Type definitions MUST pass `eai types validate`
- **FR-025**: No scenario may expose internal platform implementation details

**Multi-Language (P2)**

- **FR-026**: Documentation MUST include code examples in 7 languages: TypeScript, Python, C#, Java, Go, Rust, Shell
- **FR-027**: Each language example MUST show at minimum: authentication, resource creation, resource listing, and resource querying

**Distribution (P3)**

- **FR-028**: A Homebrew tap MUST be available for macOS/Linux installation
- **FR-029**: GitHub Releases MUST include downloadable artifacts

### Key Entities

- **Documentation Page**: A single unit of content in the docs site (concept, guide, reference, scenario)
- **Developer Scenario**: A complete worked example showing how to build a specific vertical application
- **Code Example**: A language-specific snippet demonstrating a platform operation
- **Command Reference**: Auto-generated documentation for a single CLI command with all options
- **Object Type Definition**: A TypeScript schema defining a data model for the platform

---

## Non-Functional Requirements

### Performance

- Documentation site MUST load in under 2 seconds on a 4G connection (Starlight's zero-JS default achieves this)
- Search results MUST appear within 500ms of typing
- npm package install MUST complete in under 30 seconds on broadband

### Security

- No internal IP (service names, architecture details, storage implementation) may appear in any published artifact
- No secrets, API keys, or internal URLs may appear in documentation or package
- Documentation site MUST be served over HTTPS (GitHub Pages default)

### Accessibility

- Documentation MUST be readable by screen readers (Starlight's semantic HTML achieves this)
- All images and diagrams MUST have alt text
- Color MUST not be the sole indicator of meaning

### Compatibility

- CLI MUST work on Node.js 20+ (macOS, Linux, Windows)
- Documentation site MUST work in all modern browsers (Chrome, Firefox, Safari, Edge)
- Documentation MUST be parseable by AI coding agents (Claude Code, Copilot, Cursor)

### SEO

- Every page MUST have unique title, meta description, and Open Graph tags
- Site MUST generate sitemap.xml
- Crawl depth MUST be 3 or fewer clicks from homepage

---

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| npm package publishes successfully | 100% | `npm publish` completes without error |
| All org references updated | 0 remaining `@enterpriseaigroup` references | `grep -r "enterpriseaigroup" src/` returns empty |
| All IP sanitized | 0 internal service names in user-facing code | Automated grep for forbidden terms |
| Documentation site loads | < 2 seconds | Lighthouse performance score > 90 |
| Search works | All commands findable | Manual test of 10 common queries |
| 50 scenarios published | 50 scenarios across 10 industries | Count pages in scenarios/ directory |
| Multi-language examples | 7 languages covered | Check examples/ directory |
| CI/CD runs on PR | Every PR triggers build/lint/typecheck | GitHub Actions logs |
| Releases are automated | Tag push → npm publish + GitHub Release | Release workflow logs |
| llms.txt available | `/llms.txt` serves valid content | HTTP request returns 200 |
| University student can follow quickstart | 90% task completion rate | Usability test with 3+ students |
| AI agent can use docs | Agent correctly answers 8/10 platform questions using docs | Test with Claude Code |

---

## Assumptions

- The npm scope `@eai-tools` is available and the team has publish access
- GitHub Pages is enabled for the `eai-tools/eai` repository
- The Vertical-Template at `https://github.com/eai-tools/Vertical-Template` will be accessible (at least to authenticated users) by the time documentation references it
- The MIT license is acceptable for the CLI (research noted UNLICENSED blocks npm publish)
- Node.js 20+ remains the minimum requirement (aligned with current package.json engines)
- The existing Commander.js command structure will not change significantly during documentation work
- Internal service names referenced in research.md accurately reflect what must not be exposed
- Conventional commit messages are already being used (per AGENTS.md mandate)

---

## Dependencies

- **package.json metadata** — Must be updated before npm publish is possible
- **GitHub Actions** — No existing workflows; new workflow files needed
- **GitHub Pages** — Must be enabled in repository settings
- **npm access token** — Required as GitHub secret for automated publishing
- **Starlight/Astro** — New dev dependency for documentation site (separate package.json in docs/)
- **Homebrew tap repository** — `eai-tools/homebrew-tap` must be created on GitHub
- **.npmignore** — Must be created to exclude internal files from published package

---

## Out of Scope

- CLI auto-update mechanism (consider in future release)
- Docker-based distribution
- Chocolatey/Scoop Windows package managers
- Bun standalone binary compilation
- Interactive API explorer (Swagger/OpenAPI UI)
- Documentation translation/i18n (English only for v1)
- Video tutorials
- Community forum or discussion platform
- Mock/emulator mode for offline development (`eai dev --offline`)
- Platform SDK documentation (separate from CLI docs)
- Custom domain for documentation (GitHub Pages subdomain is sufficient for v1)

---

## Glossary

| Term | Definition |
|------|------------|
| **Vertical Application** | A domain-specific business application built on the EnterpriseAI platform (e.g., a healthcare patient management system) |
| **Object Type** | A declarative data model definition specifying properties, relationships, and business actions for a type of resource |
| **Resource** | An instance of an Object Type stored on the platform (e.g., a specific patient record) |
| **Tenant** | An organizational unit providing data isolation and access control |
| **Platform SDK** | TypeScript library providing typed wrappers for platform API calls |
| **BFF Proxy** | Backend-for-Frontend pattern where the Next.js server proxies API calls, handling authentication server-side |
| **Entra CIAM** | Microsoft's customer identity and access management service used for authentication |
| **PublicAPI** | The platform's HTTP API surface that the CLI and SDK communicate with |
| **Starlight** | An Astro-based documentation site generator with built-in search, dark mode, and i18n |
| **llms.txt** | An emerging standard for providing structured documentation to AI agents at a well-known URL |
| **Progressive Disclosure** | A UX pattern that reveals information gradually — simple first, complex on demand |

---

## Research Traceability

| Research Finding | Spec Section | Reference |
|-----------------|--------------|-----------|
| 9 IP exposures in codebase | US1, FR-001 through FR-006 | IP Sanitization requirements |
| 4 org references needing update | US1, FR-005 | Organization updates |
| Starlight chosen as doc generator | US4, FR-015 | Technology Decision 1 |
| npm + GitHub Releases + Homebrew distribution | US2, US7, US8 | Technology Decision 2 |
| GitHub Actions with semantic-release | US3, FR-012 through FR-014 | Technology Decision 3 |
| Task-oriented IA (Stripe/Vercel pattern) | US4, Documentation Sections | Technology Decision 4 |
| 7-language example strategy | US6, FR-026, FR-027 | Technology Decision 5 |
| 50 scenarios across 10 industries | US5, FR-022 through FR-025 | Scenario plan from research |
| llms.txt standard | US4, FR-017 | AI agent usability requirement |
| Progressive disclosure for students | US4, FR-018 | University accessibility requirement |
| Node.js 20+ requirement | Assumptions, Edge Cases | Brownfield constraint |
| Commander.js 13.x | Assumptions | Brownfield constraint |
| No existing GitHub workflows | US3, Dependencies | Critical gap |
| UNLICENSED blocks npm publish | US2, FR-007, Assumptions | Technical debt |
| Hardcoded version in index.ts | US2, FR-008 | Technical debt |
| Missing templates directory | US2, FR-009 | Technical debt |
| docs/research.md is pure IP | US1, FR-006 | IP exposure finding |
| README.md mentions OBO/OPA/JSONB | US1, FR-004 | IP exposure finding |
| Generated CLAUDE.md exposes architecture | US1, FR-001 | IP exposure finding |
| npx zero-install path for students | US2, FR-011 | Installation UX recommendation |
| Pagefind built-in search | US4, FR-016 | Starlight feature |
| Homebrew tap for macOS | US7, FR-028 | Distribution strategy |
