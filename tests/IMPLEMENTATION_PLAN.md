# EAI CLI - Test Implementation Plan

## Overview

This document outlines the phased approach to implementing and executing the 100 business test scenarios for the EAI CLI.

## Phases

### Phase 1: Infrastructure Setup ✅ COMPLETE

**Deliverables:**
- [x] Vitest configuration (`vitest.config.ts`)
- [x] Test environment utilities (`helpers/test-env.ts`)
- [x] Mock server setup (`helpers/mock-server.ts`)
- [x] DSL functions (`helpers/setup-dsl.ts`, `helpers/action-dsl.ts`, `helpers/assert-dsl.ts`)
- [x] Package.json updates with test scripts
- [x] Sample test file (`integration/init.test.ts`)

**Status**: ✅ Complete

---

### Phase 2: Install Dependencies ⬜ TODO

**Commands:**
```bash
cd /Users/example/Code/eai/eai
npm install
```

**Expected Dependencies:**
- `vitest@^2.1.0`
- `@vitest/ui@^2.1.0`
- `msw@^2.6.0`

**Validation:**
```bash
npm test -- --version
# Should show: Vitest v2.1.0
```

---

### Phase 3: Implement Priority P0 Tests ⬜ TODO

**Target**: Critical path scenarios (35 tests)

**Files to Create:**

1. **tests/integration/init.test.ts** (10 scenarios: TC001-TC010)
   - [x] TC001: Initialize interactively ✅ (sample created)
   - [x] TC002: Initialize with --skip-prompts ✅ (sample created)
   - [ ] TC003: Initialize from custom repo
   - [x] TC004: Init fails when directory exists ✅ (sample created)
   - [ ] TC005: Init fails when git not installed
   - [ ] TC006: Initialize multi-tenant structure
   - [ ] TC007: Initialize without AI chat
   - [ ] TC008: Generated object-types.ts is valid
   - [ ] TC009: Generated deployment workflow is valid
   - [ ] TC010: Init creates initial git commit

2. **tests/integration/auth.test.ts** (4 scenarios: TC011, TC015, TC019, TC020)
   - [ ] TC011: Login with browser PKCE flow
   - [ ] TC015: Logout clears tokens
   - [ ] TC019: Auto token refresh on API call

3. **tests/integration/types.test.ts** (6 scenarios: TC031-TC033, TC036-TC037, TC040)
   - [ ] TC031: Validate types - all pass
   - [ ] TC032: Validate fails - non-PascalCase name
   - [ ] TC033: Validate fails - missing displayName
   - [ ] TC036: Seed types to platform
   - [ ] TC037: Seed updates existing types
   - [ ] TC040: Seed fails when not authenticated

4. **tests/integration/resources.test.ts** (10 scenarios: TC046, TC048, TC050, TC052-TC058)
   - [ ] TC046: List resources with pagination
   - [ ] TC048: Get single resource
   - [ ] TC050: Create resource from JSON
   - [ ] TC052: Create fails - invalid data
   - [ ] TC053: Update resource with version locking
   - [ ] TC054: Update auto-fetches version
   - [ ] TC055: Update fails - version mismatch
   - [ ] TC056: Delete resource with confirmation
   - [ ] TC057: Delete resource with --force
   - [ ] TC058: Delete cancelled by user

**Estimated Time**: 8-10 hours

**Success Criteria:**
- All P0 tests written with comment-first DSL
- Tests run and fail appropriately (red phase)
- No syntax errors or test framework issues

---

### Phase 4: Implement Priority P1 Tests ⬜ TODO

**Target**: High-priority scenarios (51 tests)

**Files to Create/Extend:**

1. **tests/integration/auth.test.ts** (remaining: TC012-TC014, TC016-TC018)
2. **tests/integration/env.test.ts** (all: TC021-TC030)
3. **tests/integration/types.test.ts** (remaining: TC034-TC035, TC038-TC039, TC041-TC044)
4. **tests/integration/resources.test.ts** (remaining: TC047, TC049, TC051, TC059-TC060)
5. **tests/integration/tenant.test.ts** (all: TC061-TC070)
6. **tests/integration/chat.test.ts** (most: TC071-TC076)
7. **tests/integration/deploy.test.ts** (all: TC084-TC091)

**Estimated Time**: 12-15 hours

**Success Criteria:**
- All P1 tests written
- Tests run and fail appropriately
- DSL functions cover all setup/action/assert needs

---

### Phase 5: Implement Priority P2 Tests ⬜ TODO

**Target**: Medium-priority scenarios (14 tests)

**Files to Create/Extend:**

1. **tests/integration/chat.test.ts** (remaining: TC077-TC078)
2. **tests/integration/docs.test.ts** (all: TC079-TC083)
3. **tests/integration/verify.test.ts** (all: TC092-TC096)
4. **tests/integration/update.test.ts** (all: TC097-TC100)

**Estimated Time**: 4-6 hours

**Success Criteria:**
- All 100 tests written
- Complete test coverage matrix
- All tests documented with traceability

---

### Phase 6: Fix CLI Implementation ⬜ TODO

**Goal**: Make all tests pass (green phase)

**Approach:**
1. Run tests to identify failures
2. Categorize failures:
   - Missing features
   - Incorrect behavior
   - Edge cases not handled
   - Error messages unclear
3. Fix implementation in `src/` directory
4. Re-run tests until green
5. Add missing error handling
6. Improve user-facing messages

**Estimated Time**: 20-30 hours (varies by current implementation state)

