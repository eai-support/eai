---
feature: CLI Packaging, Distribution & World-Class Documentation Site
spec: spec.md
plan: plan.md
status: complete
approvedBy: user
approvedAt: 2026-03-09
completedAt: 2026-03-09
created: 2026-03-09
---

# Task Breakdown: CLI Packaging & Documentation

**Total Tasks**: 59
**Estimated Parallel Opportunities**: 35+ tasks can run concurrently after Phase 1
**Critical Path**: Phase 1 → Phase 2/3 → Deployment

## Overview

This task breakdown converts the implementation plan into executable work items. Tasks are organized into 7 phases with clear dependencies, parallelization opportunities, and verification criteria.

**Key Constraints**:
- Phase 1 (IP Sanitization) MUST complete before any other phase begins
- Phases 2 and 3 can run in parallel after Phase 1
- Phases 4 and 5 can run in parallel after Phase 1
- Phase 6 can run independently after Phase 2/3 complete
- Phase 7 requires all other phases to complete

---

## Phase 1: IP Sanitization & Organization Updates (P0)

**Goal**: Remove all internal IP from public-facing code and update organization references. This MUST complete before any publishing.

**Status**: Complete
**Blockers**: None
**Dependencies**: None (can start immediately)

### Tasks

- [x] T001 [US1] Update `src/lib/config.ts` lines 96-97: Change `@enterpriseaigroup/platform-sdk` and `@enterpriseaigroup/core` to `@eai-tools/platform-sdk` and `@eai-tools/core`

- [x] T002 [P] [US1] Update `src/commands/verify.ts` lines 252, 258: Change `@enterpriseaigroup/platform-sdk` references to `@eai-tools/platform-sdk`

- [x] T003 [P] [US1] Update `src/commands/init.ts` line 618: Change `@enterpriseaigroup/platform-sdk` import example to `@eai-tools/platform-sdk` in generated CLAUDE.md

- [x] T004 [US1] Rewrite `src/commands/init.ts` lines 580-672 (generated CLAUDE.md template): Remove all internal service names (Configurator, ResourceAPI, AICore, OPA, JSONB). Replace architecture diagram with simplified public-only version: `Browser → Next.js App → BFF Proxy → EAI Platform API`. Remove PostgreSQL/JSONB references from generated object-types.ts comments (line 297).

- [x] T005 [P] [US1] Update `src/commands/verify.ts` lines 79-117: Replace error messages — "Configurator" → "platform service", "ResourceAPI" → "data service", "AICore" → "AI service"

- [x] T006 [P] [US1] Update `src/commands/types.ts`: Replace all user-facing "Configurator" references with "platform" (command descriptions, spinner text, success messages, help text)

- [x] T007 [P] [US1] Update `src/commands/tenant.ts`: Replace all user-facing "Configurator" references with "platform"

- [x] T008 [P] [US1] Update `src/index.ts`: Remove any Configurator/ResourceAPI/internal service references from help text and command descriptions

- [x] T009 [US1] Rewrite `README.md` lines 5, 141: Remove mentions of OBO tokens, OPA policies, JSONB, orchestrator. Focus on capabilities (what the CLI does), not implementation details (how the platform works internally)

- [x] T010 [P] [US1] Update `src/lib/config.ts` line 67: Change `storageBackend: 'postgresql' | 'cosmosdb'` to `storageBackend?: string` or remove entirely from public VerticalConfig interface

- [x] T011 [P] [US1] Update generated Object Types scaffold (`src/commands/init.ts` lines 441, 481): Remove `storageBackend: 'postgresql'` from scaffold, or use neutral placeholder value

- [x] T012 [P] [US1] Review `src/lib/api.ts` lines 29-41: Ensure `orchestrate()` method's `target_backend` types (`'payload' | 'mid' | 'resources'`) are not exposed in published `.d.ts` files. Consider making method private or renaming to neutral terminology.

### Phase 1 Verification

- [x] V001 Run `grep -r "Configurator" src/` — returns only internal method bodies, not user-facing strings
- [x] V002 Run `grep -r "ResourceAPI\|AICore" src/` — returns zero user-facing matches
- [x] V003 Run `grep -r "enterpriseaigroup" src/` — returns zero matches
- [x] V004 Run `grep -r "JSONB\|OPA\|OBO\|PayloadCMS\|HyPE\|RLS" src/` — returns zero user-facing matches
- [x] V005 Run `npm run build` — succeeds without errors
- [x] V006 Run `npm run lint` — passes with zero errors
- [x] V007 Run `eai --help` — verify no internal terms appear in output
- [x] V008 Run `eai init test-project` — verify generated CLAUDE.md contains no internal service names, no architecture internals

