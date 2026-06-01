# Quick Start - EAI CLI Testing

Get up and running with the test suite in 5 minutes.

## 1. Install Dependencies

```bash
npm install
```

This installs:
- `vitest` - Test framework
- `@vitest/ui` - Interactive test UI
- `msw` - API mocking

## 2. Run Sample Tests

```bash
npm test -- init.test.ts
```

Expected output:
```
✓ tests/integration/init.test.ts (3)
  ✓ eai init (3)
    ✓ TC001: Initialize new vertical interactively
    ✓ TC002: Initialize with --skip-prompts flag
    ✓ TC004: Init fails when directory exists

Test Files  1 passed (1)
     Tests  3 passed (3)
```

## 3. Run All Tests

```bash
npm test
```

## 4. Watch Mode (Development)

```bash
npm run test:watch
```

Tests re-run automatically when files change.

## 5. Interactive UI

```bash
npm run test:ui
```

Opens browser at http://localhost:51204 with visual test runner.

## 6. Coverage Report

```bash
npm run test:coverage
```

Generates HTML report at `coverage/index.html`.

## Writing Your First Test

```typescript
import { describe, test, beforeEach, afterEach } from 'vitest';
import { createTestEnvironment } from '../helpers/test-env.js';
import { workingDirectoryIs, userIsLoggedIn } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';
import { expectCommandSucceeded, expectDisplayedMessage } from '../helpers/assert-dsl.js';

describe('My Command', () => {
  let env, ctx;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: new PublicAPIMock('https://test-api.example.com', mockServer),
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test('TCxxx: Description', async () => {
    // Setup
    workingDirectoryIs(ctx, env.dir);
    await userIsLoggedIn(ctx);

    // Action
    const result = await runCommand(ctx, 'eai whoami');

    // Assert
    expectCommandSucceeded(result);
    expectDisplayedMessage(result, 'Logged in');
  });
});
```

## Next Steps

1. Read `tests/README.md` for detailed guide
2. Review `tests/TEST_SCENARIOS.md` for all 100 scenarios
3. Check `tests/IMPLEMENTATION_PLAN.md` for roadmap
4. Start implementing tests from Phase 3

## Useful Commands

```bash
# Run specific test
npm test -- -t "TC001"

# Run with verbose output
npm test -- --reporter=verbose

# Run with code coverage
npm run test:coverage

# Run in watch mode with UI
npm run test:ui

# Debug tests
node --inspect-brk node_modules/.bin/vitest

# Clear cache
npm test -- --clearCache
```

## Troubleshooting

### Tests fail with "MODULE_NOT_FOUND"
```bash
npm install
npm run build
```

### Tests timeout
Increase timeout in test file:
```typescript
test('slow test', async () => {
  // ...
}, { timeout: 20000 })
```

### Mock server not intercepting requests
Ensure mock server is started in beforeEach:
```typescript
beforeEach(() => {
  mockServer.start();
});
```

## Resources

- [Vitest Docs](https://vitest.dev/)
- [MSW Docs](https://mswjs.io/)
- [Test Scenarios](./TEST_SCENARIOS.md)
- [Implementation Plan](./IMPLEMENTATION_PLAN.md)
- [Completion Report](./COMPLETION_REPORT.md)

Happy Testing! 🧪
