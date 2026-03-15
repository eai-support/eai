# Requirement Traceability: CLI Help System Enhancement

Generated: 2026-03-15T12:40:00Z

## Spec → Plan → Tasks Mapping

### User Story Coverage

| User Story | Priority | Plan Phase | Tasks | Acceptance Criteria Status |
|------------|----------|------------|-------|---------------------------|
| US1: Automated Testing and CI/CD Integration | P0 | Phase 3 | T041-T057 (17 tasks) | 5/5 covered |
| US2: AI Agent Tool Integration | P0 | Phase 5 | T058-T065 (8 tasks) | 5/5 covered |
| US3: Accessible CLI for All Users | P1 | Phase 1 | T001-T019, T066-T069 (23 tasks) | 5/5 covered |
| US4: Quick Command Discovery | P1 | Phase 6 | T070-T082 (13 tasks) | 4/4 covered (tab completion out of scope) |
| US5: Structured Error Handling | P1 | Phase 2, 7 | T020-T040, T083-T085 (24 tasks) | 5/5 covered |

### Acceptance Criteria Detail

| ID | Criterion | Task(s) | Phase |
|----|-----------|---------|-------|
| US1-AC1 | All commands support `--format json` flag | T041-T053 | Phase 3 |
| US1-AC2 | JSON output is valid, parseable JSON with consistent schema | T041-T053 | Phase 3 |
| US1-AC3 | Errors in JSON mode include error codes and structured details | T027, T028 | Phase 2 |
| US1-AC4 | JSON output excludes progress indicators and ANSI codes | T054-T057 | Phase 3 |
| US1-AC5 | Exit codes reliably indicate success (0) vs failure (1) | T028 | Phase 2 |
| US2-AC1 | `--describe` flag outputs JSON schema for any command | T063-T065 | Phase 4 |
| US2-AC2 | Schema includes parameter types, constraints, and defaults | T059-T062 | Phase 4 |
| US2-AC3 | Help text is structured and machine-parseable | T070-T082 | Phase 6 |
| US2-AC4 | Error messages include error codes for programmatic handling | T020-T040 | Phase 2 |
| US2-AC5 | Commands are deterministic (same input → same output) | T041-T057 | Phase 3 |
| US3-AC1 | `--simple` mode provides plain text without colors/symbols | T014-T018, T066 | Phase 1, 5 |
| US3-AC2 | Help text uses structural elements (headings, lists) | T070-T082 | Phase 6 |
| US3-AC3 | Information is not conveyed by color alone | T015-T018, T069 | Phase 1, 5 |
| US3-AC4 | Output utilities check for TTY and color support | T009-T013, T067 | Phase 1, 5 |
| US3-AC5 | All commands work in text-only mode | T066-T069 | Phase 5 |
| US4-AC1 | `--help` shows brief, scannable information | T079-T082 | Phase 6 |
| US4-AC2 | `--examples` flag shows 2-5 practical usage examples | T070-T078 | Phase 6 |
| US4-AC3 | Help footer includes common workflow patterns | T079-T082 | Phase 6 |
| US4-AC4 | Error messages suggest related commands | T083, T085 | Phase 7 |
| US4-AC5 | Tab completion works in bash, zsh, and fish shells | OUT OF SCOPE | N/A |
| US5-AC1 | All errors include structured error codes (E001-E399) | T020-T025 | Phase 2 |
| US5-AC2 | Error messages state the problem and provide a solution | T026, T083 | Phase 2, 7 |
| US5-AC3 | Errors show the failing input when relevant | T084 | Phase 7 |
| US5-AC4 | Error codes are categorized (Project, Auth, Platform, Validation) | T022-T025 | Phase 2 |
| US5-AC5 | Errors link to docs/troubleshooting when appropriate | T124 | Phase 9 |

### Plan Phase Coverage

| Phase | Task Count | Task IDs | Coverage |
|-------|------------|----------|----------|
| Phase 1: Foundation & Output Layer | 19 | T001-T019 | 100% |
| Phase 2: Error Code System | 21 | T020-T040 | 100% |
| Phase 3: JSON Output Implementation | 17 | T041-T057 | 100% |
| Phase 4: Format Flag Support | 0 | N/A | MERGED INTO PHASE 3 |
| Phase 5: Schema Introspection | 8 | T058-T065 | 100% |
| Phase 6: Examples and Help Enhancement | 13 | T070-T082 | 100% |
| Phase 7: Testing and Validation | 34 | T086-T119 | 100% |
| Phase 8: Documentation and Polish | 15 | T120-T134 | 100% |

**Note**: Plan Phase 4 (Format Flag Support) was merged into Phase 3 (JSON Output Implementation) because the `--format` flag implementation is tightly coupled with JSON output implementation.

### Functional Requirement Coverage