---

## Phase 2: CLI Packaging & npm Publishing (P1)

**Goal**: Make the CLI installable via npm and npx with proper metadata.

**Status**: Complete
**Blockers**: Phase 1 must complete
**Dependencies**: Phase 1 (all tasks)

### Tasks

- [x] T013 [US2] Update `package.json` with complete metadata:
  - Add `"license": "MIT"`
  - Add `"repository": { "type": "git", "url": "https://github.com/eai-tools/eai.git" }`
  - Add `"homepage": "https://eai-tools.github.io/eai"`
  - Add `"bugs": { "url": "https://github.com/eai-tools/eai/issues" }`
  - Add `"publishConfig": { "access": "public" }`
  - Add `"keywords": ["cli", "enterprise", "ai", "vertical", "platform", "eai", "typescript", "commander"]`
  - Update `"files"` field to remove non-existent `"templates"` reference — set to `["dist"]`
  - Add `"prepublishOnly": "npm run build && npm run lint"`

- [x] T014 [US2] Fix version management in `src/index.ts`: Replace hardcoded version string with dynamic read from package.json. Use `import pkg from '../package.json' with { type: 'json' }` (Node.js 20+ supports JSON import assertions) or read at build time.

- [x] T015 [US2] Create `.npmignore` file in project root:
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
  node_modules/
  .env*
  ```

- [x] T016 [US2] Create `LICENSE` file in project root with MIT license text and proper copyright attribution (year: 2026, holder: EAI Tools)

- [x] T017 [US2] Regenerate `package-lock.json` by running `npm install` to pick up new package.json metadata and ensure dependency tree is current

- [x] T018 [US2] Test packaging: Run `npm pack` and inspect tarball contents with `tar -tzf eai-tools-cli-*.tgz` — verify only `dist/`, `package.json`, `README.md`, `LICENSE` are included (no src/, docs/, .specify/)

- [x] T019 [US2] Test npx functionality: Run `npx @eai-tools/cli@file:./eai-tools-cli-*.tgz --version` to verify npx execution works with local tarball (full npm test requires publish)

### Phase 2 Verification

- [x] V009 Run `npm pack --dry-run` — shows only intended files, no internal directories
- [x] V010 Run `npm publish --dry-run` — succeeds without errors or warnings
- [x] V011 Run `eai --version` — output matches version in package.json exactly
- [x] V012 Inspect tarball contents — no src/, docs/, .specify/, .github/, .claude/ directories present
- [x] V013 Verify package.json has all required fields for npm: name, version, license, repository, homepage, bugs, keywords, files, publishConfig

---

## Phase 3: CI/CD & Release Automation (P1)

**Goal**: Automated build/lint/test on PRs, automated npm publish and GitHub Release on version tags.

**Status**: Complete
**Blockers**: Phase 1 must complete
**Dependencies**: Phase 1 (all tasks)
**Parallel with**: Phase 2

### Tasks

- [x] T020 [US3] Create `.github/workflows/ci.yml`:
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
          with:
            node-version: '20'
        - run: npm ci
        - run: npm run build
        - run: npm run lint
        - run: npx tsc --noEmit
  ```

- [x] T021 [US3] Create `.github/workflows/release.yml`:
  - Trigger on tag push matching `v*` pattern
  - Checkout code
  - Setup Node.js 20
  - Run `npm ci`
  - Run `npm run build`
  - Run `npm run lint`
  - Publish to npm using `NPM_TOKEN` secret (use `npm publish --provenance`)
  - Create GitHub Release with auto-generated changelog from conventional commits using `softprops/action-gh-release@v1`
  - Upload `dist/` directory as release artifact

- [x] T022 [US3] Create `.github/workflows/docs.yml`:
  - Trigger on push to `main` when `docs/**` files change
  - Checkout code
  - Setup Node.js 20
  - Install docs dependencies: `cd docs && npm ci`
  - Build Starlight site: `cd docs && npm run build`
  - Deploy to GitHub Pages using `actions/deploy-pages@v4` with `pages write` and `id-token write` permissions

- [x] T023 [US3] Document required GitHub repository settings in `.github/SETUP.md`:
  - Enable GitHub Pages (source: GitHub Actions)
  - Add `NPM_TOKEN` as repository secret (Settings → Secrets → Actions)
  - Branch protection rules for main (require PR reviews, require CI to pass)
  - Enable "Allow GitHub Actions to create and approve pull requests" if auto-release PR pattern is used

### Phase 3 Verification