**Success Criteria:**
- All 100 tests passing
- No regressions introduced
- Code coverage > 80%

---

### Phase 7: Add End-to-End Tests ⬜ TODO

**Target**: Full workflow validation (5 E2E tests)

**Files to Create:**

1. **tests/e2e/onboarding.test.ts**
   - Complete onboarding flow: init → login → env pull → types seed → dev

2. **tests/e2e/resource-lifecycle.test.ts**
   - Full CRUD cycle: create → read → update → delete

3. **tests/e2e/deployment.test.ts**
   - Full deployment: setup → configure → trigger → verify

4. **tests/e2e/multi-tenant.test.ts**
   - Multi-tenant workflows: create tenants → seed types → query resources

5. **tests/e2e/ai-workflow.test.ts**
   - AI features: upload docs → classify → index → chat with context

**Estimated Time**: 6-8 hours

**Success Criteria:**
- All E2E tests passing
- Real-world workflows validated
- No integration issues between commands

---

### Phase 8: CI/CD Integration ⬜ TODO

**Goal**: Automate test execution in GitHub Actions

**Tasks:**

1. Update `.github/workflows/ci.yml`:
   ```yaml
   - name: Install dependencies
     run: npm ci

   - name: Run tests
     run: npm test

   - name: Upload coverage
     uses: codecov/codecov-action@v3
     with:
       file: ./coverage/coverage-final.json
   ```

2. Add coverage thresholds enforcement

3. Add test status badge to README.md

4. Configure test failure notifications

**Estimated Time**: 2-3 hours

**Success Criteria:**
- Tests run on every PR
- Coverage reports generated
- Failing tests block merge

---

### Phase 9: Documentation & Maintenance ⬜ TODO

**Goal**: Document testing practices and maintain test suite

**Tasks:**

1. Update main README.md with testing section
2. Create CONTRIBUTING.md with test requirements
3. Add test writing guide for new contributors
4. Set up test coverage monitoring
5. Create test maintenance schedule

**Estimated Time**: 3-4 hours

**Success Criteria:**
- Clear testing documentation
- Contributors can write tests
- Test suite stays current

---

## Timeline

| Phase | Duration | Start | End |
|-------|----------|-------|-----|
| Phase 1: Infrastructure | 4h | ✅ Complete | ✅ Complete |
| Phase 2: Dependencies | 0.5h | TBD | TBD |
| Phase 3: P0 Tests | 10h | TBD | TBD |
| Phase 4: P1 Tests | 15h | TBD | TBD |
| Phase 5: P2 Tests | 6h | TBD | TBD |
| Phase 6: Fix Implementation | 25h | TBD | TBD |
| Phase 7: E2E Tests | 8h | TBD | TBD |
| Phase 8: CI/CD Integration | 3h | TBD | TBD |
| Phase 9: Documentation | 4h | TBD | TBD |
| **Total** | **75.5h** | | |

---

## Dependencies

### Phase Dependencies

- Phase 2 depends on: Phase 1 ✅
- Phase 3 depends on: Phase 2
- Phase 4 depends on: Phase 3
- Phase 5 depends on: Phase 4
- Phase 6 can run parallel with Phases 3-5
- Phase 7 depends on: Phase 6
- Phase 8 depends on: Phase 7
- Phase 9 depends on: Phase 8

### External Dependencies

- Vitest ^2.1.0
- MSW ^2.6.0
- Node.js >=20.0.0
- Git (for E2E tests)
- Azure CLI (for env tests - can mock)
- GitHub CLI (for deploy tests - can mock)

---

## Risk Mitigation

### Risks

1. **Mock Server Complexity**
   - Mitigation: Start with simple mocks, enhance as needed
   - Fallback: Use snapshot testing for complex responses

2. **CLI Subprocess Execution**
   - Mitigation: Use child_process.spawn with proper timeout handling
   - Fallback: Mock CLI commands for unit tests

3. **File System Operations**
   - Mitigation: Always use temp directories, robust cleanup
   - Fallback: Use in-memory virtual file system

4. **Async Timing Issues**
   - Mitigation: Use Vitest's async utilities, proper waits
   - Fallback: Increase timeouts, add retry logic

5. **Platform-Specific Behavior**
   - Mitigation: Mock external CLI tools (git, az, gh)
   - Fallback: Skip platform-specific tests in CI

---

## Success Metrics

### Quantitative

- ✅ 100 test scenarios defined
- ⬜ 100 test scenarios implemented
- ⬜ 100% tests passing
- ⬜ >80% code coverage (lines)
- ⬜ >80% code coverage (functions)
- ⬜ >75% code coverage (branches)
- ⬜ <5s average test execution time
- ⬜ 0 flaky tests

### Qualitative

- ⬜ Tests are readable and maintainable
- ⬜ DSL functions are reusable
- ⬜ Error messages are helpful
- ⬜ Tests serve as documentation
- ⬜ Contributors can write tests easily

---

## Next Immediate Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run sample test**:
   ```bash
   npm test -- init.test.ts
   ```

3. **Verify test infrastructure**:
   - Tests run without errors
   - Mock server works
   - DSL functions accessible
   - Coverage reports generate

4. **Start Phase 3**:
   - Complete `init.test.ts` (TC001-TC010)
   - Implement `auth.test.ts` P0 scenarios
   - Implement `types.test.ts` P0 scenarios

5. **Document progress**:
   - Update this plan as phases complete
   - Track issues/blockers
   - Celebrate milestones! 🎉