| FR-ID | Requirement | Task(s) | Phase |
|-------|-------------|---------|-------|
| FR001 | JSON Output Implementation | T041-T057 | Phase 3 |
| FR002 | Output Utility Functions | T001-T008, T019 | Phase 1 |
| FR003 | Format Flag Support | T041-T053 (integrated) | Phase 3 |
| FR004 | Error Code System | T020-T040, T083-T085 | Phase 2, 7 |
| FR005 | Schema Introspection | T058-T065 | Phase 4 |
| FR006 | Examples Flag | T070-T078 | Phase 6 |
| FR007 | Simple/Accessible Mode | T014-T018, T066-T069 | Phase 1, 5 |
| FR008 | Help Footer Enhancement | T079-T082 | Phase 6 |
| FR009 | TTY and Color Detection | T009-T013, T067-T068 | Phase 1, 5 |
| FR010 | Backward Compatibility | T108 (test), implicit in all phases | Phase 8 |

### Plan Task Item Coverage

**Phase 1: Foundation & Output Layer**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Implement `success(msg: string): void` | T001 | COVERED |
| Implement `warn(msg: string): void` | T002 | COVERED |
| Implement `info(msg: string): void` | T003 | COVERED |
| Implement `heading(text: string): void` | T004 | COVERED |
| Implement `dim(text: string): void` | T005 | COVERED |
| Implement `table(rows: Array<[string, string]>): void` | T006 | COVERED |
| Implement `json(data: unknown): void` | T007 | COVERED |
| Implement `yaml(data: unknown): void` | OUT OF SCOPE (P2) | N/A |
| Implement `blank(): void` | T008 | COVERED |
| Check `process.stdout.isTTY` | T009 | COVERED |
| Respect `NO_COLOR` environment variable | T010 | COVERED |
| Respect `FORCE_COLOR` environment variable | T011 | COVERED |
| Support `--no-color` global flag | T012 | COVERED |
| Support `--color` global flag | T013 | COVERED |
| Global flag in `src/index.ts` for `--simple` | T014 | COVERED |
| Disable colors and symbols when `--simple` | T015-T018 | COVERED |
| Replace symbols with text labels | T015-T018 | COVERED |
| `formatOutput(data, format)` helper | T019 | COVERED |

**Phase 2: Error Code System**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Define `ErrorCode` enum (E001-E399) | T020 | COVERED |
| Categorize E001-E099 (Project errors) | T022 | COVERED |
| Categorize E100-E199 (Auth errors) | T023 | COVERED |
| Categorize E200-E299 (Platform errors) | T024 | COVERED |
| Categorize E300-E399 (Validation errors) | T025 | COVERED |
| Define `ErrorDefinition` interface | T021 | COVERED |
| Create error catalog with message templates | T022-T025 | COVERED |
| Implement `formatError(code, context)` | T026 | COVERED |
| Implement `formatErrorJSON(code, context)` | T027 | COVERED |
| Catalog all existing error messages | T029-T034 | COVERED |
| Assign error codes to each error condition | T029-T034 | COVERED |
| Document error codes | T022-T025 | COVERED |
| Update error output format (text) | T026 | COVERED |
| Update error output format (JSON) | T027 | COVERED |
| Add helper `exitWithError(code, context, format)` | T028 | COVERED |
| Replace errors in all command files | T035-T040 | COVERED |

**Phase 3: JSON Output Implementation**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| `types seed --format json` | T041 | COVERED |
| `types diff --format json` | T042 | COVERED |
| `types pull --format json` | T043 | COVERED |
| `resources list --format json` | T044 | COVERED |
| `resources get --format json` | T045 | COVERED |
| `resources query --format json` | T046 | COVERED |
| `resources schema --format json` | T047 | COVERED |
| `deploy trigger --format json` | T048 | COVERED |
| `deploy status --format json` | T049 | COVERED |
| `tenant list --format json` | T050 | COVERED |
| `tenant create --format json` | T051 | COVERED |
| `tenant info --format json` | T052 | COVERED |
| `env list --format json` | T053 | COVERED |
| Disable `ora` spinners when format is JSON | T054-T057 | COVERED |
| Disable colored output in JSON mode | T054-T057 (implicit) | COVERED |
| Ensure only valid JSON to stdout | T041-T053 (implicit) | COVERED |

**Phase 5: Schema Introspection**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Create `src/lib/schema-builder.ts` | T058 | COVERED |
| Implement `buildCommandSchema(command)` | T059 | COVERED |
| Extract command name, description | T059 (implicit) | COVERED |
| Extract options (name, type, default, description) | T060 | COVERED |
| Extract subcommands recursively | T061 | COVERED |
| Generate JSON Schema format output | T062 | COVERED |
| Add `--describe` global flag | T063 | COVERED |
| Hook into Commander.js to intercept `--describe` | T063-T064 | COVERED |
| Output schema instead of executing | T065 | COVERED |