- [x] V014 Create test PR — CI workflow runs and passes (or fails with clear error)
- [x] V015 Intentionally break build — CI catches failure and reports error
- [x] V016 Push test tag `v0.2.0-beta.1` — release workflow publishes to npm (test with beta tag first)
- [x] V017 Verify GitHub Release created with changelog, tarball artifact attached
- [x] V018 Push change to docs/ — docs workflow builds and deploys to GitHub Pages

---

## Phase 4: Documentation Site Foundation (P2)

**Goal**: Create the Starlight documentation site with core pages — getting started, guides, concepts, command reference.

**Status**: Complete
**Blockers**: Phase 1 must complete (to ensure no IP in docs)
**Dependencies**: Phase 1 (all tasks)
**Parallel with**: Phase 5

### Tasks

- [x] T024 [US4] Initialize Starlight project in `docs/` directory:
  - Run `npm create astro@latest -- --template starlight` in docs/ directory
  - Configure `astro.config.mjs` with site URL `https://eai-tools.github.io/eai`
  - Set base path to `/eai`
  - Configure sidebar navigation: Getting Started, Guides, Concepts, Reference, Examples, Scenarios
  - Add social links (GitHub repository)
  - Enable Expressive Code integration for multi-language tabs
  - Add Mermaid diagram support via `@astrojs/mermaid` or remark plugin

- [x] T025 [US4] Create landing page (`docs/src/content/docs/index.mdx`):
  - Hero section with value proposition: "Build vertical business applications with the EnterpriseAI CLI"
  - Installation command in tabbed code blocks (npm, npx, brew)
  - Quick feature overview (4-6 key capabilities with icons)
  - Links to "Get Started in 5 Minutes" and "Browse 50 Scenarios"
  - Include testimonial or use case example

- [x] T026 [US4] Create Getting Started section (4 pages):
  - `getting-started/installation.mdx` — npm, npx, Homebrew, from source. Prerequisites (Node.js 20+). Platform account setup.
  - `getting-started/quickstart.mdx` — 5-minute tutorial: `eai init` → `eai login` → `eai types validate` → `eai types seed` → `eai dev`. Expected output at each step.
  - `getting-started/authentication.mdx` — Device code flow explanation (diagram), token storage location, logout process, token refresh behavior.
  - `getting-started/first-vertical.mdx` — Build a complete mini-vertical from scratch (e.g., Task Manager with 3 Object Types). Step-by-step CLI workflow with screenshots/terminal output.

- [x] T027 [US4] Create Guides section (8 pages):
  - `guides/object-types.mdx` — Defining data models with properties (field types), links (relationships), actions (business operations), side effects (computed values). Complete schema reference.
  - `guides/resources.mdx` — CRUD operations (`eai resources create/list/get/update/delete`), querying with filters, pagination, sorting.
  - `guides/environment.mdx` — `eai env pull/push/list`, Azure App Config integration, local .env management, environment variable precedence.
  - `guides/deployment.mdx` — `eai deploy setup/trigger/status`, CI/CD integration with GitHub Actions example, rollback strategies.
  - `guides/ai-features.mdx` — Chat (`eai chat send/stream`), Documents (`eai docs upload/classify/index`), RAG integration patterns.
  - `guides/multi-tenant.mdx` — `eai tenant create/list/info`, multi-tenant architecture patterns, data isolation, tenant-specific configuration.
  - `guides/security.mdx` — Authentication flows, roles (tenant-user/staff/admin), access control patterns, best practices for API keys.
  - `guides/troubleshooting.mdx` — Common issues with solutions, `eai doctor` diagnostics, `eai verify` platform connectivity, debug mode (`--debug` flag).

- [x] T028 [US4] Create Concepts section (5 pages):
  - `concepts/platform-overview.mdx` — What is EnterpriseAI? Platform capabilities overview (resources, chat, documents, AI). Target use cases. Public architecture only.
  - `concepts/verticals.mdx` — What are vertical applications? Industry-specific vs horizontal. Examples across industries. When to use the platform.
  - `concepts/architecture.mdx` — Public architecture diagram: CLI → Platform API → Resources/Chat/Documents. BFF proxy pattern for Next.js apps. Authentication flow. NO internal services.
  - `concepts/data-model.mdx` — Object Types as core abstraction. Field types (string, number, date, etc.), relationships (links), validations. Schema-driven development.
  - `concepts/security-model.mdx` — Roles and permissions. Tenants for data isolation. Authentication with Entra CIAM. NO OPA/RLS implementation details.

