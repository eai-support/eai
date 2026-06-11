## EAI CLI Test Suite

Comprehensive test coverage for the EAI CLI with 100 business scenarios across all command groups.

## Overview

- **Total Scenarios**: 100
- **Test Framework**: Vitest
- **DSL Approach**: Given-When-Then via dedicated DSL functions
- **Coverage Target**: 80%+ lines, functions, branches

## Test Structure

```
tests/
├── integration/          # Command-level tests (TC001-TC100)
│   ├── init.test.ts      # eai init scenarios
│   ├── auth.test.ts      # eai login/logout scenarios
│   ├── env.test.ts       # eai env scenarios
│   ├── types.test.ts     # eai types scenarios
│   ├── resources.test.ts # eai resources scenarios
│   ├── tenant.test.ts    # eai tenant scenarios
│   ├── chat.test.ts      # eai chat scenarios
│   ├── docs.test.ts      # eai docs scenarios
│   ├── deploy.test.ts    # eai deploy scenarios
│   ├── verify.test.ts    # eai verify/doctor scenarios
│   └── update.test.ts    # eai update scenarios
├── e2e/                  # End-to-end workflows
├── unit/                 # Unit tests for utilities
├── helpers/              # DSL functions
│   ├── setup-dsl.ts      # Setup/arrange functions
│   ├── action-dsl.ts     # Action/act functions
│   ├── assert-dsl.ts     # Assertion functions
│   ├── mock-server.ts    # API mocking
│   └── test-env.ts       # Test environment
└── fixtures/             # Test data

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with UI
npm run test:ui

# Generate coverage report
npm run test:coverage

# Run the focused SRP EAI CLI evidence set
npm run test:eai-cli:ci

# Run specific test file
npm test -- init.test.ts

# Run specific test by name
npm test -- -t "TC001"
```

## Writing Tests

### DSL Pattern

Tests use a Domain Specific Language (DSL) approach with three phases:

1. **Setup (Given)** - Arrange test state
2. **Action (When)** - Execute command
3. **Assert (Then)** - Verify outcome

### Example Test

```typescript
import { describe, test, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment } from '../helpers/test-env.js';
import { workingDirectoryIs, userIsLoggedIn } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectCommandSucceeded, expectDisplayedMessage } from '../helpers/assert-dsl.js';

describe('eai whoami', () => {
  let env, ctx;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = { workingDir: env.dir, env: {}, prompts: [] };
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test('TC016: Shows current user', async () => {
    // Setup
    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx, { email: 'dev@company.com' });

    // Action
    const result = await runCommand(ctx, 'eai whoami');

    // Assert
    expectCommandSucceeded(result);
    expectDisplayedMessage(result, 'Logged in as: dev@company.com');
  });
});
```

### Comment-First Approach

Always include the test case comment block before implementation:

```typescript
test('TC001: Description', async () => {
  // TC001: Test Case Name
  // Traces to: US-X AC-Y
  //
  // setupFunction()
  // anotherSetupFunction()
  //
  // actionFunction()
  //
  // expectationFunction()
  // anotherExpectationFunction()

  // Actual implementation...
});
```

## DSL Functions

### Setup Functions (Arrange)

Create test state and preconditions:

```typescript
// Environment
workingDirectoryIs(ctx, '/path/to/dir')
networkIsAvailable(ctx)

// Authentication
await userIsLoggedIn(ctx, { email: 'test@example.com' })
userIsNotLoggedIn(ctx)
await tokenExpired(ctx)

// Project state
await projectHasEnvFile(ctx, { BASE_URL_PUBLIC_API: 'https://...' })
await projectHasValidObjectTypes(ctx, [{ name: 'Customer', displayName: 'Customer' }])
await projectHasMultiTenantConfig(ctx, ['app', 'app-staff'])

// API mocking
publicAPIReachable(ctx)
publicAPIUnreachable(ctx)
typeExistsOnPlatform(ctx, 'Customer', 'id-123', { version: 1 })
resourceExists(ctx, 'Customer', 'id-456', { name: 'Acme' })

// Prerequisites
gitIsInstalled(ctx)
azureCLIInstalled(ctx)
gitHubCLIInstalled(ctx)
```