**Phase 6: Examples and Help Enhancement**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Use Commander's `.addHelpText('after', ...)` | T070-T078 | COVERED |
| Create examples for `types` commands | T070 | COVERED |
| Create examples for `resources` commands | T071 | COVERED |
| Create examples for `tenant` commands | T072 | COVERED |
| Create examples for `deploy` commands | T073 | COVERED |
| Create examples for `env` commands | T074 | COVERED |
| Create examples for `user` commands | T075 | COVERED |
| Create examples for `chat` commands | T076 | COVERED |
| Create examples for `docs` commands | T077 | COVERED |
| Enhance root help footer | T079 | COVERED |
| Add "Getting Started" section | T079 | COVERED |
| Add "Development Workflow" section | T080 | COVERED |
| Add "Deployment" section | T081 | COVERED |
| Point to `--examples` flag | T082 | COVERED |
| Point to `--describe` flag | T082 | COVERED |

**Phase 7: Testing and Validation**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Unit tests for output utilities | T086-T090 | COVERED |
| Unit tests for error code system | T091-T094 | COVERED |
| Unit tests for schema builder | T095-T098 | COVERED |
| Integration tests for JSON output | T099-T104 | COVERED |
| Integration tests for format flag | T105-T108 | COVERED |
| Integration tests for `--describe` | T109-T112 | COVERED |
| Integration tests for examples | T113-T115 | COVERED |
| Performance testing | T116-T119 | COVERED |

**Phase 8: Documentation and Polish**

| Plan Task Item | Implementing Task(s) | Status |
|----------------|---------------------|--------|
| Update CLI documentation | T120-T123 | COVERED |
| Create error codes reference page | T124 | COVERED |
| Update README.md | T127 | COVERED |
| Create migration guide | T120-T123 (implicit) | COVERED |
| Add inline code comments | T128-T130 | COVERED |
| Final polish | T131-T134 | COVERED |

### Data Model Coverage

No data models defined for this feature (CLI help system does not introduce new data entities).

### API Contract Coverage

No API contracts defined for this feature (CLI help system is terminal-only, no network APIs).

### File Structure Alignment

All task file paths verified against plan.md file structure:

| Task | File Path | In Plan Structure? |
|------|-----------|-------------------|
| T001-T019 | src/lib/output.ts | ✓ Yes |
| T020-T028 | src/lib/error-codes.ts | ✓ Yes (new file) |
| T029-T040 | src/commands/*.ts | ✓ Yes |
| T041-T057 | src/commands/*.ts | ✓ Yes |
| T058-T065 | src/lib/schema-builder.ts | ✓ Yes (new file) |
| T066-T082 | src/index.ts, src/commands/*.ts | ✓ Yes |
| T086-T119 | tests/unit/*.test.ts, tests/integration/*.test.ts | ✓ Yes (new files) |
| T120-T134 | docs/, README.md | ✓ Yes |

---

## Coverage Summary

- **Plan Phases**: 8/8 covered (100%)
  - Note: Phase 4 (Format Flag Support) merged into Phase 3
- **User Stories**: 5/5 covered (100%)
- **Acceptance Criteria**: 24/25 covered (96%)
  - 1 explicitly out of scope (US4-AC5: Tab completion)
- **Functional Requirements**: 10/10 covered (100%)
- **Plan Task Items**: 100% of plan tasks have implementing tasks
- **Data Entities**: N/A (no data models for this feature)
- **API Endpoints**: N/A (no APIs for this feature)

---

## Validation Results

### ✅ VALIDATION PASSED

All critical requirements have task coverage:
- ✓ Every user story has implementing tasks
- ✓ Every acceptance criterion (except out-of-scope) has tasks
- ✓ Every functional requirement has tasks
- ✓ Every plan phase has tasks
- ✓ Every plan task item has implementing tasks
- ✓ All file paths in tasks align with plan structure

### Notes

1. **Plan Phase 4 Merged**: The original plan had separate phases for "JSON Output Implementation" and "Format Flag Support". In the tasks breakdown, these were merged into a single Phase 3 because the `--format` flag implementation is tightly coupled with JSON output implementation. This is a natural optimization and does not affect coverage.

2. **Tab Completion Out of Scope**: US4-AC5 (tab completion) was explicitly marked as out of scope in spec.md. This is documented and approved.

3. **YAML Format P2**: YAML output support (`--format yaml`) is marked as P2 (future enhancement) in spec.md and plan.md. Not included in this task breakdown.

4. **Backward Compatibility**: FR010 (Backward Compatibility) is addressed implicitly throughout all phases, with explicit testing in Phase 8 (T108).

---

## Traceability Matrix

```
Spec (User Stories + FRs)
    ↓
Plan (8 Phases + Architecture)
    ↓
Tasks (134 Tasks across 9 Phases)
    ↓
Implementation (Next: /5_gofer_implement)
```

**Status**: READY FOR IMPLEMENTATION ✓

All requirements are traceable from spec → plan → tasks. No gaps identified.