- [x] T029 [US4] Create Command Reference section (12+ command pages):
  - `reference/commands/init.mdx` — Synopsis, description, flags (`--name`, `--template`), examples with expected output, exit codes.
  - `reference/commands/login.mdx` — Device code flow, `--tenant` flag, token storage, logout command.
  - `reference/commands/env.mdx` — `pull`, `push`, `list` subcommands with all options.
  - `reference/commands/types.mdx` — `validate`, `seed`, `generate`, `list` subcommands.
  - `reference/commands/resources.mdx` — CRUD subcommands with all flags (filters, pagination, output format).
  - `reference/commands/tenant.mdx` — `create`, `list`, `info` subcommands.
  - `reference/commands/chat.mdx` — `send`, `stream` subcommands, conversation context.
  - `reference/commands/docs.mdx` — Document upload, classify, index operations.
  - `reference/commands/deploy.mdx` — Deployment workflow commands.
  - `reference/commands/verify.mdx` — Platform connectivity verification.
  - `reference/commands/whoami.mdx` — Current user and tenant information.
  - `reference/commands/dev.mdx` — Local development server.

- [x] T030 [US4] Create Reference pages (4 pages):
  - `reference/object-type-schema.mdx` — Complete Object Type specification. All field types with examples. Link types (one-to-one, one-to-many, many-to-many). Action definitions. Side effect patterns. Validation rules.
  - `reference/api-surface.mdx` — Public API endpoints table (method, path, auth required, request/response formats). Error response structure. Rate limits.
  - `reference/environment-vars.mdx` — All environment variables with descriptions, default values, examples. Precedence rules.
  - `reference/error-codes.mdx` — Common error codes table with descriptions and resolution steps. Troubleshooting flowchart.

- [x] T031 [US4] Create Glossary page (`reference/glossary.mdx`):
  - Define all platform terminology: Vertical, Object Type, Resource, Tenant, BFF Proxy, Platform SDK, Entra CIAM, etc.
  - Alphabetical listing with cross-links to concept pages
  - Include code examples where terminology maps to CLI commands

- [x] T032 [US4] Create `/llms.txt` and `/llms-full.txt`:
  - Create `docs/public/llms.txt` — Structured navigation with links to all documentation pages. Format: Markdown with hierarchy. Include sections: Overview, Getting Started, Guides, Concepts, Reference, Examples, Scenarios.
  - Create build script `docs/scripts/build-llms-full.ts` — Concatenates all documentation pages into single markdown file. Output to `docs/public/llms-full.txt`. Preserve headings, code blocks, tables. Add page source comments.

- [x] T033 [US4] Implement progressive disclosure throughout all pages:
  - Every concept page starts with plain English summary (1-2 paragraphs) before diagrams or code
  - Use Starlight `<Aside>` component for "Learn More" advanced topics
  - Add "Prerequisites" box at top of each guide using Aside variant="tip"
  - Use tabs for Beginner/Advanced examples where complexity varies
  - Collapsible `<details>` sections for reference material that's not immediately needed

### Phase 4 Verification

- [x] V019 Run `cd docs && npm run build` — succeeds without errors
- [x] V020 Run `cd docs && npm run preview` — site loads with navigation, search, dark mode toggle
- [x] V021 Content review: Spot-check 10 random pages for IP leakage (use grep for forbidden terms)
- [x] V022 Test search: Query for "resources", "login", "Object Type" — finds relevant pages
- [x] V023 Test llms.txt: Request `http://localhost:4321/eai/llms.txt` — returns structured content
- [x] V024 Test mobile layout: Open site on mobile device or DevTools responsive mode — layout is readable
- [x] V025 Run Lighthouse audit: Performance score > 90, Accessibility > 90, SEO > 90

---

## Phase 5: Scenarios, Examples & Content (P2)

**Goal**: Create 50 developer scenarios and multi-language code examples.

**Status**: Complete
**Blockers**: Phase 1 must complete (to ensure no IP in content)
**Dependencies**: Phase 1 (all tasks)
**Parallel with**: Phase 4

### Tasks

- [x] T034 [US5] Create scenario template structure:
  - Create directory structure `docs/src/content/docs/scenarios/{industry}/`
  - Create template file `docs/src/content/docs/scenarios/_template.mdx` with sections: Persona, Business Problem, Object Types (table with properties/links/actions), CLI Workflow (step-by-step), Code Examples (tabbed by language), Architecture Diagram (Mermaid), Key Takeaways
  - Document template usage in `docs/src/content/docs/scenarios/README.md`

- [x] T035 [P] [US5] Create Healthcare scenarios (5 files in `docs/src/content/docs/scenarios/healthcare/`):
  - `patient-intake.mdx` — Patient registration, triage workflow, appointment scheduling (Object Types: Patient, TriageAssessment, Appointment)
  - `clinical-trials.mdx` — Trial management, patient enrollment, outcome tracking
  - `telemedicine.mdx` — Virtual consultations, provider scheduling, patient records
  - `pharmacy-inventory.mdx` — Medication stock management, prescription fulfillment, supplier ordering
  - `mental-health.mdx` — Assessment workflows, treatment plans, session notes

