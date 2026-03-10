---
feature: 001-cli-consolidation
created: 2026-03-09T11:00:00Z
status: complete
completedAt: 2026-03-09
---

# Tasks: CLI Consolidation & Org Migration

## Phase 1: Org Migration & Package Rename

- [x] T001 Rename package name from `@enterpriseaigroup/cli` to `@eai-tools/cli` in package.json
- [x] T002 Update description in package.json if needed
- [x] T003 [P] Change TEMPLATE_REPO from enterpriseaigroup to eai-tools in src/commands/init.ts
- [x] T004 [P] Change GITHUB_ORG from enterpriseaigroup to eai-tools in src/commands/init.ts
- [x] T005 [P] Replace all enterpriseaigroup references with eai-tools in README.md
- [x] T006 [P] Update install command to reference @eai-tools/cli in README.md
- [x] T007 [P] Update clone URL to eai-tools/eai-cli in README.md

## Phase 2: Enhanced Scaffolding

- [x] T008 Add TENANT_KEYS variable to .env.local generation in src/commands/init.ts
- [x] T009 Add dual-tenant commented example to env file generation
- [x] T010 Add APP_BASE_PATH and BASE_URL_PUBLIC_API to env defaults
- [x] T011 Add section comments separating Platform API, Tenant Config, Auth, App Identity
- [x] T012 [P] Add header comment documenting all field types with examples in Object Types scaffold
- [x] T013 [P] Add header comment documenting cardinality options in Object Types scaffold
- [x] T014 [P] Include richer example type with all property types in scaffold
- [x] T015 [P] Include link type and action examples in scaffold
- [x] T016 Add build:object-types step to deploy workflow generation
- [x] T017 Add APP_BASE_PATH env var to deploy workflow build step
- [x] T018 Ensure init.ts and deploy.ts workflow generators are consistent
- [x] T019 Generate project CLAUDE.md on init with tech stack, architecture, and guides

## Phase 3: Code Quality & Consistency

- [x] T020 Extract shared workflow template or ensure both generators match
- [x] T021 Update init "Next steps" output to reference eai-tools org

## Phase 4: Build, Test & Ship

- [x] T022 Run npx tsc — compile cleanly
- [x] T023 Run node dist/index.js --help — verify all commands listed
- [x] T024 Run eai types validate from Vertical-Template — verify passing
- [x] T025 Run eai doctor from Vertical-Template — verify project detection
- [x] T026 Stage, commit, and push all changes to main on eai-tools/eai-cli
