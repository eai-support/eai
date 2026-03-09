# Requirement Traceability: Static npm Registry on GitHub Pages

Generated: 2026-03-09

## Spec → Plan → Tasks Mapping

### User Story Coverage

| User Story | Priority | Plan Phase | Tasks | Acceptance Criteria Status |
|------------|----------|------------|-------|---------------------------|
| US1: Install via npm | P1 | Phase 1, 6 | T001, T010, T011, T015 | 3/3 covered |
| US2: Release publishes | P1 | Phase 1-4, 6 | T001-T006, T010 | 3/3 covered |
| US3: Docs guide consumers | P2 | Phase 5 | T007-T009 | 3/3 covered |
| US4: Semver resolution | P2 | Phase 1 | T001 (packument format) | 2/2 covered |

### Acceptance Criteria Detail

| User Story | Acceptance Criterion | Task(s) | Phase |
|------------|---------------------|---------|-------|
| US1 | npm install -g works with .npmrc | T001, T010, T011 | 1, 6 |
| US1 | Specific version install works | T001 (packument versions) | 1 |
| US1 | Semver range in package.json works | T001 (packument format) | 1 |
| US2 | release.sh triggers registry publish | T003, T005 | 2, 3 |
| US2 | New version appends to existing | T001 (append logic) | 1 |
| US2 | npm view lists all versions | T001, T015 | 1, 6 |
| US3 | Docs show .npmrc + npm install | T007 | 5 |
| US3 | No Homebrew in docs | T007-T009, T012 | 5, 6 |
| US3 | Following docs leads to working install | T007, T011 | 5, 6 |
| US4 | npm outdated works | T001 (packument format) | 1 |
| US4 | npm install @latest works | T001, T008 | 1, 5 |

### Requirement Coverage

| Requirement | Task(s) | Phase | Status |
|-------------|---------|-------|--------|
| FR-001: Valid packument | T001 | 1 | COVERED |
| FR-002: SHA-1 + SHA-512 hashes | T001 | 1 | COVERED |
| FR-003: Accumulate versions | T001 | 1 | COVERED |
| FR-004: Extensionless file path | T001 | 1 | COVERED |
| FR-005: Tarball path | T001 | 1 | COVERED |
| FR-006: Package metadata in versions | T001 | 1 | COVERED |
| FR-007: Commit to main + push | T003, T005 | 2, 3 | COVERED |
| FR-008: Docs describe .npmrc | T007 | 5 | COVERED |
| FR-009: No Homebrew in docs | T007-T009, T012 | 5, 6 | COVERED |
| FR-010: No npm publish | T002, T013 | 2, 6 | COVERED |
| FR-011: No Homebrew in release.sh | T005, T012 | 3, 6 | COVERED |
| FR-012: No Homebrew in GH Release | T004, T012 | 2, 6 | COVERED |

### Plan Phase Coverage

| Phase | Task Count | Tasks | Coverage |
|-------|------------|-------|----------|
| Phase 1: Registry Script | 1 | T001 | 100% |
| Phase 2: Release Workflow | 3 | T002-T004 | 100% |
| Phase 3: Release Script | 1 | T005 | 100% |
| Phase 4: Package.json | 1 | T006 | 100% |
| Phase 5: Documentation | 3 | T007-T009 | 100% |
| Phase 6: Seed + Verify | 6 | T010-T015 | 100% |

## Coverage Summary

- Plan Phases: 6/6 covered (100%)
- User Stories: 4/4 covered (100%)
- Acceptance Criteria: 11/11 covered (100%)
- Functional Requirements: 12/12 covered (100%)

**Status**: VALIDATION PASSED