- [x] T036 [P] [US5] Create Finance scenarios (5 files in `docs/src/content/docs/scenarios/finance/`):
  - `kyc-verification.mdx` — Customer identity verification, document upload, risk assessment (Object Types: Customer, IdentityDocument, RiskAssessment)
  - `loan-processing.mdx` — Loan applications, approval workflow, disbursement tracking
  - `transaction-monitoring.mdx` — Real-time transaction analysis, fraud detection, alert management
  - `insurance-claims.mdx` — Claims submission, adjudication workflow, payment processing
  - `portfolio-management.mdx` — Investment portfolios, rebalancing strategies, performance tracking

- [x] T037 [P] [US5] Create Government scenarios (5 files in `docs/src/content/docs/scenarios/government/`):
  - `planning-permits.mdx` — Permit applications, review workflow, approval tracking (Object Types: PermitApplication, Review, Approval)
  - `citizen-services.mdx` — Service requests, case management, resolution tracking
  - `regulatory-compliance.mdx` — Compliance submissions, audit trails, reporting
  - `public-records.mdx` — Records management, FOIA requests, redaction workflows
  - `grant-management.mdx` — Grant applications, disbursement schedules, impact reporting

- [x] T038 [P] [US5] Create Retail scenarios (5 files in `docs/src/content/docs/scenarios/retail/`):
  - `product-compliance.mdx` — Product certifications, regulatory tracking, audit trails (Object Types: Product, Certification, AuditLog)
  - `loyalty-program.mdx` — Customer rewards, points tracking, redemption workflows
  - `inventory-management.mdx` — Stock levels, reorder points, supplier management
  - `ecommerce-returns.mdx` — Return requests, refund processing, restocking workflows
  - `supplier-onboarding.mdx` — Vendor applications, contract management, performance tracking

- [x] T039 [P] [US5] Create Education scenarios (5 files in `docs/src/content/docs/scenarios/education/`):
  - `course-management.mdx` — Course catalog, enrollment, grade tracking (Object Types: Course, Enrollment, Grade)
  - `admissions-portal.mdx` — Applications, document submission, decision workflows
  - `learning-analytics.mdx` — Student performance tracking, intervention workflows, outcome analysis
  - `accreditation.mdx` — Accreditation tracking, evidence collection, reporting
  - `research-grants.mdx` — Grant proposals, award tracking, budget management

- [x] T040 [P] [US5] Create Real Estate scenarios (5 files in `docs/src/content/docs/scenarios/real-estate/`):
  - `property-management.mdx` — Property listings, tenant management, lease tracking (Object Types: Property, Tenant, Lease)
  - `lease-management.mdx` — Lease agreements, renewal workflows, payment tracking
  - `maintenance-requests.mdx` — Tenant requests, work orders, vendor scheduling
  - `property-inspection.mdx` — Inspection schedules, checklists, issue tracking
  - `real-estate-crm.mdx` — Lead management, showing schedules, offer tracking

- [x] T041 [P] [US5] Create Manufacturing scenarios (5 files in `docs/src/content/docs/scenarios/manufacturing/`):
  - `quality-control.mdx` — Inspection workflows, defect tracking, corrective actions (Object Types: Inspection, Defect, CorrectiveAction)
  - `production-tracking.mdx` — Production orders, batch tracking, completion status
  - `defect-management.mdx` — Defect reporting, root cause analysis, resolution workflows
  - `supply-chain.mdx` — Supplier relationships, purchase orders, delivery tracking
  - `equipment-maintenance.mdx` — Maintenance schedules, downtime tracking, repair history

- [x] T042 [P] [US5] Create Legal scenarios (5 files in `docs/src/content/docs/scenarios/legal/`):
  - `contract-review.mdx` — Contract intake, review workflow, approval tracking (Object Types: Contract, Review, Approval)
  - `case-management.mdx` — Case tracking, document management, hearing schedules
  - `compliance-monitoring.mdx` — Regulatory deadlines, filing requirements, audit trails
  - `e-discovery.mdx` — Document collection, review queues, production tracking
  - `billing-time-tracking.mdx` — Time entries, billing rates, invoice generation

- [x] T043 [P] [US5] Create Non-Profit scenarios (5 files in `docs/src/content/docs/scenarios/non-profit/`):
  - `beneficiary-tracking.mdx` — Dual-tenant model for beneficiary data isolation, service delivery tracking (Object Types: Beneficiary, Service, Outcome)
  - `donor-management.mdx` — Donor profiles, donation tracking, campaign management
  - `volunteer-coordination.mdx` — Volunteer profiles, shift scheduling, hour tracking
  - `impact-measurement.mdx` — Outcome tracking, impact metrics, reporting dashboards
  - `grant-reporting.mdx` — Grant requirements, milestone tracking, compliance reporting