### Action Functions (Act)

Execute commands and simulate interactions:

```typescript
// Run CLI command
const result = await runCommand(ctx, 'eai types seed')

// Handle prompts
respondToPrompt(ctx, 'Confirm?', 'yes')

// Simulate auth flow
await waitForUserAuth(ctx)

// Advance time
await waitSeconds(5)
```

### Assertion Functions (Assert)

Verify expected outcomes:

```typescript
// Command results
expectCommandSucceeded(result)
expectCommandFailed(result)
expectExitCode(result, 0)

// Output messages
expectSuccessMessage(result, 'Created successfully')
expectErrorMessage(result, 'Not found')
expectWarningMessage(result, 'Deprecated')
expectDisplayedMessage(result, 'Hello world')

// File system
await expectFileExists(ctx, 'package.json')
await expectFileContains(ctx, '.env.local', 'BASE_URL=')
await expectEnvVarSet(ctx, '.env.local', 'KEY', 'value')

// API calls
expectAPICalledGET(ctx, '/v4/data/resources/object-types')
expectAPICalledPOST(ctx, '/resources/tenant/Customer', { data: {...} })
expectNoAPICallsMade(ctx)

// Authentication
await expectTokenStored(ctx, '~/.eai/tokens.json')
await expectTokenEncrypted(ctx, '~/.eai/tokens.json')

// Validation
expectValidationPassed(result)
expectValidationFailed(result)
expectNoErrorsOrWarnings(result)
```

## Test Coverage Matrix

| Category | Scenarios | Priority | File |
|----------|-----------|----------|------|
| Init & Setup | 1-10 | P0 | init.test.ts |
| Authentication | 11-20 | P0 | auth.test.ts |
| Environment | 21-30 | P1 | env.test.ts |
| Object Types | 31-45 | P0 | types.test.ts |
| Resources CRUD | 46-60 | P0 | resources.test.ts |
| Multi-Tenant | 61-70 | P1 | tenant.test.ts |
| AI & Chat | 71-78 | P1 | chat.test.ts |
| Documents | 79-83 | P2 | docs.test.ts |
| Deployment | 84-91 | P1 | deploy.test.ts |
| Diagnostics | 92-96 | P2 | verify.test.ts |
| CLI Updates | 97-100 | P2 | update.test.ts |

## CI Integration

Tests run automatically on:
- Pull requests (all tests)
- Pull requests (`ci/eai-cli-tests`, focused SRP evidence for auth, tenant, schema, error, PublicAPI, and preview-lifecycle contracts)
- Main branch pushes (all tests + coverage)
- Release tags (all tests + coverage + smoke tests)

See `.github/workflows/ci.yml` for CI configuration.

## Next Steps

1. ✅ **Test Infrastructure Created**
   - Vitest configuration
   - DSL helper functions
   - Mock server setup
   - Test environment utilities

2. ⬜ **Implement Remaining Test Files**
   - auth.test.ts (TC011-TC020)
   - env.test.ts (TC021-TC030)
   - types.test.ts (TC031-TC045)
   - resources.test.ts (TC046-TC060)
   - tenant.test.ts (TC061-TC070)
   - chat.test.ts (TC071-TC078)
   - docs.test.ts (TC079-TC083)
   - deploy.test.ts (TC084-TC091)
   - verify.test.ts (TC092-TC096)
   - update.test.ts (TC097-TC100)

3. ⬜ **Install Dependencies**
   ```bash
   npm install
   ```

4. ⬜ **Run Initial Tests** (expect failures - red phase)
   ```bash
   npm test
   ```

5. ⬜ **Implement/Fix CLI Commands** to make tests pass

6. ⬜ **Add Coverage Reporting** to CI/CD

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [Test Scenarios Document](./TEST_SCENARIOS.md)
