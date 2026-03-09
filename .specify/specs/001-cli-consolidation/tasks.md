---
feature: 001-cli-consolidation
created: 2026-03-09T11:00:00Z
status: ready
---

# Tasks: CLI Consolidation & Org Migration

## Phase 1: Org Migration & Package Rename

### Task 1.1: Update package identity
**File**: `package.json`
**Changes**:
- [ ] Rename `name` from `@enterpriseaigroup/cli` to `@eai-tools/cli`
- [ ] Update `description` if needed
**Blocked by**: None

### Task 1.2: Update template repo references in init command
**File**: `src/commands/init.ts`
**Changes**:
- [ ] Change `TEMPLATE_REPO` from `https://github.com/enterpriseaigroup/Vertical-Template.git` to `https://github.com/eai-tools/Vertical-Template.git`
- [ ] Change `GITHUB_ORG` from `enterpriseaigroup` to `eai-tools`
**Blocked by**: None

### Task 1.3: Update README references
**File**: `README.md`
**Changes**:
- [ ] Replace all `enterpriseaigroup` references with `eai-tools`
- [ ] Update install command to reference `@eai-tools/cli`
- [ ] Update clone URL to `eai-tools/eai-cli`
**Blocked by**: None

---

## Phase 2: Enhanced Scaffolding

### Task 2.1: Enhance `.env.local` generation
**File**: `src/commands/init.ts` — `generateEnvFile()`
**Changes**:
- [ ] Add `TENANT_KEYS` variable derived from app name
- [ ] Add dual-tenant commented example (`TENANT_<NAME>_BENEFICIARY_ID`, `TENANT_<NAME>_EMPLOYEE_ID`)
- [ ] Add `APP_BASE_PATH` with leading slash
- [ ] Add `BASE_URL_PUBLIC_API` with correct default (`https://test-api.myenterprise.ai`)
- [ ] Add section comments separating Platform API, Tenant Config, Auth, App Identity
- [ ] Add comment: `# Run 'eai env pull' to sync from Azure App Config`
**Blocked by**: 1.2

### Task 2.2: Enhance Object Types scaffold
**File**: `src/commands/init.ts` — `generateObjectTypesScaffold()`
**Changes**:
- [ ] Add header comment documenting all field types with examples
- [ ] Add header comment documenting cardinality options
- [ ] Add header comment documenting action side effect types
- [ ] Include a richer example type with: text (required, indexed), number, boolean, date, select (with options), json, relationship properties
- [ ] Include a link type example (one-to-many with cascadeDelete)
- [ ] Include an action example with validation rules + all 3 side effect types
- [ ] Add commented dual-tenant structure example
**Blocked by**: 1.2

### Task 2.3: Enhance deploy workflow generation
**File**: `src/commands/init.ts` — `generateDeployWorkflow()`
**Also**: `src/commands/deploy.ts` — `generateWorkflow()`
**Changes**:
- [ ] Add `build:object-types` step before `Build` step
- [ ] Add `APP_BASE_PATH` env var to build step
- [ ] Add `--target-path` to deploy step for multi-app routing
- [ ] Ensure both `init.ts` and `deploy.ts` generators are consistent
**Blocked by**: 1.2

### Task 2.4: Generate project CLAUDE.md on init
**File**: `src/commands/init.ts` — new `generateClaudeMd()` function
**Changes**:
- [ ] Create function that generates a project-specific CLAUDE.md
- [ ] Include: Tech Stack section (Next.js 15, Platform SDK, Entra CIAM)
- [ ] Include: Platform Architecture diagram (Browser → BFF → PublicAPI → services)
- [ ] Include: Object Types guide (field types, link types, actions)
- [ ] Include: Data Access Patterns (Platform SDK CRUD, useResources hook)
- [ ] Include: Environment Variables reference
- [ ] Include: Deployment guide (deploy-demo.yml, Azure App Service)
- [ ] Include: Vertical Delivery Checklist (10 steps)
- [ ] Include: Available CLI commands section
- [ ] Write to `CLAUDE.md` at project root during init
**Blocked by**: 1.2

---

## Phase 3: Code Quality & Consistency

### Task 3.1: Ensure deploy.ts and init.ts workflow generators are consistent
**Files**: `src/commands/init.ts`, `src/commands/deploy.ts`
**Changes**:
- [ ] Extract shared workflow template to avoid duplication
- [ ] Or ensure both functions generate identical workflow content
**Blocked by**: 2.3

### Task 3.2: Update init "Next steps" output
**File**: `src/commands/init.ts`
**Changes**:
- [ ] Reference `eai-tools` org in any GitHub URLs
- [ ] Add step for reviewing generated CLAUDE.md
- [ ] Mention `eai types define` (when available) or direct edit of object-types.ts
**Blocked by**: 2.4

---

## Phase 4: Build, Test & Ship

### Task 4.1: Build and verify
**Changes**:
- [ ] Run `npx tsc` — must compile cleanly
- [ ] Run `node dist/index.js --help` — all commands listed
- [ ] Run `node dist/index.js types validate` from Vertical-Template — must pass
- [ ] Run `node dist/index.js doctor` from Vertical-Template — must detect project
**Blocked by**: 3.1, 3.2

### Task 4.2: Commit and push
**Changes**:
- [ ] Stage all modified files
- [ ] Commit with clear message describing consolidation
- [ ] Push to `main` on `eai-tools/eai-cli`
**Blocked by**: 4.1

---

## Consolidated Spec Sources

These trialportal specs are now consolidated into this feature:

| Trialportal Spec | Status | What Was Carried Forward |
|-----------------|--------|------------------------|
| `vertical-delivery-pipeline` | Archived | Platform SDK structure, skills, CLAUDE.md contract |
| `vertical-template-platform-alignment-final` | Archived | Template is clean, 100/100 validated |
| `001-vertical-builder-v1` | Archived | Object Type seeding pattern via orchestrate |
| `001-vertical-builder-v1-v1` | Archived | Superseded by v1 |
| `vertical-onboarding-architecture` | Archived | Migration patterns (future scope) |
| `vertical-onboarding-architecture-v1` | Archived | Superseded |
| `vertical-platform-onboarding` | Archived | Subsumed by delivery pipeline |
| `vertical-template-platform-alignment` | Archived | Superseded by -final |
| `nextsteps` | Active (trialportal) | Roadmap context, NS3/NS5 inform future CLI phases |

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 3 tasks | Org migration + package rename |
| 2 | 4 tasks | Enhanced scaffolding (env, types, deploy, CLAUDE.md) |
| 3 | 2 tasks | Code quality + consistency |
| 4 | 2 tasks | Build, test, ship |
| **Total** | **11 tasks** | |