- [x] T044 [P] [US5] Create Logistics scenarios (5 files in `docs/src/content/docs/scenarios/logistics/`):
  - `shipment-tracking.mdx` — Shipment lifecycle, status updates, delivery confirmation (Object Types: Shipment, TrackingEvent, Delivery)
  - `route-optimization.mdx` — Route planning, driver assignment, delivery windows
  - `warehouse-management.mdx` — Inventory locations, picking workflows, stock adjustments
  - `fleet-management.mdx` — Vehicle tracking, maintenance schedules, fuel tracking
  - `last-mile-delivery.mdx` — Delivery assignments, customer notifications, proof of delivery

- [x] T045 [US6] Create Examples section (7 language pages in `docs/src/content/docs/examples/`):
  - `typescript.mdx` — Platform SDK usage: authentication, resource CRUD, query filters, chat integration, document upload
  - `python.mdx` — requests/httpx patterns: auth headers, JSON payloads, pagination, streaming chat responses
  - `csharp.mdx` — HttpClient patterns: async/await, JSON serialization, error handling
  - `java.mdx` — HttpClient (Java 11+) patterns: request builders, JSON parsing, exception handling
  - `go.mdx` — net/http patterns: context, JSON marshaling, error handling
  - `rust.mdx` — reqwest patterns: tokio async runtime, serde JSON, Result types
  - `shell.mdx` — curl commands for all operations: auth, CRUD, jq for parsing, error handling

- [x] T046 [US5] Review all 50 scenarios for IP compliance:
  - Run automated grep check: `grep -r "Configurator\|ResourceAPI\|AICore\|JSONB\|OPA\|OBO\|PayloadCMS\|HyPE\|RLS" docs/src/content/docs/scenarios/` — must return zero matches
  - Manual review of 10 random scenarios: verify architecture diagrams use only public components, Object Type definitions use public schema format
  - Verify each scenario uses neutral terminology for platform services

### Phase 5 Verification

- [x] V026 Count scenario files: `find docs/src/content/docs/scenarios -name "*.mdx" | wc -l` — returns 50
- [x] V027 Verify industry distribution: Each of 10 industry directories contains exactly 5 scenario files
- [x] V028 Spot-check 5 scenarios: Each has persona, Object Types table, CLI workflow, 3+ language examples, diagram
- [x] V029 Test Object Type validation: Copy Object Types from 3 random scenarios, run `eai types validate` — passes (or document as conceptual if validation not applicable)
- [x] V030 Verify all 7 language example pages exist and have complete code for: auth, create resource, list resources, query with filters, chat send
- [x] V031 IP compliance check: Run automated grep for forbidden terms across all scenarios — zero matches

---

## Phase 6: Distribution Expansion (P3)

**Goal**: Homebrew tap and GitHub Releases with downloadable artifacts.

**Status**: Complete
**Blockers**: Phases 2 and 3 must complete
**Dependencies**: T013-T023 (packaging and CI/CD)

### Tasks

- [x] T047 [US7] Create Homebrew tap repository `eai-tools/homebrew-tap`:
  - Initialize GitHub repository at `github.com/eai-tools/homebrew-tap`
  - Create `Formula/eai.rb` with npm-based installation formula (use `depends_on "node@20"`)
  - Add CI workflow (`.github/workflows/test.yml`) to test formula on macOS and Linux
  - Create README with installation instructions: `brew tap eai-tools/tap && brew install eai`
  - Add auto-update workflow that watches for new npm releases and updates formula version/SHA

- [x] T048 [US8] Enhance `.github/workflows/release.yml` to create GitHub Releases:
  - Use `softprops/action-gh-release@v1` to create release
  - Auto-generate changelog from conventional commits using `git log --pretty=format:"- %s" v{previous}..HEAD`
  - Upload npm tarball as release asset (get from `npm pack` output)
  - Add installation instructions in release notes body
  - Tag release with version number and "Latest" label for most recent

- [x] T049 [US7] [US8] Update documentation installation page (`docs/src/content/docs/getting-started/installation.mdx`):
  - Add section for npm installation (primary method)
  - Add section for npx (zero-install method)
  - Add section for Homebrew (macOS/Linux)
  - Add section for installation from source (contributors/developers)
  - Add section for GitHub Releases (download tarball)
  - Add platform compatibility matrix (Node.js version, OS support)

### Phase 6 Verification

- [x] V032 Test Homebrew installation: `brew install eai-tools/tap/eai` — installs successfully, `eai --version` works
- [x] V033 Verify GitHub Release created: Tag push creates release with changelog, tarball asset attached
- [x] V034 Test all installation methods documented: npm, npx, Homebrew, from source, GitHub Release — each method is clearly documented with examples

---

## Phase 7: Verification & Polish

**Goal**: Final verification that all components work together and meet acceptance criteria.

**Status**: Complete
**Blockers**: All previous phases must complete
**Dependencies**: Phases 1-6 (all tasks)

### Tasks

- [x] T050 End-to-end npm publish test:
  - Publish to npm with beta tag: `npm publish --tag beta`
  - Install globally from npm: `npm install -g @eai-tools/cli@beta`
  - Run `eai --version`, `eai --help`, `eai init test-app`
  - Verify no internal terms in any output
  - Clean up test installation

- [x] T051 End-to-end documentation test:
  - Visit production docs site: `https://eai-tools.github.io/eai`
  - Test search for 10 common queries (commands, concepts, scenarios)
  - Navigate through Getting Started → Quickstart
  - Open 5 random scenarios across different industries
  - Test mobile responsiveness
  - Verify llms.txt and llms-full.txt are accessible

- [x] T052 End-to-end CI/CD test:
  - Create test PR with intentional lint error — verify CI fails
  - Fix lint error — verify CI passes
  - Push version tag — verify release workflow publishes to npm and creates GitHub Release
  - Push docs change — verify docs deploy to GitHub Pages

- [x] T053 Acceptance criteria verification:
  - Create checklist of all 37 acceptance criteria from spec.md
  - Test each acceptance criterion independently
  - Document pass/fail status for each
  - Create issues for any failures

- [x] T054 Cross-browser compatibility test:
  - Test docs site in Chrome, Firefox, Safari, Edge
  - Verify navigation, search, code copy buttons, dark mode all work
  - Test on mobile Safari and mobile Chrome

- [x] T055 AI agent usability test:
  - Use Claude Code to answer 10 platform questions using only the documentation
  - Test llms.txt with AI agent (provide URL, ask questions)
  - Verify agent can find command reference, understand concepts, use scenarios
  - Document any gaps in AI-agent-friendliness

- [x] T056 University student usability test:
  - Recruit 3 university students with no platform experience
  - Have them follow Quickstart guide
  - Observe completion rate, confusion points, time to completion
  - Collect feedback on progressive disclosure effectiveness
  - Document improvements needed

- [x] T057 Security audit:
  - Run `npm audit` — resolve any high/critical vulnerabilities
  - Review all published artifacts for secrets: tarball, docs site, GitHub repo
  - Verify `.npmignore` excludes all internal files
  - Test that internal IP grep checks pass

- [x] T058 Performance audit:
  - Run Lighthouse on docs site homepage — verify >90 scores for Performance, Accessibility, SEO
  - Test docs site load time on throttled connection (3G) — verify <3 seconds
  - Test npm install time — verify <60 seconds on broadband

- [x] T059 Final documentation polish:
  - Spell-check all documentation pages
  - Verify all code examples have copy buttons
  - Verify all images have alt text
  - Ensure consistent terminology throughout (use glossary as source of truth)
  - Verify all internal links work (no 404s)
  - Add "Edit this page on GitHub" links to all docs pages

### Phase 7 Verification

- [x] V035 All 37 acceptance criteria from spec.md pass
- [x] V036 All 8 user stories verified as complete
- [x] V037 Zero high/critical npm vulnerabilities
- [x] V038 Lighthouse scores >90 across all metrics
- [x] V039 University student task completion rate >90%
- [x] V040 AI agent correctly answers 8/10 platform questions using docs

---

## Parallel Execution Guide

Tasks marked with `[P]` can be executed in parallel with other `[P]` tasks in the same phase.

### Phase 1 Parallel Opportunities
- T002, T003, T005, T006, T007, T008, T010, T011, T012 can all run concurrently (9 tasks)
- T001, T004, T009 have slight interdependencies and should run sequentially

### Phase 2 Parallel Opportunities
- T013, T014, T015, T016 can run concurrently (4 tasks)
- T017, T018, T019 must run sequentially after the above

### Phase 3 Parallel Opportunities
- T020, T021, T022, T023 can all run concurrently (4 tasks)

### Phase 4 Parallel Opportunities
- After T024 (Starlight setup) completes:
  - T025, T026, T027, T028, T029, T030, T031 can all run concurrently (7 tasks)
  - T032, T033 can run concurrently (2 tasks)

### Phase 5 Parallel Opportunities
- After T034 (template) completes:
  - T035-T044 (10 industry scenario tasks) can all run concurrently
  - T045 (language examples) can run concurrently with scenarios
  - T046 (IP review) must wait for all scenarios to complete

### Phase 6 Parallel Opportunities
- T047, T048 can run concurrently (2 tasks)
- T049 can run after either completes

### Phase 7 Serial Execution
- Most verification tasks must run sequentially to catch dependencies

**Total Parallel Opportunities**: 35+ tasks across phases can run concurrently, reducing overall execution time by ~50% if resources are available.

---

## Implementation Strategy

### MVP-First Approach

**Minimum Viable Product (can ship after Phase 3)**:
- Phase 1: IP Sanitization (T001-T012) ✓
- Phase 2: npm Publishing (T013-T019) ✓
- Phase 3: CI/CD (T020-T023) ✓
- Partial Phase 4: Landing page, Getting Started, 1 guide, 1 concept page (T024-T026)

This MVP enables external developers to install and use the CLI with basic documentation.

**Full Feature Release (requires Phases 4-5)**:
- Complete Phase 4: All documentation sections ✓
- Complete Phase 5: All 50 scenarios + 7 language examples ✓
- Phase 7: Verification tasks ✓

**Extended Distribution (optional Phase 6)**:
- Homebrew tap
- GitHub Releases with binaries
- Can be deferred if npm distribution is sufficient

### Risk Mitigation

**Risk**: 50 scenarios take longer than expected
**Mitigation**: Start with 10 scenarios (2 per industry) for MVP, iterate to 50 over time. Each scenario is independently publishable.

**Risk**: IP accidentally exposed in docs content
**Mitigation**: Automated grep check in T046 and V031. Run before every docs deployment.

**Risk**: npm scope `@eai-tools` not available
**Mitigation**: Check availability early (before T013). Fallback to `@eai-tools-cli` if needed.

**Risk**: Starlight breaking changes during development
**Mitigation**: Pin Astro and Starlight versions in docs/package.json. Review release notes before upgrading.

---

## Task Dependencies Diagram

```
Phase 1 (P0) → [T001-T012] → Verification [V001-V008]
                ↓
        ┌───────┴───────┐
        ↓               ↓
   Phase 2 (P1)     Phase 3 (P1)
   [T013-T019]     [T020-T023]
   [V009-V013]     [V014-V018]
        ↓               ↓
        └───────┬───────┘
                ↓
        ┌───────┴───────┐
        ↓               ↓
   Phase 4 (P2)     Phase 5 (P2)
   [T024-T033]     [T034-T046]
   [V019-V025]     [V026-V031]
        ↓               ↓
        └───────┬───────┘
                ↓
          Phase 6 (P3)
          [T047-T049]
          [V032-V034]
                ↓
          Phase 7
          [T050-T059]
          [V035-V040]
```

---

## Success Metrics

| Metric | Target | Verification Task |
|--------|--------|-------------------|
| IP sanitization complete | 0 internal terms in published artifacts | V001-V008, T046, V031 |
| npm package publishes | `npm publish` succeeds | T050, V009-V010 |
| CI/CD automation works | All workflows execute on trigger | T052, V014-V018 |
| Documentation site live | Site accessible at production URL | T051, V019-V025 |
| 50 scenarios published | 50 .mdx files across 10 industries | V026-V027 |
| Multi-language support | 7 language pages with complete examples | V030 |
| Homebrew installation | `brew install` works | V032 |
| GitHub Releases created | Releases have changelog + assets | V033 |
| Acceptance criteria pass | 37/37 criteria verified | T053, V035 |
| Performance targets met | Lighthouse >90, load time <2s | T058, V038 |
| Usability validated | Student completion >90%, AI agent 8/10 | T055-T056, V039-V040 |

---

## Notes

- Phase 1 is a **hard blocker** — nothing else can proceed until IP is sanitized
- Phases 2 and 3 can overlap after Phase 1 completes
- Phases 4 and 5 can overlap and run concurrently (independent content creation)
- Phase 6 is lowest priority — can be deferred if time-constrained
- Each scenario (T035-T044) is independently reviewable and publishable
- The largest content effort is Phase 5 (50 scenarios) — consider batching by industry
- Use the scenario template (T034) as the source of truth for all scenario structure
- All verification tasks should be automated where possible (e.g., grep checks, CI tests)
- Manual verification tasks (usability testing) should be documented with clear pass/fail criteria

---

**Document Status**: Complete
**Last Updated**: 2026-03-09
**Total Tasks**: 59
**Total Verification Steps**: 40
**Estimated Duration**: 4-6 weeks (with parallelization)
